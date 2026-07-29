# Cardnews Foundry Render Design System

## Source extraction log

This system codifies the existing `portrait-social-1080x1350` target, the
`ink-paper` and `signal-night` theme packs, and the approved local Noto Sans CJK
KR Regular/Bold files. Those contracts are the visual source of truth.

- External brand references: N/A. This is an extraction from owned token
  contracts, and borrowing another product's design would violate the brief.
- Lazyweb product-screen research: N/A for the same reason.
- Imagen concept drafts: N/A. The renderer must expose the existing system,
  rather than introduce a new visual reference.
- React development tooling: N/A. The renderer and showcase are vanilla
  HTML/CSS driven by Playwright.
- Lighthouse SEO and public-page audits: N/A. This is a fixed, offline artifact
  renderer with no hosted, navigable, or indexable page. Real Chromium checks
  instead cover zero network, zero runtime errors, zero post-readiness layout
  shift, bounded render time, semantic/accessibility structure, contrast, exact
  fonts, overflow, and complete screenshots.

## 1. Atmosphere & Identity

Cardnews Foundry is precise, calm Korean editorial communication. Each card has
one thesis, an unmistakable sequence, generous safe margins, and an authored
relationship between text and evidence. Controlled composition changes carry
the seven-card narrative; decorative gradients, blobs, emoji, generic SaaS
panels, and template repetition do not.

`ink-paper` feels archival and tactile through warm paper contrast, fine rules,
and offset paper surfaces. `signal-night` feels technical and focused through a
deep field, cool signal accent, compact corners, and grid-led structure. Both
themes preserve the same semantic hierarchy and primitives.

## 2. Color

Every rendered color is a theme token. Browser mechanics may use transparent
only where required for image decoding; exported cards remain opaque.

| Semantic token | `ink-paper` | `signal-night` | Use |
| --- | --- | --- | --- |
| `--color-canvas` | `#F6F0E4` | `#10131F` | Page field |
| `--color-surface` | `#FFFDF8` | `#1B2033` | Raised/inset surface |
| `--color-text-primary` | `#17212B` | `#F8FAFF` | Headlines and primary copy |
| `--color-text-secondary` | `#52606D` | `#B6C2D9` | Body support and provenance |
| `--color-accent` | `#C95B2B` | `#67E8F9` | Sequence, accent rule, key stat |
| `--color-rule` | `#D8CDBB` | `#33415E` | Dividers, frames, diagram edges |
| `--shadow-soft-color` | `#D8CDBB` | `#33415E` | Soft depth variant |
| `--shadow-strong-color` | `#52606D` | `#10131F` | Strong depth variant |

Primary and secondary text must meet WCAG 2.2 AA against the surface on which
they appear: 4.5:1 for body/caption text and 3:1 for large text and essential
graphics. Accent is never the only carrier of meaning.

## 3. Typography

Only the approved local family `Noto Sans CJK KR` may render text. Regular maps
to `fonts/NotoSansCJKkr-Regular.otf` and Bold maps to
`fonts/NotoSansCJKkr-Bold.otf`. A missing exact face, fallback glyph, or tofu
code point is a blocking error.

| Role | `ink-paper` | `signal-night` |
| --- | --- | --- |
| Display | Bold, 92px, 1.05, -0.04em | Bold, 84px, 1.10, -0.03em |
| Headline | Bold, 62px, 1.16, -0.02em | Bold, 58px, 1.20, -0.01em |
| Body | Regular, 34px, 1.48, 0 | Regular, 32px, 1.52, 0.01em |
| Caption | Regular, 24px, 1.35, 0.02em | Regular, 22px, 1.40, 0.04em |

Korean copy wraps by authored semantic phrases. Particles, endings, predicates,
connectives, short clauses, and citations must not become isolated lines.
Headlines use `word-break: keep-all` and balanced authored line groups; body
copy uses token-aware phrase spans when natural wrapping cannot guarantee the
meaning. The reusable policy protects Korean number-plus-counter constructions,
quantity relations around `중`, topic/predicate clauses ending in `아니라`, and
safe adnominal modifier-plus-noun groups. It preserves the original visible
copy, never shortens it, and applies nonbreaking spans only to detected phrases.
All showcase primitive text uses `word-break: keep-all`; responsive width and
type tokens prevent a single Korean word from splitting by syllable. Line boxes
receive enough height for CJK metrics and descenders.

## 4. Spacing & Layout

The base rhythm is 4px. Named theme spacing values remain exact source mappings,
including values between base-unit steps.

| Token | `ink-paper` | `signal-night` |
| --- | --- | --- |
| `--space-1` | 8px | 6px |
| `--space-2` | 16px | 12px |
| `--space-3` | 24px | 20px |
| `--space-4` | 40px | 32px |
| `--space-5` | 64px | 52px |
| `--space-6` | 96px | 84px |

