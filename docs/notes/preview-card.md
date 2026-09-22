# The detailed card: `preview <path>`

**Status: settled (2026-09).** The altitude between a collapsed card and an
expanded frame, and why it is a taller card rather than a smaller frame.

## The problem

A collapsed system is a 96px card whose shelf shows three child icons at 16px
and a `+N`. Expanding it draws every child in a frame. There was nothing
between, and a real reader wanted one: "show the landscape, and on the Order
Service card name the three parts people know" — a callout of what is inside,
not a full opening. Three chips with no names do not do that; a frame does too
much, and pulls every wire down to the part it reaches.

Two things were wrong, and both shipped together:

1. **`preview: [api db]` did not parse.** SPEC §3 had promised
   `none | auto | [api db]` from v0. The grammar's `Value` had no bracket form,
   so the list was a syntax error, and `resolve` only checked for `none` — the
   strip showed the first three *leaf* icons whatever the author wrote.
2. **There was no way to show the choice at reading size.**

## What shipped

- `preview:` on a container is real. The bracket value is `rows`' own `Rank`
  rule (commas optional). Names are the container's **direct** children, leaf
  or container, checked with a did-you-mean; more than three warns and names
  what folds into `+N`. `auto` is the first three children *declared* (the
  model lists leaves before nested containers, so it sorts by source
  position). The shelf's chips follow the choice.
- `preview <path>` / `preview *` in a view marks a visible card **detailed**:
  the head unchanged at 66, then one 32px row per chosen child — a 22 plate,
  the name at 12/500, the caption at 11 in faint (a leaf's `subtitle:`, a
  container's `description:`) — then the shelf, always: `+N more` and the
  domain chip when there are any, a bare base when not, so a rank of detailed
  cards lines up along the bottom (and 66 + 32·n sits off the 8px grid the
  invariants hold every node to). Three rows: 192px, twice the small card. Width
  stays on the card tiers; the widest row can raise the tier the way a
  tagline does.
- It runs in the rule stack beside `expand`, after it and before `only`. It
  changes nothing about what is visible: the detailed card is one unit to
  layout, lifting, `only`, context and the router, exactly as the small card
  is. Context cards are never detailed. `preview` and `expand` on one
  container is an error.

## The one rule that is not negotiable

**Wires never touch the rows.** Every edge into the system lifts to the card
border, as it does for the small card. The rows are a callout of what is
inside, never a claim about which part a wire reaches. Because nothing
attaches to a row, any three the author picks are safe: a bad pick is
uninformative, never misleading. The moment a wire may land on a row, a
hand-picked subset becomes a lie about the ones it hides.

## Rejected shapes

- **A filtered frame** (`expand orders [api worker]`): the real frame with only
  the named children, wires attached to shown leaves and lifted to the border
  for hidden ones. More informative, and dishonest in exactly the way above:
  `gw → api` drawn precisely beside `gw → queue` stopping vaguely at the wall,
  with no way to tell which wires are exact. It also lets the pick drive
  layout. The `only` filter already produces this picture for *tags*, which is
  fine because a tag is a claim about the elements, not a hand-picked subset.
- **A tile strip** (three mini leaves side by side inside a wider card):
  mocked at the renderer's real sizes; at 94px per tile "Fulfillment Queue"
  truncates and captions drop to 10px, and the strip reads as leaves, which
  invites the reader to expect wires into them. Rows are taller, not wider,
  truncate nothing at the 280 tier, and read as a list.
- **Auto top-N by edge degree**: the engine picking the three most-connected
  children. It removes the bad-pick risk, but the pick would change when an
  edge is added elsewhere, and it cannot produce "the three parts people know"
  — which was the ask. The list on the container is that knowledge, written
  down once.
- **A container attribute for the altitude** (`preview: detailed [...]`):
  every card of that system tall in every view, so a per-view override would
  be needed anyway; and deleting every `view` block would still change how
  cards render, which breaks the model/view separation. The container's
  `layout {}` block is not a precedent: it arranges the interior *when
  opened*, a fact about the interior; detailed-or-not is about the card's
  size in this picture.

## What moved

Six corpus views, all cards over a system with a nested container: `auto` now
means direct children, so Order Service in the landscape example shows
`api, handlers, db` where it showed `api, create, get, +1`. The tagline still
counts leaves ("4 components"); the chips count children. Both are true at
their own level, and the level the card stands for is its own.

## Diagnosing the next odd card

- Rows missing on a card a view previews: it is a context card (scenery is
  never detailed), or the view also expands it (error), or its `preview:` is
  `none`.
- A row with an empty caption: the child is a leaf with no `subtitle:` or a
  container with no `description:`. The skill tells agents to write one before
  reaching for `preview`.
- An empty shelf on a detailed card: three or fewer children and no
  `domain:`. It stays on purpose — see above.
- A card wider than its neighbours: the widest row set the tier
  (`sizeOf`, layout.ts). Shorten the caption, or accept the tier.
