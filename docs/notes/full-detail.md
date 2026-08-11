# Full detail: `expand *` and nested frames

**Status: settled (2026-08).** The DSL's one whole-ladder spelling, and the only
way frames nest.

## The problem

A view opens exactly one level of depth. That rule is load-bearing — SPEC §5's
rule stack, DESIGN §5's "depth is one step, not a ladder", and mechanically the
layout's flattening of frames into single-level ELK compounds, where a nested
frame arrived childless and came back 0×0 with its label floating free. The
consequence: a reader who wants the whole architecture at leaf level on one
page had to click into containers one at a time, losing every other
container's detail each time. Auditors and print-it-on-a-wall people
(they exist, they are legion) had no answer at all.

## What shipped

`expand *` — recursively open every container visible in the view, to leaf
depth, frames nesting as they go. One statement (`view full { expand * }`),
running at the expand step of the rule stack, so `scope`/`only`/`context`/
`exclude` compose unchanged. Explicit nested expands (`expand a` +
`expand a.b`) **stay an error**; the error's fix now also names `expand *`.

The machinery: `VFrame` carries `frame` (immediate parent — the same field a
`VNode` has), layout projects framed things to their *outermost* frame for
ranking and recurses `framedChildren` through `entityElk` so ELK receives real
nested compounds, `PFrame` carries `depth`, and the renderer paints frames
depth-sorted with the recessed `surfaceAlt` fill at depth 0 only — deeper
frames are border + label.

## Decisions, and the alternatives they beat

- **`expand *`, not a new verb.** `include *` already means "widen membership
  to everything"; `expand *` is the same shape on the depth axis, guessable by
  a cold agent. `flatten`/`unfold` would be a second word for a concept the
  language already spells; a render-time option would put a visibility decision
  outside the view model, and every surface would need its own toggle instead
  of reading one view.
- **Explicit nested expands stay an error.** One spelling per rung. A
  half-ladder (`expand a.b` without `a.b.c`) is exactly the "which levels am I
  looking at?" ambiguity the one-level rule exists to prevent; whole-or-one is
  crisp, piecemeal is not.
- **No auto-synthesized full view.** The per-container auto views exist so
  zoom always has somewhere to land; nothing dives *to* a full view, so the
  mechanical reason doesn't apply. Synthesis would cost a reserved name (and a
  fight with containers named `full`), a picker entry byte-identical to the
  landscape on every flat model, and "nest one container and a new view
  appears" spookiness. The user picked DSL-only surfacing deliberately: one
  declared line, and every surface (SPA picker, HTML deck, CLI `--view`,
  VS Code select) inherits it. SKILL.md teaches the idiom.
- **No SPA/HTML viewer toggle** — same reasoning from the other side: a
  toggle would be a second, view-model-bypassing spelling of the same thing.
- **Fill at depth 0 only.** The zones argument, verbatim: a tint compounds
  where boundaries nest, so a doubly-nested frame would read darker than
  either parent and surface weight would encode depth rather than "opened".
  Rejected: alternating fills (a checkerboard reads as meaning where there is
  none), per-depth alpha (translucency stacks — the compounding bug with extra
  steps). Choosing "depth 0 exactly as today" also keeps every existing render
  byte-identical, which the golden suite verifies for free.
- **Empty containers stay cards.** A childless frame is the 0×0 failure the
  one-level rule guarded against, and the "everything" view must never be the
  one view that silently drops an element.

## Deferred, with triggers

- **Density warning** ("this full view has N nodes"): not actionable — the
  author asked for everything and got it; `scope x` + `expand *` is the remedy
  and SKILL.md says so. Revisit if gauntlet rounds show agents shipping
  unreadable full views without noticing.
- **Frame header chrome** (icon, kind chip on frames): the full page is *made
  of* frames, so any header addition multiplies into DESIGN §8's "container
  soup". A frame hides nothing, so its label is a caption, not a summary.
  Revisit if the lookbook's `31-full-detail` stops reading at 3+ depths; the
  recorded fallback is a one-notch label-size step at depth ≥ 1.
- **Partial ladders** (`expand a.*`, depth limits): no named use case. The
  nested-expand error keeps pointing at scoped views and `expand *`.

## Perf

The bench's 500ms budget case was named "the fully-expanded 200-node view"
from the start; it is now literally `expand *`, so the budget test is the
feature's perf test.