Browser-mechanics tokens are `--unit: 4px`, `--page-width: 1080px`,
`--page-height: 1350px`, `--safe-top: 120px`, `--safe-right: 96px`,
`--safe-bottom: 120px`, `--safe-left: 96px`, `--safe-width: 888px`, and
`--safe-height: 1110px`.

`ink-paper` supports a six-column `editorial-column` grid with 24px gutters and
a four-column `paper-inset` grid with 16px gutters. `signal-night` supports an
eight-column `signal-grid` with 20px gutters and a two-column `night-split` with
32px gutters. Text and critical media anchors stay inside the exact safe area.
Decorative rules may approach the page edge only when they cannot carry content
or become visually clipped.

Responsive showcase mechanics use declared tokens:
`--showcase-max: 1280px`, `--showcase-gutter: 24px`,
`--showcase-tile-min: 320px`, `--focus-width: 4px`,
`--showcase-stage-color: #ECEFF3`, `--showcase-ink-color: #17212B`,
`--showcase-border-color: #52606D`, `--showcase-accent-color: #C95B2B`,
`--showcase-breakpoint: 600px`, `--showcase-media-height: 320px`,
`--showcase-filter-muted: grayscale(1) opacity(.35)`, and
`--motion-none: 0s`, `--showcase-body-max: 28px`, plus named showcase
title/body/minimum-height tokens
declared in the shared stylesheet. Because media-query conditions cannot consume
custom properties, the breakpoint is emitted from the same JavaScript token
source as the CSS variables. The showcase reflows without horizontal overflow
at 375px, 768px, 1280px, and 200% zoom. Exported cards do not responsively
resize; they are fixed artifacts.

Fixed composition tokens are `--hero-height: 410px`,
`--split-left: 300px`, `--split-right: 1fr`,
`--split-media-height: 420px`, `--card-section-gap: 24px`,
`--card-content-gap: 32px`, and `--footer-paint-clearance: 8px`.
Full-bleed `background` and `texture` media use
`--background-image-filter: brightness(.32) saturate(.9)` so editorial text
keeps theme contrast while the image remains a legible atmospheric layer.
The safe area is a three-row grid: max-content sequence, a measured content
region, and max-content provenance. Section gaps and the footer clearance are
included in the 1110px safe-height budget. Composition children use their
measured max-content heights and cannot flex-shrink into adjacent text; the
content region remains the bounded failure surface if future copy exceeds its
budget.

Diagram geometry uses `--diagram-node-basis: 196px`,
`--diagram-line-basis: 64px`, and `--diagram-item-gap: 12px`. Three nodes, two
connectors, four gaps, theme padding, borders, and available inner width are
budgeted together. Nodes and connectors use explicit non-shrinking flex bases;
no item may touch, overlap, or leave the diagram’s inner bounds.
`--closing-size: 48px` remains the closing emphasis size. Contact-sheet
mechanics use `--contact-aspect: 4 / 5`, `--sheet-width: 1080px`,
`--sheet-height: 1480px`, `--sheet-columns: 3`,
`--sheet-padding: 40px`, `--sheet-gap: 24px`, and
`--sheet-title: 48px`. These values may appear only in the central token source;
render modules consume their CSS variables.

## 5. Components

All product compositions are assemblies of these semantic primitives. Variants
change anatomy through named classes or `data-variant` values, never through
per-card raw style values.

### Card shell

`article.card-shell` is the 1080×1350 opaque page and owns theme application.
States: `default`, `paper-inset`, `editorial-column`, `signal-grid`, and
`night-split`. It may contain full-bleed `.background-media` before one
`.safe-area` in semantic reading order. The safe area allocates sequence,
`.card-content`, and provenance as explicit grid rows.
The middle region composes measured, non-shrinking primitives with declared
gaps; it must fit its remaining row without relying on clipping or hidden
overflow.

### Sequence marker

`.sequence-marker` renders current card and total as text, with an accent rule.
States: `quiet`, `accent`, and `terminal`. The number is not iconography and
remains legible without color.

### Headline block

`header.headline-block` contains an optional eyebrow and one `h1`. Variants:
`display`, `headline`, `compact`, and `closing`. Authored phrase spans protect
Korean line meaning. Eyebrow margin and header padding include Noto glyph-paint
extents, so `Range.getClientRects()` for the eyebrow and headline cannot
intersect even when their CSS line boxes remain separate.

### Body/evidence block

`.body-block` contains supporting copy; `.evidence-block` adds a semantic label
and source-linked statement. States: `plain`, `ruled`, `inset`, and `warning`.
Instruction-like source text is inert escaped text.

### Media frame

