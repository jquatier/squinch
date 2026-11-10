# The gauntlet (end-to-end acceptance)

Thirty-nine architecture prompts — thirty-eight in prose, and one that hands
the agent a real repository. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 39/39 on the deep scorer; the
> latest round itself scored 39/39, with 28 of 39 clean on the first `check`.** The
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

**Round 32 — 39/39 on the deep scorer; 28 of 39 clean on the first `check`**
(2026-11-10, Sonnet). Run because the skill learned `fields` — a leaf's
schema, one field per line, drawn where a view stands in the table's
container or under `preview` (docs/notes/fields.md) — and lost the line that
said "nothing draws columns, so leave them out". The round added prompt 39,
schemas: Postgres tables with keys and a reference, a single-table DynamoDB
design, a Kafka payload. Prompts 36 and 37 ask for tables and not columns,
and now fail an agent that writes `fields` unasked.

**The feature carried on the first try.** 39's agent wrote `numeric(10,2)`,
`enum(pending, paid, shipped)`, `hash`/`range`/`index gsi1`/`ttl` markers,
the `"CART#<cartId>"` key patterns as captions, `ref orders` and dotted
`payload.*` names, and its first `check` had **no errors**. Its three calls
were two warnings: a 26-character subtitle, and `preview carts` in the view
already scoped to Carts' own system — "redundant, every field already draws
there" — which it dropped as told. 36 and 37 were clean in one check each,
and neither agent wrote a field.

**Clean first checks rose from 20 to 28**, with the round-31 icon-guess
category empty again. The first failures that remain are the old classes,
each fixed in one step from its diagnostic: hint conflicts (01, 27), a fan-in
(26), chained edges (32), a `preview:` naming a grandchild (34), and a
one-line view writing `title "…" include *` with no separator (23). 15, 21,
30 and 35 re-ran on warnings.

The corpus in `solutions/` is this round's answers for all thirty-nine
prompts — cold-authored and deep-scored at 39/39, none re-authored.
