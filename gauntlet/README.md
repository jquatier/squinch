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

**Round 14 — 29/29 on the deep scorer; 25 of 29 clean on the first `check`**
(2026-08-05). Round 13's complaint was that twenty prompts tuned over eleven
rounds had stopped discriminating. Nine new ones were added to test that, and
they did: **four of the nine needed a second call**, against zero of the
twenty. The set discriminates again.

The nine cover what nothing reached before — `animate:`/`style:`, `badge:`, the
k8s and sys packs, `titleblock`, layout hints under pressure — plus three
written to be hard rather than to tick a box: a contradiction, an ambiguous
altitude, and an unstructured brain-dump. Deliberately *not* added: a multi-file
prompt.

**A round of only new prompts could not start.** The bundle smoke test picked
its probe from the *selected* prompts, and by definition a new prompt has no
committed solution — so onboarding prompts was the one thing the harness could
not do. It now falls back to any committed solution: the subject under test is
the bundle, never the selection.

**`cols` said `align`, six times, and never named the fix.** 26-wide-ingestion
asks for six collectors side by side in a left-to-right flow. The agent wrote
`cols [c1 … c6]` — reasonable, since on screen that *is* a column — and got six
near-identical warnings that said "align skipped …" for a construct it had not
written. Three fixes: the warnings now say the word that is in the author's file
(`cols` groups are implemented as align groups, which is an implementation
detail the author should never see); a group whose members all share a rank
collapses to **one** warning; and that warning names the fix, because `rows` is
what puts things side by side. `direction right` makes this worse — a rank looks
like a column on screen — so the cookbook entry says the words describe the
model, not the picture.

The re-run converged but took four calls: `cols` → `align` → `cols` → `rows`.
The agent kept trying to express "these two read as a pair" when the honest
answer is that same-rank nodes are already adjacent and need no hint at all.
That is the next thing to improve here, and it is a real limit of this fix
rather than a success to round up.

**The adversarial prompt worked exactly as designed.** 27-rank-conflict asks for
two things that cannot both hold; `check` reported `hint conflict: approver →
audit runs upward — row 2 to row 1` with a fix naming both ways out, and the
agent recovered. That is SPEC §Tier-1's promise — contradictions are errors,
never silent — demonstrated by an agent that had never seen the rule.

Two expectations were mine, not the agents': 21-market-data's first attempt
wrote `animate: true`, guessing symmetry with the `animate: false` that the
vocabulary used to be, and the existing diagnostic listed the seven legal values
— working as designed, no change. And `requireChannel` was dropped from
26-wide-ingestion: the prompt asks for a wide picture with a shared column, never
for a single trunk, and 13-channel-fanin already covers trunks. Scoring a
stylistic preference the prompt did not ask for is grading the agent on my
taste.

The corpus in `solutions/` is this round's twenty-nine answers, cold-authored and
deep-scored.
