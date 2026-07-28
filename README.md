# cardnews-foundry

`cardnews-foundry` is a local Codex workflow for creating, revising, validating,
rendering, visually reviewing, and packaging Korean or multilingual cardnews.
Codex makes editorial and visual decisions; this repository provides the
deterministic, inspectable CLI around those decisions. It has no hosted service,
provider API client, social publisher, or npm registry release.

## Requirements and setup

The supported toolchain is Node.js `24.18.0`, Corepack, pnpm `11.15.1`, and
Playwright `1.62.0` with Chromium revision `1234`. The two bundled Noto Sans CJK
KR font files are verified locally; setup does not download article or production
assets.

```sh
git clone <repository-url> cardnews-foundry
cd cardnews-foundry
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm verify:bootstrap
corepack pnpm build
corepack pnpm test:all
```

On Linux, install Playwright's system packages and Chromium together:

```sh
corepack pnpm exec playwright install --with-deps chromium
```

`verify:bootstrap` checks Node, pnpm, Playwright/Chromium, font digests and
licenses, and the absence of private or generated production artifacts. The
canonical CI baseline is the pinned Linux environment in `toolchain.json`;
macOS is supported for local production.

If bundled fonts need to be restored from the official pinned archive:

```sh
corepack pnpm fonts:fetch
corepack pnpm verify:fonts
```

## Install and maintain the Codex skill

The lifecycle commands operate on a symlink to this checkout. They refuse silent
replacement, non-fast-forward updates, and deletion of an unverified target.

```sh
SKILL_TARGET="${CODEX_HOME:-$HOME/.codex}/skills/cardnews-foundry"
corepack pnpm skill:install -- --target "$SKILL_TARGET"
corepack pnpm skill:status -- --target "$SKILL_TARGET"
corepack pnpm skill:update -- --target "$SKILL_TARGET"
corepack pnpm skill:uninstall -- --target "$SKILL_TARGET" --trash
```

Update requires a clean tracking checkout, verifies a fast-forward, then runs a
frozen install, build, and skill validation. Uninstall moves only the verified
symlink to Trash; the repository and private jobs remain untouched.

## Supported inputs and exact requests

URL ingestion supports public HTTP(S) HTML, XHTML, Markdown, and plain-text
pages. Local ingestion supports `.html`, `.htm`, `.md`, and `.txt`; direct CLI
use must pass the file's real parent as the exact `--allowed-root`. PDFs,
authenticated pages, paywall bypass, browser sessions, private/special-use
network addresses, and other file types are outside v1.

Korean:

```text
이 링크를 8장짜리 세로형 카드뉴스로 만들어줘: https://example.com/article
이 로컬 글로 인스타그램용 카드뉴스 8장을 만들어줘: /absolute/path/article.md
지난 카드뉴스 작업 .cardnews/jobs/<job>을 이어서 렌더링하고 ZIP으로 묶어줘.
이 카드뉴스 .cardnews/jobs/<job>의 문구만 고치고 다시 검수해줘.
```

English:

```text
Create an 8-card portrait cardnews from this link: https://example.com/article
Create an 8-card Instagram cardnews from this local article: /absolute/path/article.md
Resume the cardnews job at .cardnews/jobs/<job>, render it, and package it as a ZIP.
Revise only the copy in .cardnews/jobs/<job> and run the reviews again.
```

The installed skill drives `init`, `ingest`, scaffold/commit, asset import,
render, evaluation, and package commands. Run `./bin/cardnews --help` for the
stable command inventory.

## Jobs, revisions, and source security

Each job is private under the requesting workspace:

```text
.cardnews/jobs/<slug>-<digest>/
```

Raw and extracted source, authored records, imported assets, render HTML/cards,
reports, and packages stay there and must not be committed or uploaded. URL
retrieval sends no cookies, authorization headers, browser state, or ambient
credentials. Redirects and resolved addresses are revalidated; size, MIME, and
deadline limits fail closed. Extracted article text is untrusted evidence, never
instructions.

For a local file, the allowed root is only that file's real parent. Traversal,
symlink escapes, device files, FIFOs, and sockets are rejected.

Jobs use immutable, digest-linked checkpoints. After interruption, ask Codex to
resume or run:

```sh
./bin/cardnews status --job .cardnews/jobs/<job> --json
./bin/cardnews resume --job .cardnews/jobs/<job> --json
```

A copy change creates a new revision; it never overwrites prior accepted
records. Unchanged source and evidence-linked upstream checkpoints are reused,
while stale downstream records, renders, captures, verdicts, and packages are
regenerated.

## Rights, visual QA, and packaging

Every asset is imported with an origin note, slot, digest, and one rights class:
`generated`, `user-provided`, `licensed`, `public-domain`, or `unknown`.
Unknown rights may remain in a private draft but block public packaging. You are
responsible for having the right to ingest, transform, and distribute source
material and assets.

