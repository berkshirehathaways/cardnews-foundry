import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_JOB_ROOT } from "#jobs/paths";

// Revision working artifacts are fully regenerable from the retained records and
// source. Only superseded (non-tip) revisions are pruned; durable lineage
// (records, source, head.json, job.json) and the published bundle (package) stay.
const PRUNABLE_SUBDIRS = ["render", "assets", "drafts", "reports"] as const;

type RevisionHead = {
  readonly id: string;
  readonly slug: string;
  readonly revision: number;
  readonly parentJobId?: string;
};

export type PruneOptions = {
  readonly root?: string;
  readonly slug?: string;
  readonly dryRun?: boolean;
};

export type PrunedRevision = {
  readonly jobId: string;
  readonly slug: string;
  readonly revision: number;
  readonly removed: readonly string[];
};

export type PruneResult = {
  readonly dryRun: boolean;
  readonly pruned: readonly PrunedRevision[];
  readonly keptRevisions: readonly string[];
};

const readRevisionHead = async (root: string, id: string): Promise<RevisionHead | undefined> => {
  let raw: string;
  try {
    raw = await readFile(path.join(root, id, "head.json"), "utf8");
  } catch {
    return undefined;
  }
  let head: unknown;
  try {
    head = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof head !== "object" || head === null) return undefined;
  const jobId = Reflect.get(head, "jobId");
  const slug = Reflect.get(head, "slug");
  const revision = Reflect.get(head, "revision");
  const parentJobId = Reflect.get(head, "parentJobId");
  if (jobId !== id || typeof slug !== "string" || typeof revision !== "number") return undefined;
  return {
    id,
    slug,
    revision,
    ...(typeof parentJobId === "string" ? { parentJobId } : {})
  };
};

// A revision is superseded when another revision in the same lineage names it as
// its parent. Superseded revisions can never be the current head, so their heavy
// working artifacts are safe to reclaim.
export const pruneSupersededRevisions = async (options: PruneOptions = {}): Promise<PruneResult> => {
  const root = path.resolve(options.root ?? DEFAULT_JOB_ROOT);
  const dryRun = options.dryRun === true;
  let names: readonly string[];
  try {
    names = await readdir(root);
  } catch {
    return { dryRun, pruned: [], keptRevisions: [] };
  }
  const revisions: RevisionHead[] = [];
  for (const name of names) {
    const head = await readRevisionHead(root, name);
    if (head !== undefined) revisions.push(head);
  }
  const scoped = options.slug === undefined
    ? revisions
    : revisions.filter((revision) => revision.slug === options.slug);
  const scopedIds = new Set(scoped.map((revision) => revision.id));
  const superseded = new Set<string>();
  for (const revision of scoped) {
    if (revision.parentJobId !== undefined && scopedIds.has(revision.parentJobId)) {
      superseded.add(revision.parentJobId);
    }
  }
  const pruned: PrunedRevision[] = [];
  const kept: string[] = [];
  for (const revision of scoped) {
    if (!superseded.has(revision.id)) {
      kept.push(revision.id);
      continue;
    }
    let present: readonly string[];
    try {
      present = await readdir(path.join(root, revision.id));
    } catch {
      present = [];
    }
    const removable = PRUNABLE_SUBDIRS.filter((subdir) => present.includes(subdir));
    if (removable.length === 0) {
      kept.push(revision.id);
      continue;
    }
    if (!dryRun) {
      for (const subdir of removable) {
        await rm(path.join(root, revision.id, subdir), { recursive: true, force: true });
      }
    }
    pruned.push({
      jobId: revision.id,
      slug: revision.slug,
      revision: revision.revision,
      removed: removable
    });
  }
  return { dryRun, pruned, keptRevisions: kept };
};
