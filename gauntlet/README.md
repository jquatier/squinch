# The gauntlet (Phase-3 acceptance, docs/PLAN.md §3)

Twenty natural-language architecture prompts. An agent, armed with only
[`packages/skill/SKILL.md`](../packages/skill/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

- `prompts.json` — the prompts plus machine-checkable expectations
  (structure, icons, tags, views).
- `solutions/` — the current certification set: 20 solutions authored cold by
  fresh agents. Each round overwrites it, so what is committed is always the
  latest reviewed run. CI regression-tests this corpus on every push.
- `run.ts` — the round itself: one sandboxed `claude -p` session per prompt.
  The protocol it enforces is documented in its own header, next to the code
  that enforces it.
- `score.ts` — deterministic scorer: builds each solution, renders every
  declared view, validates the SVG, checks expectations. No model, no network.

## Running a round

```bash
npx tsx gauntlet/run.ts
```

Twenty cold agents, one per prompt, each in a sandbox holding nothing but
`SKILL.md`, the prompt, and a `squinch` binary — the repo is not reachable from
inside, so there are no examples and no previous answers to copy. Takes a few
minutes and costs real money; it is maintainer-only and never runs in CI.

```bash
npx tsx gauntlet/run.ts 03 17 --keep     # a subset, keeping the sandboxes
npx tsx gauntlet/run.ts --model opus     # a different model
npx tsx gauntlet/score.ts                # the free half: score what is committed
npx tsx gauntlet/score.ts --deep         # + every theme, PNG, determinism
```

The report is keyed on the thing worth knowing: **check calls per prompt**. One
call, exit 0, no warnings means the skill carried that prompt with no fixes.
Anything above one prints the diagnostic the agent hit, which is the raw
material for a `SKILL.md` edit — or, as often, for an engine fix. That loop,
not the score, is what a round is worth.

A failed session leaves the committed solution untouched and reports
`no-solution`: losing a good diagram to one rate-limited session is the worst
thing a maintenance script can do. `--prune` opts into strict overwrite.

Only the latest round is written up. Every round's findings became a code or
docs change in the same commit, so the fixes are the durable record and the
write-ups were duplicating git history; earlier rounds are in it if you want
them.

The value is in the findings, not the number. A run that scores 20/20 and
surfaces a crash is a better run than one that scores 20/20 and surfaces
nothing.

## Latest round

**Round 9 — 20/20, 18 of 20 clean on the first `check`** (2026-08-01). The
structural number is better than the score: **3 of 20 committed solutions still
carry a `layout` block**, down from most of them. Round 8's rewrite of the loop
— your edges already encode the tiers, so listing every node in `rows` only
restates them at the cost of a hard error the moment one disagrees — did what
two rounds of cookbook rows could not.

Two prompts failed a first check. One was `runs upward` again. The other opened
something larger.

**A kind on a system.** `system partner "Partner System" external { … }` is C4's
external system, and SKILL.md's own gloss for the keyword is "not ours —
someone else's system", so it is exactly what an agent reaches for. The grammar
takes kinds on nodes only, and it came out as a syntax error pointing at the
brace. It now names the mistake and offers a copy-pasteable node form.

**And the reason it was not simply allowed:** chasing it turned up that
`external`, `datastore` and `person` are **visually inert**. They parse,
validate, appear in SPEC §3 ("affect default styling per DESIGN") and DESIGN §3
("hatched surface variant for `external`") — and render byte-identical to a node
with no kind at all. Three documented kinds, no implementation. Widening that
surface onto containers would have meant accepting a second thing that draws
nothing, so the diagnostic came first. SKILL.md no longer claims themes style
them.

Implementing the kinds is a renderer change touching every committed diagram
that owns a `datastore`, so it wants its own change and its own before/after.
