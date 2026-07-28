export class PackageError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "PackageError";
    this.code = code;
    this.exitClass = 6;
    if (details !== undefined) this.details = details;
  }
}

