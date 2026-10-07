# The gauntlet (end-to-end acceptance)

Thirty-seven natural-language architecture prompts. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 37/37 on the deep scorer; the
> latest round itself scored 35/37, with 25 of 37 clean on the first `check`.** The
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

**Round 29 — 35/37 on the deep scorer; 25 of 37 clean on the first `check`**
(2026-10-07, Sonnet). Run for the end of the loop rather than the language:
what an agent does between a clean `check` and its last message. Three
changes to the skill. Quality bar 3 said "look at the SVG", which no agent can
do with markup, so it now says to rasterise each view beside the source, open
the image, and delete it after. A new item 7 says nothing goes in the diagram
that the request does not support — including glue, an API or worker put
between two things the request names. And "What to hand over" now ends with
three or four plain bullets: where to open it, what was guessed, what the
agent saw when it looked.

**Six-prompt A/B rounds came first** (02, 09, 16, 25, 29, 34, against the
old skill). On the old skill no agent rendered anything it could see, and no
hand-over named a guess: all six listed their files and stopped. Four
wordings later, all six looked at a PNG, cleaned it up, and said what they
guessed. What the wordings taught:

- **The path is the instruction.** The first draft said `-o /tmp/NAME.png`;
  every agent rendered it and every `Read` was refused, because `/tmp` is
  outside the working directory. Four of the six then described a layout
  they had not seen. Beside the source, all of them could look.
- **A list gets skipped; a form reads like a log.** Five bullets of things to
  mention were followed once in six. A fixed `Open: / Assumed: / Looked:`
  block was filled in twelve times of twelve and read like CI output. Plain
  bullets with one worked example kept the coverage and lost the machine
  voice.
- **Agents copy the example's words, claims included.** An example that said
  "no wires cross" came back three times as a claim about pictures nobody had
  checked for crossings. The example now reports a rough spot it chose to
  leave, which makes reporting one the normal thing to do.

**Looking fixed one layout in thirty-seven.** Every agent in the full run
opened its render; one, 26, saw its collectors spread out and re-laid them.
The rest approved what they saw, bad pictures included: one agent called a
440×800 two-column strip "a landscape-oriented layout perfect for a 16:9
slide", and in an A/B round another approved 34's sixteen crossing wires.
The step makes the hand-over honest more often than not. It does not catch a
bad picture — measured signals from the engine would.

**Guesses are reported, not yet all of them.** Three of six named a real one
(Lambda for an unnamed service, RDS for "Postgres", DynamoDB for "a
database"). Agents rarely count a product choice as a guess, and 25 still
invented an API between its auth service and ledger in one run of six, then
said nothing was guessed. The glue sentence made that rarer; it did not end
it.

**The round's misses were 34, again, and 32.** 34 is the prompt that varies;
the corpus keeps round 27's answer for it. 32 — fourteen steps for a slide —
had been passing on a lucky draw: on the old skill it failed two runs of
three. Agents halve the chain, `wrap 7`, which is a 1432×248 ribbon, and with
`direction right` it becomes two 440×800 columns, since `wrap` writes `rows`
and under `direction right` a rank is a column. A Layout-hints bullet now says
N ≈ √(nodes folded), rounded up, for a slide, and to leave `direction right`
out of a wide fold. Its first wording said "steps", and 33 — twelve workers
under one dispatcher — went back to hand-written bands with every wire
detouring; naming the fan-out too fixed it. Confirmation runs on the final
wording: 32 six of six and 33 three of three, every one at `wrap 4`.

**Surfaced and not fixed here.** A file can check clean, `render --sync`
cleanly, and still fail `render -o x.html`. 35 did: the interactive export
lays out every auto view, and in `catalog`'s the band-split conflict — the
one measured off the result rather than the graph — fired on a system
`layout { }` block that no declared view opens. `check` and `--sync` lay out
declared views only, so the agent met the error at the last step and fixed
it there.

The corpus in `solutions/` is this round's full-run answers for thirty-three
prompts, the confirmation runs' for 26, 32 and 33, and round 27's for 34 —
all cold-authored and deep-scored at 37/37, none re-authored.
