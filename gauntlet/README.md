# The gauntlet (end-to-end acceptance)

Forty-one architecture prompts — forty in prose, and one that hands
the agent a real repository. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 41/41 on the deep scorer; the
> latest round itself — the first with relationship marks — scored 39/40, with
> 29 of 40 answered in one `check` call.** The
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

**Round 35 — 39/40 from the round itself, 40/40 committed; 29 of 40 with one
`check` call** (2026-11-17, Sonnet). Run after relationship marks went in
(docs/notes/relationship-marks.md): the skill gained a passage, the scorer
three expectations (`marks`, `requireMarksShown`, `forbidMarks`), and the set
one prompt, `40-relationships` — a clinic schema that states a NOT NULL key,
a nullable key, a many-to-many, a "none or many", and one relationship with no
optionality at all.

**The marks went on the right ends, with the right words, in both runs.** Both
answers end at `appointments -> patients { from: zero-or-many to:
exactly-one }` (the request says "including none" and NOT NULL), `to:
zero-or-one` for the nullable `clinic_id`, plain `from: many to: one` for the
relationship whose optionality is not stated, and `doctors -- specialties {
from: many to: many }` with no invented join table. The pilot got there in
one `check` call. The round's session first wrote `from: many` for patients,
checked clean, then changed it to `zero-or-many` on re-reading the request
and checked again — a second call after an edit to a mark, not a diagnostic.
No mark diagnostic fired in any session, and no label repeated the
cardinality, the habit the placement probe showed when the CLI drew nothing.
Two sessions is what this rests on: the pilot and the round, one model.

**The negative controls, and what a re-run changed.** 36 names tables and
says which belongs to which, with no counts; it drew no mark in the pilot or
the round. 37's two tables are unrelated, so it could hardly fail. No other
prompt's answer carries a mark. A re-run of the four table prompts after the
round then had 36's agent write `{ from: many to: one }` on all four
"belongs to" edges — plain words, no guessed ring. That is a fair reading of
"belongs to", and the plain words exist for it, so 36 now forbids only the
four words that state optionality (`forbidOptionality`). The clean control is
a new prompt, `41-tables-no-relationships`: four tables that two jobs read
and write, with nothing said between the tables. Three cold runs drew no
mark on it; its committed answer is the last of them.

**One prompt failed, and it is not about marks.** 28 (`how-deep`) scoped a
view to `orders` that showed as many elements as its landscape, so "no view
narrows the picture". Three re-runs passed three times; the committed answer
is the last of them. It passed in round 34 and nothing in its path changed,
so it is recorded as variance, not fixed.

**Five first failures, fixed from their diagnostics**: a fan-in written
`c1, c2 … -> norm` (26), chained edges (32), a fan-out list inside a
`channel` (33), `preview:` naming a grandchild (34), `scope` on a leaf (39).
All five are the classes round 34 already listed. 32's chained edges were
followed by a one-line `layout { wrap 4 }`, and that pair cascaded into
twelve errors before the agent fixed it in one step — worth a look, and not
this round's change. 39 took three failing calls, two of them on the agent's
own truncated edit. Six more prompts ran `check` again with nothing to fix
or on a warning (22 and 31 three times).

No agent read outside its sandbox; one opened the cookbook, one the icon
list. The corpus in `solutions/` is this round's answers for all forty
of its prompts, plus 41's from the runs after it.
