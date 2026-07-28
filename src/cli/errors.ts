import { AssetError } from "../assets/index.ts";
import { IngestSecurityError } from "../ingest/index.ts";
import { JobError } from "../jobs/index.ts";

export const EXIT_CODES = {
  internal: 1,
  usage: 2,
  security: 3,
  render: 4,
  qa: 5,
  package: 6
} as const;

export type ErrorClass = keyof typeof EXIT_CODES;

export type DomClippingDetails = {
  readonly kind: "dom-clipping";
  readonly className: string;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
};

export class CliError extends Error {
  readonly errorClass: ErrorClass;
  readonly code: string;
  readonly exitCode: number;

  constructor(errorClass: ErrorClass, code: string, message: string) {
    super(message);
    this.name = "CliError";
    this.errorClass = errorClass;
    this.code = code;
    this.exitCode = EXIT_CODES[errorClass];
  }
}

export class DetailedCliError extends CliError {
  readonly details: DomClippingDetails;

  constructor(input: {
    readonly errorClass: ErrorClass;
    readonly code: string;
    readonly message: string;
    readonly details: DomClippingDetails;
  }) {
    super(input.errorClass, input.code, input.message);
    this.name = "DetailedCliError";
    this.details = input.details;
  }
}

const securityJobCodes = new Set([
  "PATH_ESCAPE", "SYMLINK_ESCAPE", "DEVICE_PATH", "NON_REGULAR_PATH",
  "LOCK_PATH_UNSAFE", "LOCK_NOT_OWNED"
]);

const safeJobCode = (code: string): string => {
  if (code === "JOB_EXISTS") return "JOB_EXISTS";
  if (code === "STAGE_IMMUTABLE") return "IMMUTABLE_CHECKPOINT";
  if (code === "MISSING_DEPENDENCY") return "MISSING_DEPENDENCY";
  return code;
};

export const classifyError = (error: unknown): CliError => {
  if (error instanceof CliError) return error;
  if (error instanceof IngestSecurityError) {
    if (error.code === "MISSING_ALLOWED_ROOT") {
      return new CliError("usage", error.code, "local ingestion requires --allowed-root");
    }
    return new CliError("security", error.code, "source ingestion was rejected by security policy");
  }
  if (error instanceof AssetError) {
    return new CliError("security", error.code, "asset import was rejected by security or rights policy");
  }
  if (error instanceof JobError) {
    const errorClass = securityJobCodes.has(error.code) ? "security" : "usage";
    return new CliError(errorClass, safeJobCode(error.code), "job operation was rejected");
  }
  if (error instanceof SyntaxError) {
    return new CliError("usage", "INVALID_JSON", "input JSON is invalid");
  }
  if (error instanceof Error && error.name === "RenderError") {
    const details = domClippingDetails(error);
    if (details !== undefined) {
      return new DetailedCliError({
        errorClass: "render",
        code: safeExternalCode(error),
        message: "rendering failed",
        details
      });
    }
    return new CliError("render", safeExternalCode(error), "rendering failed");
  }
  if (error instanceof Error && error.name === "EvaluationError") {
    return new CliError("qa", safeExternalCode(error), "evaluation failed");
  }
  if (error instanceof Error && error.name === "PackageError") {
    return new CliError("package", safeExternalCode(error), "package or release gate failed");
  }
  return new CliError("internal", "INTERNAL_ERROR", "internal failure");
};

const safeExternalCode = (error: Error): string => {
  const code = Reflect.get(error, "code");
  return typeof code === "string" && /^[A-Z][A-Z0-9_]*$/u.test(code) ? code : "INTERNAL_ERROR";
};

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const domClippingDetails = (error: Error): DomClippingDetails | undefined => {
  if (safeExternalCode(error) !== "DOM_CLIPPING") return undefined;
  const details = Reflect.get(error, "details");
  if (typeof details !== "object" || details === null) return undefined;
  const className = Reflect.get(details, "className");
  const client = Reflect.get(details, "client");
  const scroll = Reflect.get(details, "scroll");
  if (
    typeof className !== "string" ||
    typeof client !== "object" || client === null ||
    typeof scroll !== "object" || scroll === null
  ) return undefined;
  const clientWidth = finiteNumber(Reflect.get(client, "width"));
  const clientHeight = finiteNumber(Reflect.get(client, "height"));
  const scrollWidth = finiteNumber(Reflect.get(scroll, "width"));
  const scrollHeight = finiteNumber(Reflect.get(scroll, "height"));
  if (
    clientWidth === undefined ||
    clientHeight === undefined ||
    scrollWidth === undefined ||
    scrollHeight === undefined
  ) return undefined;
  return {
    kind: "dom-clipping",
    className,
    clientWidth,
    clientHeight,
    scrollWidth,
    scrollHeight
  };
};
