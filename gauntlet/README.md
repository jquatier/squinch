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

**Round 17 — 29/29 on the deep scorer; 25 of 29 clean on the first `check`, the
best recorded** (2026-08-07). Run to test two skill rules added the same day,
and it split them.

**Zero syntax errors, in 37 check calls.** Two rounds ago syntax was 12% of all
diagnostics and the reason the grammar was loosened. The whole round produced
seven diagnostics total, against forty-eight last round.

**The zone rule looks like it worked.** "To rank a zone, name one member of it —
not all of them" went from eleven occurrences historically, to one last round,
to none here. Directionally right, on a sample far too small to be sure.

**The `cols`/`align` rule fired twice more, and the agent handled it.** Both
instances are the same prompt and the same pair of nodes. 26-wide-ingestion
asks, in the user's words, to "keep the warehouse and the search index in the
same column" — and `cols` is the wrong construct for that, because those two are
siblings on one rank and already side by side. The agent read the word *column*
in the prompt, reached for the construct spelled `cols`, then tried `align`,
then removed the hint.

**All three of its checks exited 0.** Its first file was already valid; both
diagnostics were warnings, and the two extra calls were the agent voluntarily
clearing a warning that nothing forced it to. That is the behaviour this project
wants, and the final diagram is right: same-rank nodes are already adjacent, and
the hint was never earning its place. Recorded here because the first draft of
this entry called it a rule that "did not work", which the exit codes do not
support.

The vocabulary collision is real and is not a documentation problem: `cols`
names a cross-rank axis, and a reader saying "column" means what they see on
screen. Living with it costs one warning on one prompt. Renaming a shipped
construct to fix that is the worse trade.

**27-rank-conflict took five calls**, its worst yet, hitting the conflict three
times across two different node pairs before finding an arrangement. It exists
to provoke exactly that error, so this is the prompt working; but it is also the
clearest evidence that agents resolve a rank conflict by *guessing another
arrangement* rather than by reading the fix, which names both ways out.

Hint conflicts held at 3 of 37 calls, matching last round. Two rounds at that
level, against 39 of 367 historically, and with only nine of twenty-nine
solutions declaring a layout block at all: the decline is real, and the likeliest
mechanism is agents writing fewer hints rather than writing better ones.

The corpus in `solutions/` is this round's twenty-nine answers, cold-authored and
deep-scored.
