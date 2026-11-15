# The gauntlet (end-to-end acceptance)

Thirty-nine architecture prompts — thirty-eight in prose, and one that hands
the agent a real repository. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 39/39 on the deep scorer; the
> latest round itself — the first on the `weft` layout engine — scored 39/39, with 28 of 39 clean on the first `check`.** The
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

**Round 34 — 39/39 on the deep scorer; 28 of 39 clean on the first `check`**
(2026-11-15, Sonnet). The first round on `weft`, the layout engine that
replaced ELK (docs/notes/layout-engine.md). Run to find out what the swap did
to a cold agent's loop and to the pictures it hands over — every earlier round
certified the language and the skill on the old engine.

**No agent hit a layout error, and the two prompts that always did were clean
in one call.** 01 and 27 — `27-rank-conflict` is written to provoke it — used
to fail their first `check` on "hint conflict … runs upward" and fix it from
the diagnostic. That error no longer exists: an edge against the declared rows
is drawn, and both were one call, exit 0, no warnings. No band split, no
row-mates-inside-a-container, no hints-inside-a-zone, no `wrap` shape warning
either; those classes cannot occur now.

**One layout diagnostic fired, and it was right.** 26 wrote `cols [wh idx]`
for two nodes on one rank; `check` said they "cannot share an axis" and wrote
the `rows` line, and the second call was clean. Before the fix made during the
swap that hint drew the two boxes on top of each other in silence.

**The first-check count did not move, because what is left was never layout.**
Of the eleven prompts with more than one call: three ran a clean `check` twice
(02, 20, 34 — nothing to fix); three re-ran on warnings (22 and 35 a long
subtitle, 26 above); five had errors, each fixed in one step from its
diagnostic — attributes written outside the braces (21, 38), two icon ids that
do not exist (30), chained edges (32), `scope` naming a leaf (39). None of
these has a change in this commit: they are the old classes, and the
diagnostics already carry the fix.

**The pictures were looked at, all 68 declared views.** Every one renders
with no diagnostic. Nothing overlaps, no label sits on another wire, fans
stand centred over what they feed. The weak spots the engine note lists did
not show at this size; the largest views (34, 35, 38) are where to look first
if they ever do.

No agent read outside its sandbox, none opened the cookbook, one opened the
icon list. The corpus in `solutions/` is this round's answers for all
thirty-nine prompts.