After the latest edit, the workflow checks all cards and the contact sheet for
dimensions, signatures, font loading, network access, overflow, and clipping.
Two fresh independent reviews must inspect the same complete capture set:

1. Pass A covers functional integrity and design-system consistency.
2. Pass B covers visual fidelity, Korean semantic line breaks, typography,
   hierarchy, clipping, pacing, and cross-card consistency.

Any missing card, stale evidence, rights failure, unsupported claim, or blocking
finding prevents packaging. The generated ZIP contains only final cards, the
contact sheet, attribution and source-summary metadata, an evaluation summary,
and `manifest.json`. It excludes raw source, full authored records, prompts,
private paths, and browser or agent state.

On success, Codex returns clickable local links to:

- `<job>/package/<slug>-cardnews.zip`
- `<job>/render/accepted/contact-sheet.png`
- `<job>/render/accepted/cards/`

## Reproducibility boundary

The reproducibility claim begins after the editorial brief, storyboard, visual
recipe, asset bytes, and render spec are validated and frozen. Codex authoring is
outside the claim: repeating a creative request is not guaranteed to produce the
same editorial or visual choices.

The same frozen records, asset bytes, target/theme versions, and render
environment produce byte-identical normalized card, contact-sheet, record, and
manifest hash sets. ZIP entries use stable ordering, permissions, compression,
and timestamps. Pixel equality is claimed only within the same recorded
environment. Canonical Linux runs are compared byte-for-byte; cross-OS runs are
checked semantically and visually.

Verify the boundary locally:

```sh
corepack pnpm verify:determinism -- fixtures/synthetic
corepack pnpm verify:release -- --dry-run
corepack pnpm verify:clean-clone
```

Before the first commit, `verify:clean-clone` makes a publication-safe Git
snapshot of non-ignored source, preserving executable bits, then clones and
tests it. Once `HEAD` exists, it automatically clones that exact commit and
fails if tracked files are modified or releasable untracked files exist. Its
isolated Corepack, pnpm, browser, and skill caches prove the checkout does not
depend on local `node_modules`, private jobs, evidence, or agent state.

## Public API stability

Stable v1 surfaces are the versioned JSON schemas and `$id` values, canonical
JSON/digest rules, documented CLI command names and exit classes, output
locations, generated bundle manifest, target profiles, and theme-pack
contracts. Internal TypeScript modules, skill wording, optional review adapters,
and any future hosted/provider boundary are experimental.

Readers support schema major version `1`. Unsupported majors fail closed; there
is no migration engine. Regenerate from the last validated checkpoint with a
compatible reader. See
[`src/contracts/VERSION_COMPATIBILITY.md`](src/contracts/VERSION_COMPATIBILITY.md).

## Troubleshooting

- Toolchain mismatch: use `.node-version`, run `corepack enable`, reinstall with
  `--frozen-lockfile`, then run `verify:bootstrap`.
- Missing Chromium: run `corepack pnpm exec playwright install chromium` (with
  `--with-deps` on Linux), then rerun `verify:bootstrap`.
- Font failure: run `fonts:fetch`, then `verify:fonts`; do not substitute an
  unlicensed or system-only font.
- Interrupted or stale job: run `status` and `resume`; follow the returned path
  and command without editing immutable records.
- `DOM_CLIPPING`: revise only the implicated copy/composition in a new bounded
  revision; do not weaken geometry, typography, spacing, or evidence gates.
- Package exit `6`: resolve missing/stale independent visual verdicts, rights,
  prohibited content, or archive safety findings. Never hand-assemble the ZIP.

Detailed recovery guidance lives in
[`skill/cardnews-foundry/references/troubleshooting.md`](skill/cardnews-foundry/references/troubleshooting.md).
Security reporting and supported-version policy are in [`SECURITY.md`](SECURITY.md).

## Methodology note

The earlier DeepSeek/Liang Wenfeng cardnews run and the public Frontier Note page
were used only as a methodology case study: they informed the decomposition
into sourced editorial checkpoints, semantic storyboards, deterministic
rendering, copy-revision loops, and complete-set visual review. This repository
does not copy or redistribute that article, its card copy, its assets, its
rendered output, or a page snapshot. The live page may be attempted only as a
non-blocking smoke test because third-party availability and content can drift.
See [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).

## License and attribution

Repository code and documentation are licensed under
[Apache License 2.0](LICENSE).

Bundled `NotoSansCJKkr-Regular.otf` and `NotoSansCJKkr-Bold.otf` are from the
official Noto CJK Sans `2.004` release and are redistributed under the
[SIL Open Font License 1.1](fonts/LICENSE-OFL-1.1.txt). Exact upstream archive,
file digests, and license coverage are recorded in
[`fonts/manifest.json`](fonts/manifest.json). Apache-2.0 does not replace or
modify the fonts' OFL-1.1 terms.

