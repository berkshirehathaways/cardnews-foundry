export type Sha256 = string;
export type SchemaVersion = string;

export type SourceSpan = {
  readonly id: string;
  readonly text: string;
  readonly order: number;
};

export type SourceEnvelope = {
  readonly schemaVersion: SchemaVersion;
  readonly sourceId: string;
  readonly title: string;
  readonly spans: readonly SourceSpan[];
  readonly provenance: {
    readonly originalLocator: string;
    readonly finalLocator: string;
    readonly redirectChain: readonly string[];
    readonly retrievedAt: string;
    readonly rawSha256: Sha256;
    readonly rawByteCount: number;
    readonly declaredMime: string;
    readonly detectedMime: string;
    readonly parser: { readonly name: string; readonly version: string };
    readonly extractedSpanIds: readonly string[];
    readonly rightsStatus: "generated" | "user-provided" | "licensed" | "public-domain" | "unknown";
    readonly transformations: readonly string[];
  };
};

export type EditorialBrief = {
  readonly schemaVersion: SchemaVersion;
  readonly briefId: string;
  readonly sourceEnvelopeDigest: Sha256;
  readonly audience: string;
  readonly thesis: string;
  readonly claims: readonly {
    readonly id: string;
    readonly text: string;
    readonly sourceSpanIds: readonly string[];
  }[];
  readonly exclusions: readonly string[];
  readonly tone: string;
  readonly cardCountIntent: number;
};

export type Storyboard = {
  readonly schemaVersion: SchemaVersion;
  readonly storyboardId: string;
  readonly editorialBriefDigest: Sha256;
  readonly cards: readonly {
    readonly id: string;
    readonly order: number;
    readonly role: "hook" | "context" | "evidence" | "insight" | "closing";
    readonly headline: string;
    readonly body: string;
    readonly claimIds: readonly string[];
    readonly sourceSpanIds: readonly string[];
  }[];
};

export type VisualRecipe = {
  readonly schemaVersion: SchemaVersion;
  readonly recipeId: string;
  readonly storyboardDigest: Sha256;
  readonly targetId: string;
  readonly themeId: string;
  readonly cards: readonly {
    readonly cardId: string;
    readonly composition: "headline" | "split" | "quote" | "diagram" | "closing";
    readonly mood: string;
    readonly emphasis: readonly string[];
    readonly assetBindings: readonly {
      readonly slot: string;
      readonly assetDigest: Sha256;
      readonly rights: "generated" | "user-provided" | "licensed" | "public-domain" | "unknown";
      readonly originNote?: string;
      readonly altText: string;
    }[];
    readonly accessibilityText: string;
  }[];
};

export type RenderSpec = {
  readonly schemaVersion: SchemaVersion;
  readonly renderSpecId: string;
  readonly visualRecipeDigest: Sha256;
  readonly target: { readonly id: string; readonly version: string };
  readonly theme: { readonly id: string; readonly version: string };
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly codec: "png" | "jpeg";
  readonly cardOrder: readonly string[];
  readonly environment: {
    readonly platform: string;
    readonly browser: string;
    readonly browserRevision: string;
    readonly locale: string;
    readonly timezone: string;
    readonly deviceScaleFactor: number;
  };
};

export type RenderArtifact = {
  readonly schemaVersion: SchemaVersion;
  readonly artifactId: string;
  readonly renderSpecDigest: Sha256;
  readonly cardId: string;
  readonly relativePath: string;
  readonly mediaType: "image/png" | "image/jpeg";
  readonly mediaSignature: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: Sha256;
  readonly dependencyDigests: readonly Sha256[];
};

export type EvaluationReport = {
  readonly schemaVersion: SchemaVersion;
  readonly evaluationId: string;
  readonly renderSetDigest: Sha256;
  readonly blocking: boolean;
  readonly gates: readonly {
    readonly id: string;
    readonly status: "pass" | "fail";
    readonly evidencePaths: readonly string[];
  }[];
  readonly evaluatorVersions: Readonly<Record<string, string>>;
};

export type VisualVerdictRecord = {
  readonly schemaVersion: SchemaVersion;
  readonly verdictId: string;
  readonly renderSetDigest: Sha256;
  readonly captureSetDigest: Sha256;
  readonly sourceRevision: string;
  readonly reviewer: { readonly id: string; readonly kind: "codex" | "external-adapter" | "human" };
  readonly evidenceIdentity: { readonly paths: readonly string[]; readonly capturedAt: string };
  readonly category: "design-system" | "visual-fidelity" | "cjk-precision" | "combined";
  readonly differences: readonly {
    readonly cardId: string;
    readonly kind: string;
    readonly severity: "info" | "warning" | "blocking";
    readonly description: string;
  }[];
  readonly blockers: readonly string[];
  readonly verdict: "PASS" | "FAIL";
};

export type PackageManifest = {
  readonly schemaVersion: SchemaVersion;
  readonly packageId: string;
  readonly files: readonly {
    readonly relativePath: string;
    readonly size: number;
    readonly mediaType: "image/png" | "image/jpeg" | "application/json" | "text/plain";
    readonly sha256: Sha256;
  }[];
  readonly recordDigests: readonly Sha256[];
  readonly dependencyVersions: Readonly<Record<string, string>>;
};

export type ContractMap = {
  readonly SourceEnvelope: SourceEnvelope;
  readonly EditorialBrief: EditorialBrief;
  readonly Storyboard: Storyboard;
  readonly VisualRecipe: VisualRecipe;
  readonly RenderSpec: RenderSpec;
  readonly RenderArtifact: RenderArtifact;
  readonly EvaluationReport: EvaluationReport;
  readonly VisualVerdictRecord: VisualVerdictRecord;
  readonly PackageManifest: PackageManifest;
};

export type ContractName = keyof ContractMap;
export type Contract = ContractMap[ContractName];
