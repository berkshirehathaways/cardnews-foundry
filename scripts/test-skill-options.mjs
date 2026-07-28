const usage = "usage: test-skill.mjs [--target <skill-path>] [--fresh-context]";

export const parseTestSkillArgs = (argv) => {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let target = "";
  let freshContext = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--fresh-context" && !freshContext) {
      freshContext = true;
      continue;
    }
    if (
      arg === "--target" &&
      target === "" &&
      args[index + 1] !== undefined &&
      args[index + 1] !== "" &&
      !args[index + 1].startsWith("--")
    ) {
      target = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(usage);
  }
  if (target !== "" && freshContext) throw new Error(usage);
  return { target, freshContext };
};
