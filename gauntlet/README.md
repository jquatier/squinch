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

**Round 15 — 29/29 on the deep scorer; 23 of 29 clean on the first `check`**
(2026-08-07). Run to certify a grammar change, and it did more than certify it.

The change came from asking why agents form syntax errors at all. Three bodies
of evidence: every one of the 367 `check` calls in the 27 recorded runs here,
clustered by message; five cold agents given nothing but the README example and
a brief that forced the error-prone constructs; and the errors I make myself
with the whole repo in context. The conclusion was that the DSL is *easy* — all
five probes reproduced structure, arrows, blocks and space-separated ranks from
one example — but two spots fought every model's prior, and the diagnostics at
exactly those spots were the worst in the language.

**Five of five probe agents invented the same illegal form**, sonnet and haiku
alike: `charge = aws/lambda "Charge Handler" #pci { … }`. A hashtag reads like a
kind and sits where `datastore` sits. Nobody wrote `tags:` unprompted. And the
comma rule was internally inconsistent — required in path lists, forbidden in
rank groups, attr blocks, `align` and `highlight` — which fired in *both*
directions: agents wrote `[create, get, search]` three times across rounds
despite the skill showing spaces, and omitted a required `channel` comma once.

Both are legal now. A tag may sit in kind position; a comma is optional wherever
whitespace already separates. That is what SPEC §1 has promised since v0 and the
parser never delivered. The three previous times this project met a recurring
syntax error — attr/kind order, `= person`, container `external` — it fixed them
the same way, by making the unanimous guess the syntax.

**What the round then surfaced on top of that.** A cold agent wrote
`owner: payments team`, which is the obvious next guess once `owner: team-orders`
parses, and got a bare syntax error pointing at a brace. It now names the key and
writes the quoted form. That one cost an iteration and would have kept costing.

**And the gate that was supposed to catch all of this had two holes.** The skill
ratchet asserts every engine diagnostic has guidance. It read template literals
only, so any message written as a plain string was invisible — twelve were. And
it split call arguments on `[^,]+`, so any diagnostic whose location argument
held a comma never matched at all. Three of the diagnostics added this week sat
in that second blind spot; they would have shipped ungoverned. The scanner now
walks arguments counting depth and reads either delimiter, which brought sixteen
previously-unchecked messages into the gate. All were genuinely self-explanatory
and are allowlisted with that reasoning recorded.

**Honest limits.** 21-market-data passed its first `check` but failed the deep
scorer on a stylistic expectation, and its re-run took two calls — on a hint
conflict, which is the class the new "start with no layout block" doctrine in
SKILL.md is aimed at. So that doctrine is written but unproven; the next round is
its first real test. Hint conflicts remain the largest error class in this
project's history at 39 of 80 diagnostic-bearing calls, and nothing in this
change touches them. A malformed attr value also still produces a downstream
`unknown id` cascade, because the node's declaration never entered the model —
the primary diagnostic names the real fix, but "a parse failure should not
produce semantic lies" is a broader problem left open.

The corpus in `solutions/` is this round's twenty-nine answers, cold-authored and
deep-scored.
