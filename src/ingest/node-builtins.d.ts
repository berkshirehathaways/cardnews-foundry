declare module "node:crypto" {
  type Hash = {
    update(data: string | Uint8Array, encoding?: string): Hash;
    digest(encoding: "hex"): string;
  };
  export function createHash(algorithm: string): Hash;
}

declare module "node:dns/promises" {
  export function lookup(
    hostname: string,
    options: { readonly all: true; readonly verbatim: true }
  ): Promise<readonly { readonly address: string; readonly family: number }[]>;
}

declare module "node:net" {
  export function isIP(input: string): 0 | 4 | 6;
}

declare module "node:http" {
  type IncomingHttpHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;
  type IncomingMessage = AsyncIterable<Uint8Array> & {
    readonly statusCode?: number;
    readonly headers: IncomingHttpHeaders;
    destroy(): void;
  };
  type ClientRequest = {
    once(event: "error", listener: (error: Error) => void): void;
    end(): void;
  };
  type RequestOptions = {
    readonly protocol: string;
    readonly hostname: string;
    readonly port?: number;
    readonly method: string;
    readonly path: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly agent: false;
    readonly servername?: string;
    readonly rejectUnauthorized: boolean;
    readonly signal: AbortSignal;
  };
  export function request(
    options: RequestOptions,
    callback: (response: IncomingMessage) => void
  ): ClientRequest;
}

declare module "node:https" {
  export { request } from "node:http";
}

declare module "node:zlib" {
  type ZlibOptions = { readonly maxOutputLength: number };
  export function gunzipSync(data: Uint8Array, options: ZlibOptions): Uint8Array;
  export function inflateSync(data: Uint8Array, options: ZlibOptions): Uint8Array;
  export function brotliDecompressSync(data: Uint8Array, options: ZlibOptions): Uint8Array;
}

declare module "node:fs" {
  export const constants: {
    readonly COPYFILE_EXCL: number;
    readonly O_RDONLY: number;
    readonly O_NOFOLLOW: number;
  };
}

declare module "node:fs/promises" {
  export function open(path: string, flags: number): Promise<{
    read(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null
    ): Promise<{ readonly bytesRead: number; readonly buffer: Uint8Array }>;
    stat(): Promise<Stats>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }>;
}

declare module "node:path" {
  export function extname(value: string): string;
  export function relative(from: string, to: string): string;
}
