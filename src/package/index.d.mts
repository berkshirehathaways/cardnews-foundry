import type { JobHandle } from "../jobs/index.ts";

export type PackageJobResult = {
  readonly outputPath: string;
  readonly packageId: string;
  readonly sha256: string;
  readonly manifestDigest: string;
  readonly reused: boolean;
  readonly entryCount: number;
};

export function packagePrivateJob(input: {
  readonly job: JobHandle;
  readonly repositoryRoot: string;
  readonly passAPath: string;
  readonly passBPath: string;
  readonly failpoint?: "before-publish";
}): Promise<PackageJobResult>;

