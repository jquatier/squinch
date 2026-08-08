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

**Rounds 19 and 20 — certifying the SKILL.md rewrite: 23/29 then 24/29 clean,
29/29 deep both times** (2026-08-07). The skill was fully restructured — 21
rules that had accreted into 2-8 statements each over eighteen rounds of
append-where-convenient were deduped to one authoritative statement plus their
cookbook rows, zone semantics consolidated from three sections into one, the
frontmatter description rewritten for triggering, and one stale fact fixed
(sys is 164 icons, not 147). A full rewrite of the certified teaching surface
warranted two rounds rather than one, stated up front when the risk was
chosen.

Both rounds landed inside the pre-rewrite band (22-25/29, rounds 16-18), and
round 20's 24/29 sits at its top. No failure in either round traces to a rule
the rewrite moved or merged — the specific risk of deduplication. All second
calls hit known classes, and the diagnostics added in rounds 15-16 carried
them: the folded prefix error, the unquoted-value hint and the person-doubling
hint each turned what used to be a bare syntax error or a 28-error cascade
into a one-call recovery. 27-rank-conflict took two calls in round 20 — its
best ever — with the transcript showing the concrete `write \`rows […]\``
line being applied, the first observed use of the pasteable fix added after
round 17.

What the rewrite deliberately did not do: hit its 15-20% token-reduction
target. The cut came to 7% (498→465 lines, 5,312→4,939 words) because the
why-explanations stayed — current skill-authoring guidance says explain the
why, it is the part of this skill that demonstrably works, and trading it for
a word count would have been optimising the measurable at the expense of the
valuable. The duplication is gone; the teaching is intact.

**And the safety net under the safety net earned its keep.** Round 20's fresh
solution for 26-wide-ingestion wrote `place idx right-of wh` and then
`align wh idx` — and the align pass parked `idx` exactly on top of `wh`, with
`check` exiting 0. The align collision guard only scanned nodes on the same
rank, assuming a snap stays inside one band; `place` chains under
`direction right` break that assumption. The deep scorer missed it too — it
checks structure, not geometry. What caught it was the corpus invariant sweep
(no two nodes overlap, over every committed diagram), which failed CI-side the
moment the corpus landed. The guard now checks every node — a geometric check
has no business trusting rank labels — and 26 was re-run cold against the
fixed engine. Three independent layers looked at that diagram; the third one
worked. That is why there are three.

The corpus in `solutions/` is round 20's twenty-nine answers (26 re-authored
against the align fix), cold-authored and deep-scored.
