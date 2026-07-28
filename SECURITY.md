# Security policy

## Supported versions

Before the v1 public release, security fixes are applied to the current default
branch only. After v1, the latest v1 minor release and the default branch receive
security fixes. Unsupported schema major versions remain fail-closed rather than
being migrated implicitly.

## Report a vulnerability

After publication, use the repository's GitHub **Report a vulnerability** form
to open a private security advisory. Do not file a public issue for a suspected
vulnerability and do not include real credentials, private article text,
production jobs, cookies, browser profiles, or personal data in a report.

Include:

- affected commit and platform;
- the smallest synthetic reproduction;
- expected and observed exit class or boundary;
- impact on source ingestion, path confinement, rights, private jobs, rendering,
  packaging, or release contents;
- whether the issue requires network access.

If private advisories are temporarily unavailable, disclose only that the
channel is unavailable in a public issue; do not post exploit or private data.
Maintainers will acknowledge a private report, assess severity, and coordinate a
fix and disclosure timeline in the advisory.

## Security boundaries

The project assumes all URL responses, local source text, article metadata,
asset metadata, prior job contents, and external review output are untrusted.
The deterministic CLI, not prose in those inputs, controls execution.

- URL ingestion accepts public HTTP(S) text-like content only, revalidates DNS
  and redirects, pins the validated connection address, and sends no ambient
  credentials or browser state.
- Local ingestion is confined to the real parent of the requested file and
  rejects traversal, symlink escapes, special files, and oversized/disallowed
  content.
- Rendering is offline and uses pinned browser/font inputs.
- Private jobs stay under `.cardnews/jobs/` and are excluded from source and
  release inventories.
- Asset rights and source provenance are mandatory publication gates.
- Generated bundles and source archives reject secrets, absolute paths, raw or
  full-text source snapshots, browser/agent state, special nodes, unsafe ZIP
  paths, compression bombs, and prohibited extensions.
- Pull-request CI has read-only repository permissions, receives no project
  secrets, uploads no generated/private artifact, and pins every action to a
  full audited commit SHA.

## Handling source material

Only process material you are authorized to access and transform. Use
synthetic, public-domain, licensed, generated, or explicitly user-provided
fixtures when reporting issues. A security report must never use the
DeepSeek/Frontier Note case-study article, its copy, assets, or snapshots as a
reproduction fixture.

