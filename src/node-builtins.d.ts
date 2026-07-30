// Shared minimal Node.js builtin type surface for the whole src tree.
// Consolidated from the former per-directory node-builtins.d.ts shims
// (assets/contracts/ingest/jobs). Ambient `declare module` blocks merge
// globally, so a single source of truth prevents per-directory drift.

declare module "node:crypto" {
  type Hash = {
    update(data: string | Uint8Array, encoding?: string): Hash;
    digest(encoding: "hex"): string;
  };
  export function createHash(algorithm: string): Hash;
  export function randomUUID(): string;
}

declare module "node:child_process" {
  type SpawnSyncResult = {
    readonly error?: Error;
    readonly status: number | null;
    readonly stdout: Uint8Array;
    readonly stderr: Uint8Array;
  };

  export function spawnSync(
    command: string,
    args: readonly string[],
    options: {
      readonly cwd: string;
      readonly input?: Uint8Array;
      readonly maxBuffer: number;
    }
  ): SpawnSyncResult;
}

declare module "node:url" {
  export function fileURLToPath(value: URL): string;
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
  type InflateInfo = {
    readonly buffer: Uint8Array;
    readonly engine: { readonly bytesWritten: number };
  };
  type InflateStream = {
    readonly bytesWritten: number;
    on(event: "data", listener: (chunk: Uint8Array) => void): InflateStream;
    once(event: "error", listener: (error: Error) => void): InflateStream;
    once(event: "end", listener: () => void): InflateStream;
    write(chunk: Uint8Array): boolean;
    end(): void;
    destroy(): void;
  };
  type ZlibOptions = { readonly maxOutputLength: number };

  export function createInflate(): InflateStream;
  export function inflateSync(
    data: Uint8Array,
    options: { readonly maxOutputLength: number; readonly info: true }
  ): InflateInfo;
  export function inflateSync(data: Uint8Array, options: ZlibOptions): Uint8Array;
  export function gunzipSync(data: Uint8Array, options: ZlibOptions): Uint8Array;
  export function brotliDecompressSync(data: Uint8Array, options: ZlibOptions): Uint8Array;
}

declare module "node:fs" {
  export const constants: {
    readonly COPYFILE_EXCL: number;
    readonly O_RDONLY: number;
    readonly O_NOFOLLOW: number;
  };
  export function readFileSync(path: URL, encoding: "utf8"): string;
}

declare module "node:fs/promises" {
  type Stats = {
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  };
  type BigIntStats = Stats & {
    readonly dev: bigint;
    readonly ino: bigint;
  };
  type FileHandle = {
    writeFile(data: Uint8Array | string): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  };

  export function open(path: string, flags: string, mode?: number): Promise<FileHandle>;
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
  export function mkdir(
    path: string,
    options: { readonly recursive: boolean; readonly mode?: number }
  ): Promise<string | undefined>;
  export function realpath(path: string): Promise<string>;
  export function stat(path: string): Promise<Stats>;
  export function lstat(path: string): Promise<Stats>;
  export function lstat(path: string, options: { readonly bigint: true }): Promise<BigIntStats>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function rm(path: string, options?: { readonly force?: boolean; readonly recursive?: boolean }): Promise<void>;
  export function rmdir(path: string): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function readdir(path: string): Promise<string[]>;
  export function cp(
    source: string,
    destination: string,
    options: { readonly recursive: boolean; readonly errorOnExist: boolean }
  ): Promise<void>;
  export function copyFile(source: string, destination: string, mode?: number): Promise<void>;
  export function writeFile(
    path: string,
    data: Uint8Array | string,
    options?: {
      readonly encoding?: "utf8";
      readonly flag?: string;
      readonly mode?: number;
    }
  ): Promise<void>;
  export function access(path: string): Promise<void>;
  export function utimes(path: string, atime: Date, mtime: Date): Promise<void>;
}

declare module "node:path" {
  type PathApi = {
    readonly sep: string;
    isAbsolute(value: string): boolean;
    resolve(...values: readonly string[]): string;
    join(...values: readonly string[]): string;
    dirname(value: string): string;
    basename(value: string): string;
    relative(from: string, to: string): string;
  };
  const path: PathApi;
  export default path;
  export function extname(value: string): string;
  export function relative(from: string, to: string): string;
}

declare const process: {
  readonly pid: number;
  readonly execPath: string;
  readonly argv: readonly string[];
  exitCode?: number;
  cwd(): string;
  readonly stdout: { write(value: string): void };
  readonly stderr: { write(value: string): void };
  kill(pid: number, signal: 0 | "SIGINT" | "SIGTERM"): void;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
};
