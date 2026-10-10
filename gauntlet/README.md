# The gauntlet (end-to-end acceptance)

Thirty-eight architecture prompts — thirty-seven in prose, and one that hands
the agent a real repository. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 38/38 on the deep scorer; the
> latest round itself scored 38/38, with 20 of 38 clean on the first `check`.** The
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

**Round 31 — 38/38 on the deep scorer; 20 of 38 clean on the first `check`**
(2026-10-10, Sonnet). Run to measure the skill becoming a directory rather
than a file: the body, `SKILL.md`, went from 810 lines to about 690, and the
lookup material moved one level deep into `references/` — the whole layout
cookbook into `cookbook.md`, and the per-pack icon sections into `icons.md`
— each with a contents list at the top and a pointer in the body saying when
to open it. The box now holds the directory as `squinch skill` installs it,
and `run.ts` records which reference files each agent opened. The question
was whether a cold agent follows a pointer, and the answer is **no, not
once in fifty sessions**: 0 of 38 opened either file in the round, and 0 of
12 in the two confirmation runs below. Every agent read `SKILL.md`,
`PROMPT.md`, and nothing else in the box.

**Clean first checks rose from 18 to 20, and the rise hides a regression
the split caused.** Hint conflicts fell from five first failures to three
(01, 09, 27 — 23 hit one second), the two syntax shapes round 30 fixed did
not recur, and the two `rows`-across-lines errors of round 30 became one.
But **six prompts failed first on a guessed icon id** — 18 (`azure/
application-gateway`, `azure/container-registry`), 21 (`sys/process`), 22
(`sys/analytics`, `sys/ml`), 23 (`k8s/cron`), 24 (`sys/conveyor`,
`sys/display`), 35 (`sys/notification`, `logos/dbt`) — a category that was
empty in rounds 29 and 30 and held one prompt in round 27. Every guess is a
pack outside the AWS basics, which is exactly the material that had moved,
and none of the guessed words was ever in the lists: with the lists in the
body an agent picks `monitor` or `chart-line` from them; without, it writes
the word it would say and lets `check` refuse it. The misses are cheap —
each is one `did you mean` or one `icons search` away, and 5 of the 38 ran
the search, up from 0 in round 30 — but first-check cleanliness is the
number this file tracks, and the split cost six of them.

**Measured on the six prompts, two shapes.** First the pointer sharpened:
loop step 1 now says an id outside the AWS basics is looked up before the
first `check`, naming the file and the search, and the Icons section opens
with the pointer instead of closing with it. Six cold runs: none clean, none
opened the file, five of six failed first on a guessed id again (`sys/batch`,
`sys/ai`, `sys/device`, `sys/web`, and 18's `azure/container-registry` a
second time). Rewording the skill moved nobody, as rounds 26 and 30 had
found of other sections. Then the compact id lists restored to the body —
the Azure short forms, the k8s short names, two dozen `logos/` marks, and
the `sys/` names by theme, as `·`-separated runs under the six-pack bullets
rather than the prose and tables of `icons.md` — about thirty lines. Six
cold runs: **no icon first failure at all**; the first failures were hint
conflicts on 21, 22 and 23, `rows` wrapped across lines on 35, and a
warning on 24, with 18 clean. That is the shape that ships: the cookbook is
entirely in `references/`, `icons.md` keeps the full material (the Google
Cloud marks and category rule, the Databricks table, the aliases), and the
body carries the id lists it turns out to need as *vocabulary* rather than
lookup. The sharpened pointer stays too, since it states the true rule and
costs six lines, but nothing here says it is read.

The lesson, recorded so the next audit does not relearn it: for a cold
agent the inline lists are not reference material, they are the vocabulary
it writes from, and a pointer to a sibling file is a sentence it agrees
with and does not act on. What can move out of the body is what the
diagnostics already carry — the cookbook moved without a trace, because a
`hint conflict` writes its own `rows` line and nobody had needed the row.

**The rest of the first failures**, all fixed in one step: 16 wrote `contains
gw catalog orders` with spaces — the comma-optional rule covers `rows [a b]`
and `align a b` and the skill says so, and a path list is the one place a
comma is still required; worth a grammar look. 29 wrote `actor` for
`person`. 34 put `icon:` on a leaf. 28 and 32 chained edges. 19, 26, 30 and
31 re-ran on a warning.

**35 in the lists-restored run declared one view** for a two-area monorepo
and failed the scorer's `views ≥ 2`, as it had in round 26. The corpus
keeps the full round's answer for 35 (six checks, two views, passing); the
other five confirmation answers are committed, since they came from the
shape that ships.

The corpus in `solutions/` is this round's answers for thirty-three prompts
and the lists-restored confirmation's for 18, 21, 22, 23 and 24 — all
cold-authored and deep-scored at 38/38, none re-authored.
