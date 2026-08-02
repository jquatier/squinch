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

**Round 12 — 20/20, all twenty clean on the first `check`** (2026-08-02). The
first perfect round: no prompt needed a second call, so no agent needed a fix.
Up from 19/20 clean in round 11, 17 in round 10, 7 in round 4.

**And it found nothing.** By this file's own standard that is the weaker
result — a round that scores 20/20 and surfaces a crash beats one that scores
20/20 and surfaces nothing. Three rounds running have now sat at or near the
ceiling, which says the prompt set has stopped discriminating rather than that
the surface is flawless: these twenty prompts are the ones the skill has been
tuned against for eleven rounds. **The next round needs harder prompts to be
worth its money** — deliberately awkward asks, contradictory hints, domains no
existing prompt covers.

The one thing the round did surface was indirect, and only because it forced a
rebuild: **`apps/spa/src/examples.ts` came back dirty**. It is generated from
`examples/` and `lookbook/cases/` by `scripts/sync-examples.ts`, and committed
— but nothing compared it. The playground's embedded copy of the legend case
had been stale since an `align` hint went into the lookbook source earlier in
the session, so the editor was serving an example that no longer matched the
committed diagram. CI runs the SPA build (which regenerates the file) and never
diffed the result. It now does, one line after the build, exactly like the
lookbook gate above it.

The corpus in `solutions/` is this round's twenty answers, cold-authored and
deep-scored.
