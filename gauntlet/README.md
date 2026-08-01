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

**Round 10 — 18/20 on the corpus, 17 of 20 clean on the first `check`**
(2026-08-01). Two solutions were rejected on review, and one of them found a
bug that had been sitting there since containers existed.

**A view with nothing in it rendered `<svg width="0" height="0">`.** `render`
called that ok; resvg then refused it outright ("SVG has an invalid size"), so
`render -o x.png` failed on a file that had just passed `check`. The easy way
in is an empty container: `system p "P" { }` is legal, gets an auto view
(SPEC §5), and that view is empty. An agent wrote `system partner "Partner
System" external { }` as a stand-in for someone else's estate — which is a
node, not a system, since you are not modelling its insides and there is no
altitude to descend to. Nothing in the repo had ever done it, so nothing had
ever caught it. Now `check` warns and names the one-line fix, and the renderer
never emits a zero-size canvas.

Not a regression from drawing `external` — an empty *plain* system did exactly
the same thing. Making `external` legal on a system is only what made the
spelling reachable.

Two scorer/skill gaps behind the other rejection:

- `requireExternal` counted leaf nodes only, so a diagram whose external thing
  was the system card scored "no external node".
- `05-data-pipeline` drew a Kinesis stream with `->`. SKILL.md said "async
  flows use `~>`" abstractly; it now names the words that trigger it — stream,
  queue, topic, event, publishes, emits, feeds — and says a pipeline drawn
  entirely with `->` is almost always wrong.
