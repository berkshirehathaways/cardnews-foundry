# Methodology

## From creative work to deterministic checkpoints

Cardnews production mixes judgment with mechanical work. This project keeps the
boundary explicit:

1. Codex derives a sourced editorial brief from sanitized spans.
2. It commits a semantic storyboard without renderer details.
3. Assets receive explicit provenance and rights before binding.
4. A visual recipe and render spec freeze the creative handoff.
5. The local CLI renders, evaluates, captures, and packages immutable inputs.
6. Copy changes create a revision and invalidate only dependent downstream work.

This makes editorial decisions inspectable without claiming that generative
authoring itself is reproducible.

## DeepSeek and Frontier Note case study

An earlier DeepSeek/Liang Wenfeng cardnews run, based on a public Frontier Note
page, was reviewed only to identify workflow lessons: source-linked claims,
separation of story from layout, reusable design tokens, bounded copy repair,
fresh complete-set review, and a deterministic package boundary.

No article text, card copy, source snapshot, image, browser capture, production
record, or rendered artifact from that run is included here. The synthetic
orbital-record fixture was authored independently and is the only canonical
public end-to-end fixture. A live Frontier Note request is non-blocking smoke
coverage only; availability, extraction, rights, and content can change.

## Verification model

Deterministic verification covers schemas, provenance, dependency digests,
rights, rendering environment, output bytes, archive inventory, and release
safety. Visual judgment is represented by two independently identified verdict
records bound to one current render and capture set. The synthetic clean-clone
scenario uses clearly labeled fixture adapter records only to exercise package
mechanics; it is not evidence that a production design passed human or Codex
visual review.

The release gate starts from a clean clone, uses a frozen install and isolated
tool caches, performs a real synthetic CLI init-to-package run, compares two
canonical renders, validates skill discovery, and inspects both generated and
source archives before temporary files are removed.

