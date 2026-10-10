# The gauntlet (end-to-end acceptance)

Thirty-eight architecture prompts — thirty-seven in prose, and one that hands
the agent a real repository. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 38/38 on the deep scorer; the
> latest round itself scored 38/38, with 18 of 38 clean on the first `check`.** The
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

**Round 30 — 38/38 on the deep scorer; 18 of 38 clean on the first `check`**
(2026-10-09, Sonnet). Run to check a restructuring of the skill rather than a
change to it. An audit against the published skill-authoring guidance found
one thing that mattered: Claude Code keeps only the first 5,000 tokens of an
invoked skill after context compaction, and the quality bar — the one
checklist the file has — sat last, past that cut. It now sits right after the
loop, unchanged in wording, and the frontmatter gained a `compatibility`
line naming the CLI it drives. The question was whether every agent would
still do what the bar asks, and all 38 did: each rasterised a view and opened
it, ran `--sync`, and wrote the HTML.

**First-check cleanliness fell, from 25 of 37 to 18 of 38.** Nothing in the
checklist changed, so this is not attributed to the move, and the round is
one sample; the number is recorded so the next one can say whether it was
noise. The failures themselves were the usual ones and three new shapes:

- **Bands against the arrows**, the "runs upward" conflict, on five prompts
  (01, 09, 21, 27, 34) — still the largest single cause, as the skill's own
  Layout-hints opening says. 27 took nine checks: the agent alternated
  between the upward conflict and the unlisted-bus conflict three times before
  leaving the band unhinted, each fix walking straight into the other error.
- **Three bare syntax errors**, each a shape a cold agent reasonably writes.
  38 wrote `person load "Load Generator" { description: "…" }`: the top-level
  `person` form took no block while `load = person "…" { … }` did, so a
  description on an actor was three syntax errors with no fix. 35 wrote
  `preview identity, catalog, commerce` — the shape `exclude a, b` already
  accepts — and got one. 24 wrapped `rows` across three lines, and the
  dedicated diagnostic from round 23 did fire, so that one is already
  handled.
- **Self-explanatory diagnostics** fixed in one step: chained edges on 32,
  bare ids from outside a system on 25, a zone whose members sat inside
  collapsed cards on 11.

**Fixed since: the two syntax shapes.** `person id "Label"` now takes the
same attr block and trailing tags as `id = person "Label"`, and both go
through one declaration — which also made a duplicated top-level person a
duplicate-id error where it used to overwrite silently. `expand`, `preview`
and `detail` take a comma list, one entry per path, exactly as separate lines
would; an unknown id inside the list is reported at the id. The goldens and
every committed render are byte-identical, since none of this reaches the
drawing.

**34, measured and changed.** The one miss was 34 again, for the fifth
round, so it was run alone. Three cold runs on the committed skill and
prompt: none passed, and every answer declared one view and told the reader
the HTML "has all 16 views, landscape plus each service's detail view" — the
automatic views read to an agent as altitudes delivered. Two of the three also
made a system per service, which the prompt's one-folder-per-service layout
invites and 35's domain folders never do. The skill was tried first: the
big-system section rewritten to name the folder-per-service trap and to say
that a view per area is written out, not left to the automatic one. Three
runs: none passed — two per-service, one flat — so the section moved nobody,
as round 26 had found of it. Then the prompt: one sentence appended, in a
user's words and naming no construct — *"It is for the team wiki: an overview
page that fits on one screen, and then a page for each part of the system."*
Three runs with that sentence and the skill edit passed three; three with the
sentence alone passed three, four areas each and a declared view per area.
The skill edit is not kept, the sentence is, and 34 stops being the prompt
that varies. What the prompt lost is the one thing round 26 kept it for — a
large system with no steering at all — and the six runs say that test had
only ever measured whether an agent counts automatic views as pages.

38, the repository prompt, passed on its first run of this round — five
checks, the first three spent on the person block above.

The corpus in `solutions/` is this round's answers for thirty-seven prompts
and, for 34, one of the three confirmation runs on its new wording — all
cold-authored and deep-scored at 38/38, none re-authored.
