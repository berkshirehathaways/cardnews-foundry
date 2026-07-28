export class IngestSecurityError extends Error {
  readonly name = "IngestSecurityError";
  readonly exitClass = 3;
  readonly code: string;

  constructor(
    code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.code = code;
  }
}

export const errorCode = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;
