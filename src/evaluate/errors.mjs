export class EvaluationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "EvaluationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
