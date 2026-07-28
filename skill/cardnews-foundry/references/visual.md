# Visual and review method

## Assets and composition

- Use generated, user-provided, licensed, or public-domain assets only with recorded origin and rights.
- Import each asset through the CLI before binding it to a recipe slot.
- Give every meaningful image accessible alternative text.
- Use theme tokens and semantic layout primitives. Do not paste card-specific CSS.
- Vary composition intentionally while preserving typography, spacing, color, radius, stroke, and footer systems.

## Korean typography

- Break lines at semantic phrase boundaries, not arbitrary character counts.
- Keep particles, dependent nouns, numbers with units, and compact proper names together where possible.
- Inspect actual glyph bounds for clipping, overlap, orphans, and awkward punctuation.
- Verify hierarchy and readability at full card size and in the contact sheet.

## Required visual evidence

After the latest edit, capture every ordered card and one contact sheet. Require a complete inventory with current render and capture identities.

Use two independent reviews:

1. Pass A checks completeness, dimensions, fonts, overflow signals, reusable layout structure, and design-system consistency.
2. Pass B opens every card and the contact sheet to inspect Korean line breaks, clipping, typography, hierarchy, pacing, and cross-card consistency.

Prefer separate Codex reviewers when available. Without that capability, keep the
passes methodologically independent: complete Pass A first, then restart from the
raw captures for Pass B without copying Pass A's findings. Record two truthful,
distinct Codex reviewer IDs and verdict IDs. Do not stop at a missing-verdict
package response when the user asked for a finished ZIP.

Use the contact sheet for inventory and sequence, not for pixel-level defect
claims. Before reporting clipping, collision, or overlap, reopen each affected
card at original resolution and confirm the exact elements and location with
visible pixel occlusion or measured intersecting bounds. Intentionally
left/right-aligned footer items are not overlapping merely because both appear
on one baseline. If the original card and deterministic geometry show
separation, record no blocking defect; never infer one from scaled text,
anti-aliasing, or contact-sheet compression.

Write review inputs to `<job>/drafts/visual-pass-a.input.json` and
`<job>/drafts/visual-pass-b.input.json`. The package command alone owns the
canonical immutable `reports/visual-pass-a.json` and
`reports/visual-pass-b.json` outputs; never use those reserved paths as inputs.

Require both reviews to reference the same current render set, source revision,
evidence paths, capture timestamp, and complete capture set. Any missing card,
stale evidence, blocking clipping, broken Korean phrase, or inconsistent digest
fails regardless of aggregate score.
