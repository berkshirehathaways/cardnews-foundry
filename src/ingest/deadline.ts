import { IngestSecurityError } from "#ingest/errors";

export type RequestDeadline = {
  readonly signal: AbortSignal;
  readonly run: <T>(operation: () => T | PromiseLike<T>) => Promise<T>;
  readonly dispose: () => void;
};

const deadlineError = (cause?: Error): IngestSecurityError =>
  new IngestSecurityError(
    "RESPONSE_DEADLINE",
    "source exceeded the absolute response deadline",
    cause === undefined ? undefined : { cause }
  );

const abortedError = (): DOMException =>
  new DOMException("ingestion aborted", "AbortError");

export const createRequestDeadline = (
  durationMs: number,
  upstream?: AbortSignal
): RequestDeadline => {
  const controller = new AbortController();
  const expiresAt = Date.now() + Math.max(0, durationMs);
  let expired = false;
  let disposed = false;

  const expire = (): void => {
    if (controller.signal.aborted) return;
    expired = true;
    controller.abort();
  };
  const abort = (): void => {
    if (!controller.signal.aborted) controller.abort();
  };
  const timeout = setTimeout(expire, Math.max(0, expiresAt - Date.now()));
  upstream?.addEventListener("abort", abort, { once: true });
  if (upstream?.aborted === true) abort();

  const abortReason = (): Error => expired ? deadlineError() : abortedError();
  const run = <T>(operation: () => T | PromiseLike<T>): Promise<T> => {
    if (!controller.signal.aborted && Date.now() >= expiresAt) expire();
    if (controller.signal.aborted) return Promise.reject(abortReason());

    let pending: T | PromiseLike<T>;
    try {
      pending = operation();
    } catch (error) {
      if (!controller.signal.aborted && Date.now() >= expiresAt) expire();
      if (controller.signal.aborted) return Promise.reject(abortReason());
      return Promise.reject(error);
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (completion: () => void): void => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener("abort", onAbort);
        completion();
      };
      const onAbort = (): void => finish(() => reject(abortReason()));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
      Promise.resolve(pending).then(
        (value) => {
          if (!controller.signal.aborted && Date.now() >= expiresAt) expire();
          if (controller.signal.aborted) {
            finish(() => reject(abortReason()));
            return;
          }
          finish(() => resolve(value));
        },
        (error: unknown) => {
          if (!controller.signal.aborted && Date.now() >= expiresAt) expire();
          if (controller.signal.aborted) {
            finish(() => reject(abortReason()));
            return;
          }
          finish(() => reject(error));
        }
      );
    });
  };

  return {
    signal: controller.signal,
    run,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeout);
      upstream?.removeEventListener("abort", abort);
    }
  };
};
