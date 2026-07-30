import { CliError } from "./errors.ts";

export const COMMANDS = [
  "init", "ingest", "scaffold-record", "commit-record", "validate",
  "import-asset", "render", "evaluate", "status", "resume", "package", "prune"
] as const;

export type CommandName = (typeof COMMANDS)[number];

const common = ["json", "force", "help"] as const;
const options = {
  init: ["slug", "target", "cards"],
  ingest: ["job", "url", "file", "allowed-root"],
  "scaffold-record": ["job", "stage"],
  "commit-record": ["job", "stage", "input"],
  validate: ["job", "stage"],
  "import-asset": ["job", "file", "allowed-root", "rights", "slot", "origin-note"],
  render: ["job"],
  evaluate: ["job", "deterministic-only"],
  status: ["job"],
  resume: ["job"],
  package: ["job", "format", "visual-pass-a", "visual-pass-b"],
  prune: ["slug", "dry-run"]
} as const satisfies Readonly<Record<CommandName, readonly string[]>>;

const booleans = new Set(["json", "force", "help", "deterministic-only", "dry-run"]);

export type ParsedArgs = {
  readonly command?: CommandName;
  readonly values: Readonly<Record<string, string | boolean>>;
  readonly help: boolean;
  readonly json: boolean;
};

const commandName = (value: string | undefined): CommandName | undefined =>
  COMMANDS.find((candidate) => candidate === value);

export const parseCliArgs = (argv: readonly string[]): ParsedArgs => {
  if (argv.length === 0) return { values: {}, help: true, json: false };
  if (argv[0] === "--help") return { values: {}, help: true, json: false };
  const command = commandName(argv[0]);
  const json = argv.includes("--json");
  if (command === undefined) {
    throw new CliError("usage", "UNKNOWN_COMMAND", "unknown command");
  }
  const allowed = new Set<string>([...common, ...options[command]]);
  const values: Record<string, string | boolean> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined || !argument.startsWith("--") || argument.length === 2) {
      throw new CliError("usage", "POSITIONAL_ARGUMENT", "positional arguments are not accepted");
    }
    const name = argument.slice(2);
    if (!allowed.has(name)) {
      throw new CliError("usage", "UNKNOWN_OPTION", `unknown option: --${name}`);
    }
    if (Object.hasOwn(values, name)) {
      throw new CliError("usage", "DUPLICATE_OPTION", `duplicate option: --${name}`);
    }
    if (booleans.has(name)) {
      values[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError("usage", "MISSING_OPTION_VALUE", `missing value for --${name}`);
    }
    values[name] = value;
    index += 1;
  }
  return {
    command,
    values,
    help: values["help"] === true,
    json: values["json"] === true || json
  };
};

export const requiredString = (args: ParsedArgs, name: string): string => {
  const value = args.values[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError("usage", "MISSING_REQUIRED_OPTION", `missing required option: --${name}`);
  }
  return value;
};

export const optionalString = (args: ParsedArgs, name: string): string | undefined => {
  const value = args.values[name];
  return typeof value === "string" ? value : undefined;
};

export const booleanOption = (args: ParsedArgs, name: string): boolean =>
  args.values[name] === true;

export const HELP = `Usage: cardnews <command> [options]

Commands:
  init
  ingest
  scaffold-record
  commit-record
  validate
  import-asset
  render
  evaluate
  status
  resume
  package
  prune

Common options:
  --json
  --force
  --help
`;
