import {
  HELP,
  parseCliArgs,
  type CommandName,
  type ParsedArgs
} from "./args.ts";
import { classifyError } from "./errors.ts";
import {
  ingestCommand,
  initCommand,
  resumeCommand,
  statusCommand,
  validateCommand
} from "./lifecycle.ts";
import { writeFailure, writeSuccess } from "./output.ts";
import {
  commitRecordCommand,
  evaluateCommand,
  importAssetCommand,
  packageCommand,
  renderCommand,
  scaffoldRecordCommand
} from "./production.ts";

const assertNever = (value: never): never => {
  throw new TypeError(`unsupported command: ${String(value)}`);
};

const dispatch = (command: CommandName, args: ParsedArgs): Promise<unknown> => {
  switch (command) {
    case "init": return initCommand(args);
    case "ingest": return ingestCommand(args);
    case "scaffold-record": return scaffoldRecordCommand(args);
    case "commit-record": return commitRecordCommand(args);
    case "validate": return validateCommand(args);
    case "import-asset": return importAssetCommand(args);
    case "render": return renderCommand(args);
    case "evaluate": return evaluateCommand(args);
    case "status": return statusCommand(args);
    case "resume": return resumeCommand(args);
    case "package": return packageCommand(args);
    default: return Promise.reject(assertNever(command));
  }
};

export const runCli = async (argv: readonly string[]): Promise<number> => {
  const requestedJson = argv.includes("--json");
  try {
    const args = parseCliArgs(argv);
    if (args.help || args.command === undefined) {
      process.stdout.write(HELP);
      return 0;
    }
    writeSuccess(args.command, await dispatch(args.command, args), args.json);
    return 0;
  } catch (error) { // no-excuse-ok: catch -- top-level CLI boundary redacts unknown failures.
    const classified = classifyError(error);
    writeFailure(classified, requestedJson);
    return classified.exitCode;
  }
};

process.exitCode = await runCli(process.argv.slice(2));
