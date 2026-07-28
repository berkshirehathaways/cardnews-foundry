declare module "node:crypto" {
  type Hash = {
    update(data: Uint8Array): Hash;
    digest(encoding: "hex"): string;
  };
  export function createHash(algorithm: "sha256"): Hash;
}

declare module "node:fs" {
  export function readFileSync(path: URL, encoding: "utf8"): string;
}
