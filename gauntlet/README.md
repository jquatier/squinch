# The gauntlet (end-to-end acceptance)

Twenty-nine natural-language architecture prompts. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: 29/29 on the deep scorer, 22 of 29 clean on the first
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

**Round 22 — 29/29 on the deep scorer; 17 of 29 never saw a diagnostic, 9 of
29 made a single `check` call** (2026-09-13, Sonnet). Run to validate the
layout v1.2 work before its release: a container's own `layout { }` block,
hints reaching inside expanded containers, per-container `direction`, and
`wrap`.

**Seven of twenty-nine cold agents put a `layout { rows … }` inside a system
unprompted, and every one of those seven rendered clean.** That was the bet the
container block was built on — it had been "the most common authoring mistake"
for a year — and it paid on the first round it was legal. One more agent named
interior paths in the view's `rows` instead, which now works too. Nobody
reached for `wrap` or a container `direction`: the prompts do not ask for the
shapes they serve, and 26-wide-ingestion, the one prompt where `wrap` would
have helped, got a `cols` warning instead — the cookbook row exists, but agents
open the cookbook on a symptom, and a wide diagram is not a diagnostic.

**The two findings, both fixed in this commit:**

- *A container block that contradicts its own edges passed `check`.* 15's
  agent wrote bands running against the interior's arrows; the one declared
  view kept the container collapsed, so the block was dormant and `check` said
  OK — then the HTML export laid out the container's auto view, where the
  block is the root layout, and failed on the conflict. The claim a block makes
  is about the interior's edges, so it is now checked at build time, once,
  with every edge resolved, wherever the block sits.
- *The interactive export refused a flat model.* Nine agents wrote top-level
  components with no `view` and no container — a model the SVG path renders
  through an implicit view — checked it clean, then hit "nothing to export"
  from the `.html` handover the skill now asks for by default, with a fix that
  named an option (`views: "all"`) that could not help since there was nothing
  to include. 10's agent tried it anyway and failed again. The export now
  bundles the implicit view under the CLI's `default` label, as the SVG path
  always has.

The single-call count (9, against 22 in round 21) is the export finding
wearing a different hat: those nine flat models each cost a second `check`
after the fix, and most of the rest were agents re-checking after the render.
The class that used to dominate — rank conflicts on feedback edges — is down
to four, and `unknown icon` (four, all `sys/barcode` in one file) and `expand`
naming something that is not a direct child (three) make up the remainder. 13's
agent wrote `channel` inside a system's block, met the new "describes a view,
not a container's interior" error, and moved it in one edit.

The corpus in `solutions/` is this round's twenty-nine answers, cold-authored
and deep-scored.
