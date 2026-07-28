export class JobError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "JobError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const errorCode = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;
