export class RenderError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "RenderError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
