import { createHash } from "node:crypto";
import { inspectImage, type AssetRecord } from "../assets/index.ts";
import { canonicalJsonBytes, validateContract } from "../contracts/index.ts";
import type { JobHandle } from "../jobs/index.ts";
import { listAnchored, readAnchoredBytes } from "#jobs/anchored";
import { CliError } from "./errors.ts";

type VerifiedAsset = {
  readonly assetName: string;
  readonly assetBytes: Uint8Array;
  readonly metadataBytes: Uint8Array;
  readonly metadata: AssetRecord;
};

const digestPattern = /^[a-f0-9]{64}$/u;
const assetPattern = /^asset\.(?:png|jpg)$/u;
const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((byte, index) => right[index] === byte);
const fail = (): never => {
  throw new CliError("security", "ASSET_INTEGRITY_INVALID", "accepted asset integrity check failed");
};
const string = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const nonBlankString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const utcTimestamp = (value: unknown): value is string => {
  if (!string(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const parseMetadata = (bytes: Uint8Array): AssetRecord => {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fail();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail();
  const record = value as Readonly<Record<string, unknown>>;
  const binding = record["binding"];
  const blockers = record["publicPackageBlockers"];
  const originNote = record["originNote"];
  const expectedKeys = new Set([
    "schemaVersion", "assetDigest", "originalRelativePath", "byteCount", "detectedMime",
    "width", "height", "alpha", "rights", "importedAt", "binding", "publicEligible",
    "publicPackageBlockers",
    ...(originNote === undefined ? [] : ["originNote"])
  ]);
  if (
    Object.keys(record).some((key) => !expectedKeys.has(key)) ||
    Object.keys(record).length !== expectedKeys.size ||
    record["schemaVersion"] !== 1 ||
    !string(record["assetDigest"]) ||
    !string(record["originalRelativePath"]) ||
    !positiveInteger(record["byteCount"]) ||
    !["image/png", "image/jpeg"].includes(String(record["detectedMime"])) ||
    !positiveInteger(record["width"]) ||
    !positiveInteger(record["height"]) ||
    !["present", "opaque"].includes(String(record["alpha"])) ||
    !["generated", "user-provided", "licensed", "public-domain", "unknown"].includes(String(record["rights"])) ||
    !utcTimestamp(record["importedAt"]) ||
    typeof binding !== "object" || binding === null ||
    !string(Reflect.get(binding, "cardId")) ||
    !string(Reflect.get(binding, "slot")) ||
    typeof record["publicEligible"] !== "boolean" ||
    !Array.isArray(blockers) ||
    blockers.some((entry) => typeof entry !== "string") ||
    (originNote !== undefined && !string(originNote)) ||
    (record["rights"] !== "user-provided" && !nonBlankString(originNote))
  ) return fail();
  return value as AssetRecord;
};

export const readVerifiedAsset = async (
  job: JobHandle,
  recipe: unknown,
  digest: string
): Promise<VerifiedAsset> => {
  if (!digestPattern.test(digest)) return fail();
  const validation = validateContract("VisualRecipe", recipe);
  if (!validation.ok) return fail();
  const bindings = validation.value.cards.flatMap((card) =>
    card.assetBindings
      .filter((binding) => binding.assetDigest === digest)
      .map((binding) => ({ ...binding, cardId: card.cardId }))
  );
  if (bindings.length !== 1) return fail();
  const binding = bindings[0];
  if (binding === undefined) return fail();
  const scope = `assets/${digest}` as const;
  const names = [...await listAnchored(job, scope)].sort();
  const assetNames = names.filter((name) => assetPattern.test(name));
  if (
    names.length !== 2 ||
    names[0] === undefined ||
    !names.includes("metadata.json") ||
    assetNames.length !== 1
  ) return fail();
  const assetName = assetNames[0];
  if (assetName === undefined) return fail();
  const [assetBytes, metadataBytes] = await Promise.all([
    readAnchoredBytes(job, scope, assetName),
    readAnchoredBytes(job, scope, "metadata.json")
  ]);
  if (sha256(assetBytes) !== digest) return fail();
  const metadata = parseMetadata(metadataBytes);
  const image = inspectImage(assetBytes);
  const publicEligible = binding.rights !== "unknown";
  const expectedBlockers = publicEligible ? [] : ["ASSET_RIGHTS_UNKNOWN"];
  if (
    metadata.assetDigest !== digest ||
    metadata.byteCount !== assetBytes.byteLength ||
    metadata.detectedMime !== image.mime ||
    metadata.width !== image.width ||
    metadata.height !== image.height ||
    metadata.alpha !== image.alpha ||
    metadata.rights !== binding.rights ||
    metadata.binding.cardId !== binding.cardId ||
    metadata.binding.slot !== binding.slot ||
    metadata.publicEligible !== publicEligible ||
    metadata.publicPackageBlockers.length !== expectedBlockers.length ||
    metadata.publicPackageBlockers.some((entry, index) => entry !== expectedBlockers[index]) ||
    (assetName.endsWith(".png") ? image.mime !== "image/png" : image.mime !== "image/jpeg") ||
    !sameBytes(metadataBytes, canonicalJsonBytes(metadata))
  ) return fail();
  return { assetName, assetBytes, metadataBytes, metadata };
};
