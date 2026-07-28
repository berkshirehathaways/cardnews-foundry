# Troubleshooting and lifecycle

## CLI setup

If `scripts/cardnews.mjs` reports that the repository CLI is unavailable, restore the repository and run:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

Do not replace the runner with an ad hoc path to another checkout.

## Job recovery

- Run `status --job <job> --json` after interruption.
- Run `resume --job <job> --json` to obtain the exact next action.
- If a stage is stale, repair the earliest stale dependency and regenerate downstream records.
- If rendering fails, preserve the job and inspect the typed render/environment failure. Do not disable font, network, geometry, or evidence gates.
- For `DOM_CLIPPING`, inspect `error.details`: `className`, client dimensions,
  and scroll dimensions identify the overflowing primitive. Repair copy in at
  most three attempts:
  1. Read `status --json` and the accepted record named by its digest. Scaffold
     the implicated record; never edit an immutable record.
  2. For headline/body/quote/closing overflow, shorten or restructure only the
     affected Storyboard copy. For diagram/callout/evidence overflow, shorten
     the affected VisualRecipe `mood` or `emphasis`, or select another supported
     composition when meaning is preserved.
  3. Preserve every claim and source-span relationship. Remove repetition and
     keep Korean semantic phrases intact; do not add unsupported claims.
  4. Commit the changed record with `--force` to create a downstream revision.
     Run `status`, then recommit every stale downstream record in order.
  5. Rerender the new revision. Never reuse the prior render, captures, or
     visual verdicts. If the new typed finding differs, repair that finding in
     the next bounded attempt.
- Never repair clipping by editing renderer/CSS, target dimensions, safe-area
  tokens, font sizes, line heights, or spacing below the `DESIGN.md` minima.
  After three failed copy repairs, preserve the newest revision and report its
  typed finding plus the exact `resume` action.
- After a copy revision, regenerate stale downstream records from the first stale stage; do not re-ingest an unchanged source or reuse prior render/capture/verdict output.
- A scaffold is not a completed recovery step. For each stale downstream stage,
  read the prior accepted record identified by `status`, preserve its applicable
  content, replace the scaffolded dependency digest, commit, run `status` again,
  and continue through render, deterministic evaluation, and the package
  boundary. Stop early only for a typed blocker that cannot be safely resolved
  from the source and accepted records.
- If QA evidence is stale or incomplete, recapture without editing product files.
- If package reports missing, stale, non-independent, or blocking visual evidence, preserve the job and import two fresh normalized verdicts for the current render. Never substitute a manually assembled ZIP.

## Skill lifecycle

From the repository root:

```sh
corepack pnpm skill:install -- --target /Users/stevenshin/.codex/skills/cardnews-foundry
corepack pnpm skill:status -- --target /Users/stevenshin/.codex/skills/cardnews-foundry
corepack pnpm skill:update -- --target /Users/stevenshin/.codex/skills/cardnews-foundry
corepack pnpm skill:uninstall -- --target /Users/stevenshin/.codex/skills/cardnews-foundry --trash
```

Install refuses existing targets unless `--replace` names the exact verified symlink to this repository. Update requires a clean tracking checkout and accepts fast-forward changes only before frozen install, build, and validation. Uninstall moves only a verified skill symlink to Trash; it preserves the repository and all jobs.
