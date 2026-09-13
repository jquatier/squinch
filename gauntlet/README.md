# The gauntlet (end-to-end acceptance)

Thirty-three natural-language architecture prompts. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: 33/33 on the deep scorer, 19 of 33 clean on the first
> `check`.** The
> solutions those agents wrote are committed in `solutions/` and re-scored by CI
> on every push, so the claim is inspectable rather than asserted.
>
> The rest of this file is the maintainer's log for running a round, and it
> argues with itself on purpose — a perfect score that surfaced no bugs is
> treated here as the weaker result. That is the intended standard, not a
> disclaimer about the number above.

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

One cold agent per prompt, each in a sandbox holding nothing but
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

The value is in the findings, not the number. A run that scores full marks and
surfaces a crash is a better run than one that scores full marks and surfaces
nothing.

## Latest round

**Round 23 — 33/33 on the deep scorer; 19 of 33 clean on the first `check`**
(2026-09-13, Sonnet). Run to validate the layout v1.2 work before its release
— a container's own `layout { }` block, hints reaching inside expanded
containers, per-container `direction` and `wrap` — with four new prompts
written to call for those shapes in plain language (30–33) and a scorer that
reads the answer off the laid-out picture: nodes above, beside and in a row by
label, and the view's aspect ratio, however the author got there. Round 22,
the day before on the same twenty-nine, found two things the release could
not ship with, both fixed in its commit: a container block contradicting its
own edges passed `check` when no declared view opened the container, and the
interactive export refused a flat model nine agents wrote. Neither recurred.

**The new constructs are what cold agents reach for.** Twelve of thirty-three
put a `layout { }` inside a system, three of them with `direction right`, two
with `place`, one with `cols`; one more named interior paths in a view's
`rows`. The pipeline prompt got `direction right` in the container's block on
the first try; the checkout prompt got a container block whose tiers held in
both of its views; the batch-job prompt got `wrap 5`; the render-farm prompt
got `wrap 4` — after the four-prompt dry run had produced a hand-written
`rows` fold with the detouring edges `wrap` exists to avoid, and one sentence
in the `rows` bullet fixed that.

**Three findings, all fixed in this commit:**

- *A pipeline with a side lookup stepped off its row.* The agent's `direction
  right` was correct, and ELK centred Enrich between Publish and Catalog.
  `priority.straightness` does nothing to that (measured, three placers);
  in-layer order does — inside a directed frame a stage whose unit goes on
  somewhere now sorts before a dead end, so the chain hugs the row and the
  lookup hangs beside it (coplanar.md).
- *`wrap` under an inherited direction folded the wrong way.* 32 wrote
  `direction right` in the container and `wrap 5` in its scoped view; the
  view inherited the direction and the fold came out as three columns.
  `wrap` is a `rows` line the engine writes, so it now counts as the view's
  own hint and replaces the container's block like one.
- *Three agents wrapped a long `rows` line onto a second line* and got bare
  syntax errors. The statement ends at newline; the continuation now gets one
  error saying so, with the fix, and the syntax debris is dropped.

Also seen: three agents put a view-only statement (`channel`, `density`,
`wrap`) in a container's block and were told so in one edit; one agent (and
this author, twice) wrote `view platform { expand platform }` meaning "the
landscape with platform opened" and got "not among the scope's direct
children" — that case now says it is the container's own view and names the
spelling that draws the landscape. The single-call count is up from 9 in
round 22 because no export failed; rank conflicts on feedback edges (four)
remain the largest class that survives the skill.

The corpus in `solutions/` is this round's thirty-three answers (28
re-authored per protocol after under-delivering — one system where three were
asked for), cold-authored and deep-scored.
