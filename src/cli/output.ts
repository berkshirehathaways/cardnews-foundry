import { canonicalJson } from "../contracts/index.ts";
import { DetailedCliError, type CliError } from "./errors.ts";

export type SuccessEnvelope = {
  readonly ok: true;
  readonly command: string;
  readonly result: unknown;
};

export const writeSuccess = (
  command: string,
  result: unknown,
  json: boolean
): void => {
  if (json) {
    process.stdout.write(`${canonicalJson({ ok: true, command, result })}\n`);
    return;
  }
  process.stderr.write(`${command}: ${humanResult(result)}\n`);
};

export const writeFailure = (error: CliError, json: boolean): void => {
  const value = {
    ok: false,
    error: {
      class: error.errorClass,
      code: error.code,
      message: error.message,
      ...(error instanceof DetailedCliError ? { details: error.details } : {})
    }
  };
  if (json) {
    process.stdout.write(`${canonicalJson(value)}\n`);
    return;
  }
  process.stderr.write(`error [${error.errorClass}/${error.code}]: ${error.message}\n`);
};

const humanResult = (value: unknown): string => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "ok";
  const nextCommand = Reflect.get(value, "nextCommand");
  if (typeof nextCommand === "string") return nextCommand;
  const jobPath = Reflect.get(value, "jobPath");
  if (typeof jobPath === "string") return jobPath;
  const outputPath = Reflect.get(value, "outputPath");
  if (typeof outputPath === "string") return outputPath;
  return "ok";
};
