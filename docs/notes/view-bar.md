# Note — the view bar, and the shapes it beat

Engineering note, not a requirement. The view bar is how a reader moves between
views in the playground, its presenter and the interactive export (DESIGN §11).
This records why it is a breadcrumb of menus (2026-09), so the alternatives are
not rebuilt from memory.

## The problem it answers

The bar it replaced was a flat row of tabs, one per view. That works at five
views and fails at twelve, and twelve is ordinary: every container earns an
auto view, so a modest nested model lists a dozen before anyone writes a
`view` block. The row scrolled sideways, and the view you were on could sit
out of sight. The tabs also flattened the one thing squinch's views have that
slides do not, which is altitude: `orders-pci` and `catalog` sat side by side
as equals.

## What it is

`viewBar(views, activeView)` in `view/navigate.ts` is the whole description.
The SPA (`apps/spa/src/ViewBar.tsx`) and the export runtime
(`render/html/runtime.ts`) only draw it, so the two cannot disagree about
what a hop holds.

- **Home.** The unscoped view, or else the first one. The `Home` key goes to
  the same place in both presenters. When it is the only view at the top, it
  takes no hop of its own.
- **One hop per ancestor** of the scope you stand in. Each hop is a menu of the
  views of its sibling containers. The first view at a scope stands for that
  container: the first-match rule `viewForPath` and `crumbs` already keep.
- **A lens hop** appears when several views look at the container you are in.
  **An inside hop** (`N inside`) appears when containers below it have views.
  Both are italic, marking a level you can open but are not on.
- **Flows sit apart.** A flow view is filed in its own menu, never in the path:
  a story belongs to no one altitude. When there is one flow, it is a plain
  link, not a menu of one.
- **Presenting, the bar can be put away outright** with `B` or its own button.
  A sliver at the top edge brings it back on hover or click, so no shortcut
  has to be known. It stays put away for the rest of the talk, not just until
  the next step.

## Room

The bar shares the top edge of the stage with nothing it has to avoid. The
editor toggle became an icon, and the render-time readout moved down beside
the zoom pill, since it describes the stage too. That gave the bar about
200px back, which is what it needed when the editor is open at 1280.

When it still does not fit, it folds in steps and never overlaps:

1. Labels truncate, ancestors harder than the hop you stand on.
2. The outer ancestors fold away. Home and a backdrop click still climb.
3. The flows pill drops to its icon.
4. The nearest ancestor folds too.
5. The hop you stand on truncates hard.

A ghost hop never truncates. "4 inside" is short, and says nothing once cut.
The level is **measured**: render, see whether the bar fits its strip, fold
one more, all before paint. The ViewBar does it in a layout effect and the
export's runtime in `fold()`. Container queries were tried first and could
not do it. A flex item's automatic minimum is its full unwrapped label, so the
hops either would not shrink or shrank past their own caret and slid under
the next pill. A menu is kept on screen by shifting it left, measured against
`clientWidth` rather than `innerWidth`: an open menu that overflows widens the
layout viewport, and `innerWidth` then reports the widened page. On a phone
the export hides its zoom buttons, since pinch-to-zoom covers them.

## Rejected (explored on a design canvas before any code)

- **Tabs with overflow** (`+9 ▾`). This was the smallest change. The visible
  tabs are the first few declared, not the useful ones, and the view you are on
  can still sit inside the overflow menu.
- **One picker pill** (`‹ Order Service 5 / 14 ▾ ›` opening a searchable,
  grouped list). It scales cleanly and steps in order. It hides altitude,
  though: where you stand in the model is one click away rather than on screen.
- **The picker with a path inside its popover.** This was the merge of the
  two. It kept the bar as one pill, but the breadcrumb that showed the model
  was only visible while open, and reading it was the point.
- **Outline rail and thumbnail grid.** These were good for browsing a large
  export, but each is a second surface rather than a better bar.
- **Filmstrip and chapter progress bar** for presentation. They replace the
  dots, but a presenter needs to go *somewhere*, not see how far along they
  are. The `n / N` counter already says that.
- **A minimised state** between shown and hidden. It was tried and dropped:
  presenters wanted the picture, and a pill with the title on it was one more
  thing on the slide.

## Things that bit

- Escape in presentation goes to the browser first. A fullscreen page does not
  hear the key before the browser leaves fullscreen, and leaving fullscreen
  leaves the deck. So "an open menu owns Escape" holds only where fullscreen
  was refused (an iframe) or never entered. The export e2e asserts it outside
  presentation for that reason.
- The hidden bar's handle disappears the moment hovering it works. Playwright's
  own `hover()` reads that as a failure and retries until the timeout, so the
  tests move the mouse by hand.
