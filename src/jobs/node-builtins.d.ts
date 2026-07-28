declare module "node:crypto" {
  export function randomUUID(): string;
}

declare module "node:fs" {
  export const constants: {
    readonly COPYFILE_EXCL: number;
  };
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

declare module "node:fs/promises" {
  type Stats = {
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  };

  type FileHandle = {
    writeFile(data: Uint8Array | string): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  };

  export function open(path: string, flags: string, mode?: number): Promise<FileHandle>;
  export function mkdir(path: string, options: { readonly recursive: boolean }): Promise<string | undefined>;
  export function realpath(path: string): Promise<string>;
  export function lstat(path: string): Promise<Stats>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function rm(path: string, options?: { readonly force?: boolean; readonly recursive?: boolean }): Promise<void>;
  export function rmdir(path: string): Promise<void>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
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
