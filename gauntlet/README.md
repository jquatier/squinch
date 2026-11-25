# The gauntlet (end-to-end acceptance)

Forty-two architecture prompts — forty-one in prose, and one that hands
the agent a real repository. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 42/42 on the deep scorer; the
> latest round itself — the first with `about` and formatted prose — scored
> 41/42, with 31 of 42 answered in one `check` call.** The
> solutions those agents wrote are committed in `solutions/` and re-scored by CI
> on every push, so the claim is inspectable rather than asserted.
>
> The rest of this file is the maintainer's log for running a round, and it
> argues with itself on purpose — a perfect score that surfaced no bugs is
> treated here as the weaker result. That is the intended standard, not a
> disclaimer about the number above.

- `prompts.json` — the prompts plus machine-checkable expectations
  (structure, icons, tags, views). A prompt about real code names a `repo` —
  a URL and a full commit sha, never a branch — and `run.ts` copies that
  checkout into the box beside the prompt; its `labels` and `edges`
  expectations then check the services and calls the code actually has.
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

**Round 40 — 41/42 from the round itself, 42/42 committed; 32 of 42 with one
`check` call** (2026-11-25, Sonnet). Run after the icon packs grew: `logos/`
from 147 marks to 283 (Simple Icons 16.38.1), `sys/` from 195 icons to 200
with aliases for the concept words agents kept guessing (`api`, `worker`,
`process`, `device`, `scheduler`, `scanner`…), a few vendor aliases
(`aws/aws`, `azure/synapse`, `azure/power-bi`), and a skill line showing a
third party keeping its mark (`logos/stripe "Stripe" external`).

**No agent hit an unknown icon** in 213 CLI calls. Across every earlier log on
disk, `sys/api` alone had missed 15 times (its nearest suggestion was
`sys/ads`), with `worker`, `scanner`, `upload` and `download` behind it. This
round's answers use `sys/api` 20 times, `sys/worker` 9 and `sys/download` 6;
the monorepo prompt (35) drew Firebase and Metabase with their marks where
earlier rounds drew boxes, and Stripe appears as `logos/stripe` three times
with no `box "Stripe"` left. SendGrid is still a box: it has no mark
anywhere we can ship.

**One engine finding, set aside for its own change.** Round 40's answer to 38
(Online Boutique) drew the Frontend → Recommendation wire with an 8px jog
where it enters the Catalog & Discovery frame, just right of the title — a
wall port slid off the wire's line. It is the first `kinks` (and, turned
rightward, the first `offCentre`) the corpus has produced on `weft`, so the
quality gate caught it. That answer is not committed; 38 keeps its previous
answer, and the jog is a follow-up for the layout engine.

**First failures were the engine's existing messages**, each fixed from its fix
line: a fan-in written as one edge (24), a chained edge list (32), a
`preview` child guessed (34). Seven more ran `check` again with nothing to fix
but one colour-lens warning (16, the same `color #sensitive` pasted into a
view without the tag as in rounds 38 and 39).

**One prompt failed, and it is modelling, not the tool.** 20 drew the nightly
sync job as an edge again; the committed answer is round 36's re-run. 30 read
outside its sandbox and is discarded. The corpus is round 40's answers for
the other thirty-nine.
