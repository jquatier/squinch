# The gauntlet (end-to-end acceptance)

Twenty-nine natural-language architecture prompts. An agent, armed with only
[`packages/skill/SKILL.md`](../packages/skill/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: 29/29 on the deep scorer, 25 of 29 clean on the first
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

**Round 21 — 29/29 on the deep scorer; 22 of 29 clean on the first `check`**
(2026-08-08). Run to certify the soundness fixes from the DSL evaluation:
duplicate-view and zone/node-collision errors, tags collecting from `tags:`
only, positional tags on top-level `person`, and targeted diagnostics for
fan-in, Allman braces and duplicated attribute keys.

**None of the seven new diagnostics fired, and that is the honest headline.**
These corners came from an eighteen-probe evaluation of the language, not from
gauntlet transcripts — duplicate views, colliding zone ids and fan-in are
mistakes these twenty-nine prompts don't naturally produce. So the round
certifies no regression (22/29 sits at the bottom of the 22-25 band, all
second calls on long-known classes, every one recovered) rather than
validating the fixes. Validation, if it comes, arrives the day some future
agent writes `x, y -> z` and gets one clear error instead of a bare syntax
error plus `unknown id \`x, y\`` debris.

21-market-data failed the deep scorer on its stylistic expectation (one
distinct `animate:` value where the prompt asks for contrast) despite a clean
check, and was re-run per protocol; the second authoring passed. That
expectation has now caught three rounds' agents — it is doing its job of
demanding cadence-as-meaning rather than decoration, and the prompt wording
stays as the test of whether agents read "make it obvious at a glance" as a
motion requirement.

The corpus in `solutions/` is this round's twenty-nine answers (21
re-authored), cold-authored and deep-scored.
