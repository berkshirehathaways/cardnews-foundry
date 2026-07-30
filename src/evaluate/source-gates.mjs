import { canonicalSha256, validateContract } from "../contracts/index.ts";

const allowedMime = new Set(["text/html", "application/xhtml+xml", "text/plain", "text/markdown"]);
const forbiddenDomainKey = /^(?:html|css|pixels?|provider|providerSdk|model|prompt)$/iu;

const schemaOk = (name, value) => validateContract(name, value).ok;
const sequential = (values) => values.every((value, index) => value === index);
const unique = (values) => new Set(values).size === values.length;

const forbiddenIpv4 = (host) => {
  const octets = host.split(".").map((value) => Number.parseInt(value, 10));
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && [0, 2, 168].includes(second)) ||
    (first === 198 && [18, 19, 51].includes(second)) ||
    (first === 203 && second === 0);
};

const forbiddenNetworkHost = (rawHost) => {
  const host = rawHost.replace(/^\[|\]$/gu, "").toLowerCase();
  return host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    forbiddenIpv4(host) ||
    /^(?:::|::1$|f[cd][0-9a-f]*:|fe[89ab][0-9a-f]*:|ff[0-9a-f]*:|2001:db8:)/iu.test(host);
};

const locatorSafe = (locator) => {
  try {
    const url = new URL(locator);
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      !forbiddenNetworkHost(url.hostname);
  } catch {
    return !locator.startsWith("/") && !locator.includes("\\") && !locator.split("/").includes("..");
  }
};

const containsForbiddenDomainKey = (value) => {
  if (Array.isArray(value)) return value.some(containsForbiddenDomainKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, nested]) =>
    forbiddenDomainKey.test(key) || containsForbiddenDomainKey(nested)
  );
};

export const sourceAndStoryGates = (input) => {
  const { source, editorial, storyboard } = input.records;
  const spanIds = source.spans?.map((span) => span.id) ?? [];
  const spanSet = new Set(spanIds);
  const claims = editorial.claims ?? [];
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const storyboardCards = storyboard.cards ?? [];
  return [
    ["source-schema", () => schemaOk("SourceEnvelope", source)],
    ["source-mime-size", () =>
      allowedMime.has(source.provenance.detectedMime) &&
      allowedMime.has(source.provenance.declaredMime) &&
      source.provenance.rawByteCount <= 5 * 1024 * 1024],
    ["source-provenance", () =>
      source.provenance.rawSha256 === input.sourceFile.sha256 &&
      source.provenance.rawByteCount === input.sourceFile.size &&
      source.provenance.parser.name.trim() !== "" &&
      source.provenance.transformations.length > 0],
    ["source-security", () =>
      locatorSafe(source.provenance.originalLocator) &&
      locatorSafe(source.provenance.finalLocator) &&
      source.provenance.redirectChain.every(locatorSafe)],
    ["source-span-integrity", () =>
      unique(spanIds) &&
      sequential(source.spans.map((span) => span.order)) &&
      source.provenance.extractedSpanIds.length === spanIds.length &&
      source.provenance.extractedSpanIds.every((id, index) => id === spanIds[index])],
    ["editorial-schema", () => schemaOk("EditorialBrief", editorial)],
    ["claim-source-coverage", () =>
      claims.every((claim) =>
        unique(claim.sourceSpanIds) && claim.sourceSpanIds.every((spanId) => spanSet.has(spanId))
      )],
    ["editorial-card-profile", () =>
      editorial.cardCountIntent >= input.target.cardCount.minimum &&
      editorial.cardCountIntent <= input.target.cardCount.maximum],
    ["storyboard-schema", () => schemaOk("Storyboard", storyboard)],
    ["storyboard-order", () =>
      unique(storyboardCards.map((card) => card.id)) &&
      sequential(storyboardCards.map((card) => card.order))],
    ["storyboard-card-count", () =>
      storyboardCards.length === editorial.cardCountIntent &&
      storyboardCards.length >= input.target.cardCount.minimum &&
      storyboardCards.length <= input.target.cardCount.maximum],
    ["storyboard-claim-inheritance", () => {
      const inherited = new Set(storyboardCards.flatMap((card) => card.claimIds));
      return claims.every((claim) => inherited.has(claim.id)) &&
        storyboardCards.every((card) => card.claimIds.every((claimId) => {
          const claim = claimById.get(claimId);
          return claim !== undefined &&
            claim.sourceSpanIds.every((spanId) => card.sourceSpanIds.includes(spanId));
        }));
    }],
    ["storyboard-domain-purity", () => !containsForbiddenDomainKey(storyboard)],
    ["record-dependency-chain", () =>
      editorial.sourceEnvelopeDigest === canonicalSha256(source) &&
      storyboard.editorialBriefDigest === canonicalSha256(editorial)],
    ["editorial-headline-length", () =>
      storyboardCards.every((card) =>
        card.headline.trim().length >= 1 && card.headline.length <= 40)],
    ["editorial-thesis-focus", () =>
      storyboardCards.every((card) =>
        card.body.length <= 120 && (card.body.match(/[.!?。！？]/gu) ?? []).length <= 3)],
    ["editorial-headline-variety", () =>
      unique(storyboardCards.map((card) => card.headline.trim().split(/\s+/u)[0]))]
  ];
};
