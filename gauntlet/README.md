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

**Round 11 — 20/20, and 19 of 20 clean on the first `check`** (2026-08-01), the
best yet, from 17 in round 10 and 7 in round 4. One prompt failed a first
check, on a stray `,` inside a `rows` bracket.

The round's value was not the score. Between starting the run and scoring it,
a sweep of legal-but-degenerate inputs — the class the round-10 zero-size
canvas belonged to, rather than that one instance — turned up two silent
holes, and scoring the fresh corpus immediately proved one of the fixes wrong.

**`highlight` never validated its tag.** `include`, `exclude` and `only` each
warn when a tag matches nothing; `highlight` went from the parser straight to
the renderer, so `highlight #pcii` dimmed the whole diagram and emphasised
nothing. The same typo, caught three times out of four.

**Then the first cut of that warning was itself a false positive.** It checked
node tags only, and `16-everything` tagged its sensitive paths on *edges* —
`handler -> db { tags: #sensitive }` — which is documented, works, and is a
perfectly good way to answer "mark the sensitive paths". A guard narrower than
the thing it guards is worse than none, and this is the second time in a
session that shape has appeared (the first was `place` alongside `rows`). It
now checks edges too, and the gauntlet's own `requireTag` did the same thing
and got the same fix.

**A view that resolves to nothing now warns**, whatever emptied it — excluding
everything, scoping to a leaf (a node has no insides), or a filter that keeps
nothing. Round 10 fixed the empty-container cause; this covers the symptom.
