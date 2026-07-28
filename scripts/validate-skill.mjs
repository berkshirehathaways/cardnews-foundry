#!/usr/bin/env node
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class SkillValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SkillValidationError";
    this.code = code;
  }
}

const regularFile = async (target, code) => {
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") {
      throw new SkillValidationError(code, `missing required skill file: ${target}`);
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new SkillValidationError(code, `skill file must be regular: ${target}`);
  }
};

const frontmatter = (markdown) => {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(markdown);
  if (match === null) {
    throw new SkillValidationError("SKILL_FRONTMATTER", "SKILL.md frontmatter is missing");
  }
  const fields = new Map();
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new SkillValidationError("SKILL_FRONTMATTER", "SKILL.md frontmatter is malformed");
    }
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return fields;
};

export const validateSkill = async (skillRoot) => {
  const markdownPath = path.join(skillRoot, "SKILL.md");
  const metadataPath = path.join(skillRoot, "agents", "openai.yaml");
  await Promise.all([
    regularFile(markdownPath, "SKILL_FILE"),
    regularFile(metadataPath, "SKILL_METADATA"),
  ]);
  const [markdown, metadata] = await Promise.all([
    readFile(markdownPath, "utf8"),
    readFile(metadataPath, "utf8"),
  ]);
  const fields = frontmatter(markdown);
  if (fields.get("name") !== "cardnews-foundry" || (fields.get("description")?.length ?? 0) < 32) {
    throw new SkillValidationError("SKILL_IDENTITY", "skill name or description is invalid");
  }
  for (const required of ["display_name:", "short_description:", "default_prompt:"]) {
    if (!metadata.includes(required)) {
      throw new SkillValidationError("SKILL_METADATA", `agents/openai.yaml is missing ${required}`);
    }
  }
  if (!metadata.includes("$cardnews-foundry")) {
    throw new SkillValidationError("SKILL_ROUTING", "default prompt does not route to $cardnews-foundry");
  }
  const references = [...markdown.matchAll(/\]\((references\/[^)]+)\)/gu)].map((match) => match[1]);
  for (const relative of new Set(references)) {
    if (relative.split("/").length !== 2) {
      throw new SkillValidationError("SKILL_REFERENCE_DEPTH", "skill references must be one level deep");
    }
    await regularFile(path.join(skillRoot, relative), "SKILL_REFERENCE");
  }
  return {
    ok: true,
    skillRoot,
    references: [...new Set(references)].sort((left, right) => left.localeCompare(right, "en")),
  };
};

const isMain = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const target = process.argv[2];
  if (target === undefined || process.argv.length !== 3) {
    process.stderr.write("usage: validate-skill.mjs <skill-root>\n");
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(await validateSkill(path.resolve(target)))}\n`);
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        code: error instanceof SkillValidationError ? error.code : "SKILL_VALIDATION_FAILED",
      })}\n`);
      process.exitCode = 1;
    }
  }
}

