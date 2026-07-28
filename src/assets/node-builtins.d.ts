declare module "node:fs/promises" {
  export function mkdir(
    path: string,
    options: { readonly recursive: boolean; readonly mode?: number }
  ): Promise<string | undefined>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function stat(path: string): Promise<Stats>;
  export function chmod(path: string, mode: number): Promise<void>;
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

  export function createInflate(): InflateStream;
  export function inflateSync(
    data: Uint8Array,
    options: { readonly maxOutputLength: number; readonly info: true }
  ): InflateInfo;
}