`figure.media-frame` contains a descriptor-bound local image and `figcaption`
when needed. Variants: `hero`, `illustration`, `contained`, and `diagram`.
Every meaningful image has exact alt text; decorative elements use empty alt
text and cannot replace content. In the showcase, only an inner
`.media-viewport` receives the fixed media-height token; the caption and
following accent rule remain in normal document flow. Browser QA checks every
primitive rectangle, direct-flow sibling pair, client/scroll extent, and media
child boundary in both themes at every required viewport.

### Accent rule, stat, quote, and callout

`.accent-rule` is a non-text structural divider.
`.stat-block` pairs a prominent value with a label.
`blockquote.quote-block` provides quoted or highlighted evidence without
inventing quotation marks.
`.callout-block` provides `note`, `insight`, and `warning` states with a visible
text label, so state is not color-only.

### Provenance footer

`footer.provenance-footer` closes every card with story identity, semantic role,
and stable card identifier. Variants: `standard` and `closing`. It stays within
the bottom safe inset and never overlaps body content. Its declared bottom
clearance keeps the complete Noto glyph-paint rectangle, not only the element
line box, above the safe-area bottom.

### Contact-sheet tile

`figure.contact-sheet-tile` contains exactly one complete card image and a
visible card/order caption. States: `default` and `selected` for the showcase
only. Production contact sheets contain seven default tiles exactly once in
render order.

### Showcase controls

Theme selectors are real radio inputs inside a fieldset with visible labels,
keyboard focus, checked state, and no network action. They are harness-only and
never appear in exported cards.

## 6. Motion & Interaction

Exported cards and contact sheets are static. No decorative animation is
accepted. Showcase theme controls may change theme immediately because that
interaction conveys selected state; the transition token is
`--transition-theme: 160ms ease-out`. Under `prefers-reduced-motion: reduce`,
the transition duration is `--motion-none`. Muted non-selected showcase panels
use `--showcase-filter-muted`. Focus uses the declared 4px focus-width token and
a theme accent outline with sufficient offset.

There are no hover effects on non-interactive primitives. Harness controls
support keyboard focus, checked, and disabled semantics using native elements.

## 7. Depth & Surface

`ink-paper` uses an offset-paper strategy: a surface fill, standard rule, medium
radius, and the source soft shadow (`0 12px 24px --shadow-soft-color`). A strong
variant (`0 24px 48px --shadow-strong-color`) is reserved for the hero media
frame; depth levels are not stacked.

`signal-night` uses a bordered-signal strategy: a surface fill, standard rule,
small/medium radius, and the source soft shadow
(`0 8px 20px --shadow-soft-color`). Its strong variant
(`0 20px 40px --shadow-strong-color`) is reserved for an active showcase tile
or hero frame. No blur, glass, gradient, or unsupported elevation recipe is
introduced.

Radius mappings are exact: `ink-paper` small/medium/large are 12/24/40px;
`signal-night` small/medium/large are 4/12/20px. Stroke mappings are exact:
hairline/standard are 1/3px for `ink-paper` and 1/2px for `signal-night`.

## 8. Accessibility Constraints & Accepted Debt

Constraints:

- Semantic HTML reading order mirrors visual order: sequence, headline, body or
  evidence, media, then provenance.
- Meaningful media carries the validated recipe alt text.
- Exact local font load and glyph coverage are blocking.
- No page, declared text/media box, or safe-area boundary may overflow or clip.
- Direct flow regions are accepted only when both element rectangles and
  `Range.getClientRects()` text-paint rectangles preserve semantic order with
  no intersection. Every declared box must fit its allowed nearest layout
  container and have non-overflowing client/scroll dimensions.
- Diagram nodes and connectors are pairwise non-overlapping, remain inside the
  diagram bounds, and retain explicit fixed bases under both pinned Chromium
  and Chrome Stable.
- Provenance element and text-paint rectangles remain wholly inside both page
  and safe-area bounds, including the declared footer paint clearance.
- Body and caption contrast is at least 4.5:1; large text and essential graphics
  are at least 3:1.
- Showcase controls are keyboard operable, visibly focused, and correctly
  labelled at every required width and 200% zoom.
- Reduced-motion users receive no transition.
- Runtime readiness is accepted only after fonts, images, and two stable layout
  frames, with zero network requests, runtime errors, and layout shift.
- Every protected Korean phrase range occupies one measured line at the target
  output and required showcase states; generic counter, quantity,
  topic/predicate, and adnominal stress phrases are browser-tested.
- Full-page 200% screenshots are forbidden beyond the safe compositor bound.
  The zoom state is captured as three bounded, contiguous semantic segments:
  intro plus controls, the complete `ink-paper` panel, and the complete
  `signal-night` panel. Segment rectangles have no gaps, overlap, or duplicated
  content and each PNG is signature-, dimension-, hash-, and
  freshness-validated.

Accepted debt: none. Critical or Major visual, accessibility, CJK, determinism,
or evidence findings block release. Cross-OS byte identity remains a T14
canonical-Linux CI concern; native host identity is recorded honestly while two
same-profile runs are required now.
