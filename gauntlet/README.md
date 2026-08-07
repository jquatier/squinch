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

**Round 18 — 29/29 on the deep scorer; 23 of 29 clean on the first `check`**
(2026-08-07). Run to test one hypothesis, which it refuted.

The hypothesis: round 17's 27-rank-conflict hit the same conflict twice in a
row, so the agent looked to be guessing at arrangements rather than reading the
fix — and the fixes that get applied in one iteration are the ones that write
the corrected text out. So the rank conflict now prints the `rows` line to
paste, guarded so it is only offered when the whole rearrangement comes back
clean.

**It was offered three times and declined three times.** 27 went from five calls
to four, and the transcript shows the agent reading
`write \`rows [request] [policy] [audit approver]\`` and then not using it —
reaching for `place audit right-of policy` instead, twice.

That is the agent being *right*. 27 asks for the policy engine and the audit log
on the same row **and** for policy to read as upstream of audit, which cannot
both hold. The suggested line satisfies the DSL by putting audit beside the
approver — quietly abandoning the "same row as each other" half of the request.
The agent declined it and tried `place`, which is the one construct that puts
two nodes on a rank together: it was still trying to honour the user's
constraint. Better reasoning than the fix it was offered.

**The prediction was wrong, and so was the choice of test.** 27 is built to be
unsatisfiable, so some iteration is inherent to it and it cannot measure whether
a concrete fix reduces iterations. No non-adversarial prompt hit a rank conflict
this round, so the change is untested rather than disproven: it is strictly more
informative than the prose it replaced, it is guarded against suggesting
something that breaks a different edge, and it costs nothing — but nobody has
yet applied one.

There is a refinement the transcript points at. Two merges are always available
— move the target down into the source's band, or move the source up into the
target's — and only the first is offered. Where a prompt has pinned one of the
two nodes, the other direction may be the one that keeps the author's intent.
Not built; recorded because the evidence for it is one transcript.

Icon errors rose to five (three unknown ids, one in a `glyph:`, one in a
`badge:`) from one last round, all agents inventing plausible ids. The
diagnostics name the search command and every one was fixed on the next call.

The corpus in `solutions/` is this round's twenty-nine answers, cold-authored and
deep-scored.
