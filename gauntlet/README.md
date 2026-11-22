# The gauntlet (end-to-end acceptance)

Forty-two architecture prompts — forty-one in prose, and one that hands
the agent a real repository. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 42/42 on the deep scorer; the
> latest round itself — the first with `about` and formatted prose — scored
> 41/42, with 31 of 42 answered in one `check` call.** The
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

**Round 36 — 41/42 from the round itself, 42/42 committed; 31 of 42 with one
`check` call** (2026-11-22, Sonnet). Run after `about`, block strings and
formatted notes went in (docs/notes/prose.md), with the side-wall routing and
the payments example since round 35: the skill gained the prose passage and
cookbook rows for the new `route` warnings, the scorer two expectations
(`requireAbout`, `aboutMatches`), and the set one prompt, `42-context` — an
architecture review that wants a context section above the diagram with an
intro, three bullets, a bold word, a ticket id as code and a runbook link,
and a note on the database. It is the situation a user hit before `about`
existed: their agent edited the rendered SVG.

**42 was clean in one call.** The prompt never names the feature; the agent
wrote an `about` block string with the intro, `- ` bullets, `**synchronous**`,
`` `OPS-412` `` and `[orders runbook](https://…)`, and put the database fact
in a note. No prose diagnostic fired in any session, and no agent touched a
rendered file.

**Two first failures were the engine's messages, and both are fixed.**

- **A long chain** — `extract -> validate -> … -> notify`, fourteen hops (32).
  Up to three hops drew the right error; from four, the parser's recovery
  read the tail as a brace-less attr block that swallowed the next line, and
  the agent got four "`fields` on an edge" errors, a lost view and the true
  error sixth. Round 35 saw the same cascade on this prompt and set it aside.
  The grammar now parses a chain, and the model refuses it in one error that
  lists every hop to write.
- **Two statements on one line** — `view db { title "Postgres schema"  scope
  checkout.db }` (39), three views written that way. It was a bare syntax
  error; it now says that `scope` starts a second statement and writes the
  line both ways (own line, or `;`). Whitespace cannot be the separator:
  after a label a word may be a kind as well as the next statement.

The third first failure, a fan-in `c1, c2 … -> norm` (26), already had a
diagnostic that writes the six lines, and the agent fixed it from that.
Eight more prompts ran `check` a second time after an edit with nothing to
fix.

**One prompt failed, and it is modelling, not the tool.** 20 drew the nightly
sync job as an asynchronous edge rather than a node, so it had four nodes to
the scorer's five. Three re-runs: one the same, two with the job as a node;
the committed answer is the last of them.

No agent read outside its sandbox; none opened the cookbook, two the icon
list. The corpus in `solutions/` is this round's answers for all forty-two
prompts, 20's from its last re-run.
