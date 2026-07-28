# Record and CLI contract

Use the CLI as the authority for paths, versions, dependencies, and validation. Do not hand-create record filenames or bypass scaffold/commit.

## Stage order

1. `SourceEnvelope`: sanitized source metadata, stable source spans, provenance, rights status, and raw digest.
2. `EditorialBrief`: audience, thesis, evidence-backed claims, exclusions, tone, and card-count intent.
3. `Storyboard`: ordered semantic scenes with claim and source-span links. Exclude HTML, CSS, pixels, and provider parameters.
4. `VisualRecipe`: composition intent, asset bindings, emphasis, mood, and accessibility text.
5. `RenderSpec`: target, theme, dimensions, codec, card order, and render environment.

Every record is strict, versioned, canonical JSON. Preserve scaffolded schema fields and dependency digests. Reject unknown fields and unsupported major versions.

## Deterministic handoff

Run:

```text
scaffold-record --job <job> --stage <stage>
commit-record --job <job> --stage <stage> --input <returned-draft>
status --job <job> --json
```

Edit only `<returned-draft>`. Require a successful immutable receipt before advancing. Use `status` after interruption or any dependency change; stale downstream outputs must be regenerated.

## Output contract

Treat exit `0` as success. Handle expected failures by class:

- `2`: usage or schema failure.
- `3`: source, rights, provenance, or workspace security failure.
- `4`: render or environment failure.
- `5`: blocking QA failure.
- `6`: package or release-safety failure.

Unexpected exit `1` is internal. Report the redacted error and preserve the job for diagnosis.
