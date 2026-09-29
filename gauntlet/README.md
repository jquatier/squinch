# The gauntlet (end-to-end acceptance)

Thirty-seven natural-language architecture prompts. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 37/37 on the deep scorer; the
> latest round itself scored 36/37, with 23 of 37 clean on the first `check`.** The
> solutions those agents wrote are committed in `solutions/` and re-scored by CI
> on every push, so the claim is inspectable rather than asserted.
>
> The rest of this file is the maintainer's log for running a round, and it
> argues with itself on purpose — a perfect score that surfaced no bugs is
> treated here as the weaker result. That is the intended standard, not a
> disclaimer about the number above.

- `prompts.json` — the prompts plus machine-checkable expectations
  (structure, icons, tags, views).
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

**Round 28 — 36/37 on the deep scorer; 23 of 37 clean on the first `check`**
(2026-09-28, Sonnet). Run for one paragraph of skill prose, "Tables": when the
reader asks what is *in* a database, write it as a `container` holding one
`sys/table` per table; when the table is itself the deployed resource, as on a
serverless store, it stays a node in the service that owns it. No engine
change — the container, the card, the dive and the labelled edge all shipped
already. The question was whether cold agents find the idiom when asked, and
whether they start opening every database when not.

**Two new prompts, both carried.** 36 asks for a billing service whose
database the reader can open onto five named tables; 37 for a notifications
service that keeps two DynamoDB tables. 36 came back clean on the first
`check`: a `container` with `icon: aws/rds`, five tables, each foreign key a
labelled edge. 37 drew both tables as plain nodes beside the queue, and needed
a second `check` only for two subtitles a character over the limit. The scorer
gained the two expectations that make those checkable — `inside` (something
labelled like this sits within a container labelled like that) and `siblings`
(these two share a parent, so nothing was invented to hold one of them) —
matched by label, as `layout` is, since ids are the agent's.

**Nobody overreached.** Zero of the thirty-five standing prompts wrapped a
database in tables. The paragraph sits in the Language section, which every
agent reads, so this was the risk; the only `sys/table` among them is 22's
lakehouse, where the prompt asks for tables and always had them.

**Columns were tried three ways and then cut.** A third prompt gave a schema
with its columns. The first wording said a table's one hard fact goes in its
`subtitle:`; the agent put four column lists there and shipped two "will be
cut off" warnings. The second sent them to `description:`, "which the reader
gets on hover" — the agent complied, passed clean, and drew none of it,
because a leaf's description reaches no render at all: not the SVG, not the
interactive export. The wording was wrong and the scorer could not see it,
since a column that is not drawn is not a diagnostic. The third pointed at
view notes, which do draw, and the agent wrote four. Then the scope was
settled the other way: squinch draws tables, not schemas. The prompt is gone
and the skill says to leave columns out. Its three answers are under
`.run/round28-findings/`.

**The one miss was 34, again.** It made each of the sixteen services its own
`system` and declared a single view — grouped, in the letter of "When the
system is big", into areas of one. Nothing in the answer touches tables, and
34 is the prompt round 27 already named as the one that varies; the corpus
keeps round 27's answer for it and this round's is saved with the findings.

**Surfaced and not fixed here.** 35 took thirteen `check` calls, the round's
most expensive prompt for the second round running: it wrote its `rows` bands
one per line, which the check names (`rows` bands must sit on one line) beside
a cascade of syntax errors for the same mistake. And SPEC §3 and DESIGN §3
both promise a hover card for a leaf's `description:` that no surface draws;
the VS Code extension's hover over the id in source is the only place it
shows.

The corpus in `solutions/` is this round's answers for thirty-six prompts —
the full run's for thirty-four of the standing thirty-five, and a final
two-prompt pass on the settled wording for 36 and 37 — and round 27's for 34,
all cold-authored and deep-scored at 37/37, none re-authored.
