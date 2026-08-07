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

**Round 16 — 29/29 on the deep scorer; 22 of 29 clean on the first `check`**
(2026-08-07). The first round on the loosened grammar, and it found three
things, one of which was hiding in plain sight for the whole project.

**Twenty-eight errors for one mistake.** An agent declared nine nodes inside
`system warehouse` and then referenced them unqualified from a zone and a
layout. Every `unknown id` was correct and every one named its own fix —
`did you mean \`warehouse.scanner1\`?` — so the agent recovered. But a wall of
twenty-eight errors buries the single thing worth saying, which is that ids
declared inside a system are written with their prefix from outside it. Three
or more that agree on the same missing prefix now fold into one message that
says exactly that. Deliberately conservative: two stay separate, because two is
not yet a pattern, and a suggestion that is a *correction* rather than a
qualification is never folded — without that guard three typos collapse into
"3 ids are missing their `` prefix", which is nonsense wearing a confident
tone. `unknown id` was 38 of this round's 48 diagnostics and is the largest
class in the project's history after hint conflicts.

**Positional tags on edges.** `handler -> db #sensitive`, twice in one file.
When positional tags landed on nodes last round the scoping note said edges had
"no evidence" and left them out; there is evidence now, and the generalisation
is the obvious one. Refusing it would have made the rule "positional tags,
except on edges" — the kind of exception that is exactly why the comma rule
was worth fixing.

**The two person forms, crossed.** `analyst = person analyst "Analyst"` —
the inline form and the top-level form written at once — produced a bare syntax
error. It now names the doubling and offers both ways out.

**On the doctrine added last round.** SKILL.md now tells agents to start with
no layout block and add hints only to fix what they see, aimed at hint
conflicts — the biggest error class in project history at 39 of 80
diagnostic-bearing calls. This round they were 3 of 39 calls, and one of those
three is 27-rank-conflict, which exists to provoke exactly that error. So: a
possible improvement on a sample far too small to claim one, and two agents
still pinned rows that fought their own back-edges. Treat it as unproven for at
least another round.

Clean-first-try slipped from 23 to 22, which is noise at this sample size and
not worth reading either way. The round's value is the three defects, which is
this file's standard.

The corpus in `solutions/` is this round's twenty-nine answers, cold-authored and
deep-scored.
