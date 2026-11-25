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

**Round 39 — 41/42 from the round itself, 42/42 committed; 30 of 42 with one
`check` call** (2026-11-25, Sonnet). The third of three rounds run on the
legend overhaul (docs/notes/legend.md): `legend auto` is retired, a legend is
a `legend { }` block of entries the author labels, and the skill gained a
paragraph on writing one — when the request asks or colour carries meaning,
keys are the arrows, three marks and coloured tags, every key needs a label.
The scorer gained `requireLegend`, set on 12, the one prompt that asks for a
legend: some view must draw at least one entry.

**No legend diagnostic fired in round 39.** Eight agents wrote a legend and
every one checked clean; 12 drew `-> "Request / response"  ~> "Async
message"` in one call, 14, 16 and 21 keyed their coloured tags (`#pci`,
`#sensitive`, the three cadences of 21). The two rounds before it each
surfaced one thing, and both are fixed:

- **A key on a highlighted tag** (08, rounds 37 and 38). The agent keyed
  `#pci` in a view that `highlight`ed it and got "coloured in no view" —
  true, but silent on why a highlight was not enough. The error now says a
  legend keys a colour and a highlight needs no key, and offers both ways
  out; round 38's agent fixed it from that in one step. The skill then said
  it up front ("a `highlight #tag` needs no key"), and round 39's 08 was clean
  in one call with no legend.
- **A cadence the scorer could not see** (21, round 37). The agent drew
  drifting streams, a nightly batch held still with `animate: false` and a
  pulsing poll, all keyed in a legend; `requireAnimate` counted written values
  and skipped `false`, so it saw one. It now counts the motion a reader sees —
  a written value, `false` as still, a `~>` edge's default drift — and a sync
  edge that says nothing still states nothing.

**One thing seen twice and left alone:** 16 pasted its `color #sensitive`
line into the orders view along with the legend block, where nothing carries
the tag, and got the colour lens's own "nothing visible here is tagged"
warning (rounds 38 and 39, fixed in one step both times). The legend entry
itself is left out there, as designed.

**First failures were the engine's existing messages**, each fixed from its
fix line: a fan-in written as one edge (24, 26, 35), a chained edge list
(32), a `preview` child guessed (28, 34), a `place` against `rows` (30).
33 and 39 ran `check` again after an edit with nothing to fix, and 15 four
times against clean output. Solutions with a legend fell from thirteen (the
old corpus's `legend auto` lines) to eight blocks: 12, which asks; 14, 16 and
21, which colour tags; and four that key only arrows (03, 09, 11, 22).

**One prompt failed, and it is modelling, not the tool.** 20 drew the
nightly sync job as an edge rather than a node, as in rounds 36, 37 and 38;
the committed answer is round 36's re-run. 38 read outside its sandbox and is
discarded, its committed answer kept. The corpus in `solutions/` is round
39's answers for the other forty.
