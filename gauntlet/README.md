# The gauntlet (end-to-end acceptance)

Thirty-three natural-language architecture prompts. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: 33/33 on the deep scorer, 25 of 33 clean on the first
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

**Round 25 — 33/33 on the deep scorer; 25 of 33 clean on the first `check`**
(2026-09-14, Sonnet). Run straight after round 24's fixes landed, to see them
hold: no chained edge in the corpus, the "I care most about orders" prompt
answered with a declared `orders` view on the second call, and no
outside-sandbox read. `subtitle:` held at fourteen of thirty-three unprompted;
none wrote `show descriptions`; nothing tripped an attribute-key warning.

**Two scorer gaps, both fixed in this commit — the diagrams were right:**

- *"Azure SQL" drawn with `azure/azure-sql`.* The pack has that icon, titled
  Azure SQL, beside `sql-database`; the expectation listed only the latter.
  It accepts both now.
- *"An AKS cluster running the new services" modelled as a system.* The agent
  gave it `icon: azure/aks` and put the services inside — the better model —
  and the scorer counted neither the card's icon nor the card. Container
  icons count as drawn icons now, and a container counts as a drawn thing
  for a prompt's "at least N", which is what it is on the page.

**One skill edit.** Two agents put a view statement in a container's
`layout { }` (`channel`, `wrap`) and were told so in one edit, as three
were in round 23; the block-placement rule in the skill now names the
view-only statements instead of three of them.

Also seen: one agent iterated five times on a warehouse floor whose `rows`
contradicted its own arrows, the rank-conflict class that survives the skill;
five re-ran `check` after voluntary edits with a clean first call.

The corpus in `solutions/` is this round's thirty-three answers,
cold-authored and deep-scored, none re-authored.
