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

**Round 33 — 38/39 on the deep scorer; 29 of 39 clean on the first `check`**
(2026-11-11, Sonnet). Run because the first outside test of `fields` changed
where they draw (docs/notes/fields.md): a table inside an expanded container
shows a compact list with no verb, `preview` is only for the leaves nothing
else reaches, and fields no view can draw are a check warning. The skill
gained two sentences — mark every key column, say what a null or a key
pattern means in the caption — and the scorer gained `keyed`, which holds
prompt 39 to a marker on both columns of its composite key and both DynamoDB
keys.

**The new warning did the work it was written for.** 39's agent declared the
DynamoDB table and the Kafka topic at the top level and its first `check`
said both tables' fields "are never drawn — no view shows them", with
`preview carts` as the fix. It added the previews; its final landscape
expands Postgres with no `preview` on the tables inside, and both columns of
`order_items`' key carry `pk`. Three calls, no errors. 36 and 37, tables with
no columns asked for, were clean in one check each and neither wrote a field.

**The one scoring miss is not about fields**: 21 distinguished its three
kinds of link with one `animate:` value where the prompt wants two. First
failures elsewhere are the old classes, each fixed in one step from its
diagnostic: hint conflicts (01, 27), chained edges (32), a `preview:` naming
a non-child (34). 16, 24, 30 and 35 re-ran on warnings.

The corpus in `solutions/` is this round's answers for thirty-seven prompts.
Two are round 32's, kept: 21, which missed above, and 38, whose agent read a
file outside its sandbox and was discarded. Deep-scored at 39/39, none
re-authored.
