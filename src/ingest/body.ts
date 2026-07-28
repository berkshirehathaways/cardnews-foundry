import { IngestSecurityError } from "#ingest/errors";
import { responseHeader } from "#ingest/http";
import type { RequestDeadline } from "#ingest/deadline";
import type { NetworkResponse } from "#ingest/types";

type BodyReader = {
  readonly read: (deadline: RequestDeadline, maximumBytes: number) => Promise<Uint8Array>;
  readonly cancel: () => void;
};

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const invokeCleanup = (target: object, property: PropertyKey): void => {
  const method = Reflect.get(target, property);
  if (typeof method !== "function") return;
  try {
    Promise.resolve(Reflect.apply(method, target, [])).then(
      () => undefined,
      () => undefined
    );
  } catch {}
};

const joinChunks = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const createBodyReader = (response: NetworkResponse): BodyReader => {
  const asyncIterator = Reflect.get(response.body, Symbol.asyncIterator);
  const syncIterator = Reflect.get(response.body, Symbol.iterator);
  const iteratorFactory = typeof asyncIterator === "function" ? asyncIterator : syncIterator;
  if (typeof iteratorFactory !== "function") {
    throw new IngestSecurityError("INCOMPLETE_RESPONSE", "source response body is not iterable");
  }
  const iterator = Reflect.apply(iteratorFactory, response.body, []);
  if (!isObject(iterator) || typeof Reflect.get(iterator, "next") !== "function") {
    throw new IngestSecurityError("INCOMPLETE_RESPONSE", "source response body iterator is invalid");
  }
  let cancelled = false;

  return {
    read: async (deadline, maximumBytes) => {
      const length = Number(responseHeader(response.headers, "content-length"));
      if (Number.isFinite(length) && length > maximumBytes) {
        throw new IngestSecurityError("TRANSFER_TOO_LARGE", "source transfer exceeds 5 MiB");
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const next = Reflect.get(iterator, "next");
          if (typeof next !== "function") {
            throw new IngestSecurityError("INCOMPLETE_RESPONSE", "source response body iterator is invalid");
          }
          const step = await deadline.run(() => Reflect.apply(next, iterator, []));
          if (!isObject(step)) {
            throw new IngestSecurityError("INCOMPLETE_RESPONSE", "source response body yielded an invalid step");
          }
          if (Reflect.get(step, "done") === true) break;
          const chunk = Reflect.get(step, "value");
          if (!(chunk instanceof Uint8Array)) {
            throw new IngestSecurityError("INCOMPLETE_RESPONSE", "source response body yielded invalid bytes");
          }
          total += chunk.byteLength;
          if (total > maximumBytes) {
            throw new IngestSecurityError("TRANSFER_TOO_LARGE", "source transfer exceeds 5 MiB");
          }
          chunks.push(chunk);
        }
      } catch (error) {
        if (error instanceof IngestSecurityError) throw error;
        if (deadline.signal.aborted) throw error;
        throw new IngestSecurityError("INCOMPLETE_RESPONSE", "source response ended before completion", {
          cause: error instanceof Error ? error : undefined
        });
      }
      return joinChunks(chunks, total);
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      invokeCleanup(iterator, "return");
      invokeCleanup(response.body, "cancel");
      invokeCleanup(response.body, "destroy");
      if (response.close !== undefined) invokeCleanup(response, "close");
    }
  };
};
