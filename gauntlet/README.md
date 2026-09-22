# The gauntlet (end-to-end acceptance)

Thirty-five natural-language architecture prompts. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 35/35 on the deep scorer; the
> latest round itself scored 34/35, with 22 of 35 clean on the first `check`.** The
> solutions those agents wrote are committed in `solutions/` and re-scored by CI
> on every push, so the claim is inspectable rather than asserted.
>
> The rest of this file is the maintainer's log for running a round, and it
> argues with itself on purpose — a perfect score that surfaced no bugs is
> treated here as the weaker result. That is the intended standard, not a
> disclaimer about the number above.

- `prompts.json` — the prompts plus machine-checkable expectations
  (structure, icons, tags, views).
- `solutions/` — the current certification set: one solution per prompt, authored cold by
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

**Round 27 — 33/35 on the deep scorer; 19 of 35 clean on the first `check`**
(2026-09-21, Sonnet). Run for the detailed card — `preview <path>` in a view,
and the `preview: [a b c]` list on a container that it draws — and for the
skill prose written for it. The question was not the score: it was how often
cold agents reach for a new verb that is right on a landscape and wrong on
every other view, and whether they overreach.

**Nobody reached for it.** Zero of thirty-five answers wrote `preview:` or
`preview`, and no agent mentioned it in its own reasoning. The paragraph sat
in the Views section, after the `expand *` example; the prompts where the card
earns its height are the large-system ones, and those send an agent to "When
the system is big", which said nothing about it. Round 26 measured this
already — placement beats wording — and it held: prose 60 lines from where the
agent is looking moves nobody.

**One bullet, then a subset.** "When the system is big" gained a bullet: give
every area a `description:`, name the three recognisable parts in `preview:`,
put `preview *` on the landscape view, and only there. Re-run cold on the six
prompts where the card is defensible (04, 16, 28, 29, 34, 35): 6/6, 3 of 6 clean
on the first `check`, and **two of six reached for it** — 28 ("just enough
that a new engineer knows") wrote `preview orders`; 35 (the monorepo) wrote
`preview *` on its landscape, six domain cards each naming three services.
Both put it on the landscape only, both had written descriptions for the
children, and neither hit a `preview` diagnostic. The three that did not use
it (04, 16, 29) are small systems, where the bullet does not apply. That is
the intended rate: the verb is opt-in, and the skill now puts it where the
decision is made.

**The two misses were the large-system prompts, and 34 needs saying plainly.**
35 wrote one view in the full run and three in a re-run — variance. 34 drew
all sixteen services flat, no systems, one view — *twice*, in the full run and
in a two-prompt re-run on the same skill, where round 26 had it grouping about
one time in four. The only skill change between the rounds was the `preview`
paragraph in an unrelated section, so two flat answers in a row read as the
prompt's known variance rather than a regression; the third run, with the new
bullet (which says "area" again, one line from the grouping advice), grouped
into four areas. 34 stays the prompt where a future skill change will show.

**A router defect, surfaced and not fixed here.** 35's `preview *` answer
draws a top-level Kafka bus that every domain publishes to and consumes from —
`catalog.products -> kafka` and `kafka ~> catalog.indexer`, a two-node cycle
once both lift to the landscape. The invariant sweep (`test/invariants.ts`)
fails it three ways: two coplanar wires end on no boundary (the router took
catalog and kafka for one rank — both carry rank 31 — while ELK laid kafka a
band below), and the lifted label "products updated" lands on the Event Bus
leaf. It reproduces with `preview *` removed, so it is the co-ranking of a
mutual pair, not the detailed card (`docs/notes/coplanar.md` territory). The
corpus therefore keeps round 26's answer for 35 — the invariants are a CI gate
— and round 27's is saved under `.run/round27-findings/` for the fix. Also
seen: 35's agent guessed `view identity, catalog, commerce` (a view list) and
`highlight commerce.checkout` (a path where a tag goes) — two syntax errors and
ten `check` calls, the round's most expensive prompt.

The corpus in `solutions/` is this round's answers for thirty-four prompts —
the full run's for twenty-nine and the subset's for 04, 16, 28, 29 and 34 —
and round 26's for 35, all cold-authored and deep-scored at 35/35, none
re-authored.
