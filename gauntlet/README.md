# The gauntlet (end-to-end acceptance)

Thirty-three natural-language architecture prompts. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: 33/33 on the deep scorer, 24 of 33 clean on the first
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

**Round 24 — 33/33 on the deep scorer; 24 of 33 clean on the first `check`**
(2026-09-14, Sonnet). Run to validate the node-and-edge pass before it
ships: `subtitle:` on leaves, frame headers that echo the card, beaded async
dashes, attribute-key checks on every block, and the retirement of `show
descriptions`. First round run on Linux — it died at the bundling step until
the resvg lookup learned that the native package carries a libc suffix there.

**The new field is what cold agents reach for.** Fourteen of thirty-three
wrote `subtitle:` unprompted, forty-six of them, all captions of the shape
the skill shows (`Lambda`, `Ingest & normalize`, `Runs nightly`); none wrote
`show descriptions`, and no solution tripped an attribute-key warning.
Nineteen put a `layout { }` inside a container.

**Three findings, all fixed in this commit:**

- *Two agents chained edges.* `extract -> validate -> dedupe`, the way a
  `flow` chains, and got a bare syntax error. The check now names the
  statement, writes the hops out one per line, says a flow is where hops
  chain, and drops the syntax debris — the rows-continuation treatment from
  round 23, again.
- *Two agents in a row answered "I care most about orders" with one
  landscape and pointed at the auto view.* The HTML export carries auto views,
  so their reasoning held for the file they said to open first; `render
  --sync` does not, so the SVGs they promised never existed, and the scorer
  wants a declared, narrower view. One sentence in the views section says to
  declare a view for the part the ask singles out; the third agent did.
- *The outside-sandbox detector flagged a tool result.* It scanned every
  transcript line, and the CLI's own usage text — printed back to the agent
  after it ran `squinch` with no arguments — matched. It scans the inputs of
  tool calls now and nothing else; the flagged prompt was discarded and
  re-run anyway, per protocol.

Also seen: one agent put `channel` in a container's block and was told so in
one edit; one iterated three times on `align` collision warnings it had
introduced itself; one hit the rank-hint warning; four re-ran `check` after
voluntary edits with a clean first call, which the single-call count charges
against them. Rank conflicts on feedback edges remain the class that survives
the skill.

The corpus in `solutions/` is this round's thirty-three answers,
cold-authored and deep-scored. Two were re-authored per protocol after
under-delivering — one legacy system without `external`, one market-data
path with a single animation kind — and one after the skill edit above.
