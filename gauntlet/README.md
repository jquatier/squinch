# The gauntlet (Phase-3 acceptance, docs/PLAN.md §3)

Twenty natural-language architecture prompts. An agent, armed with only
[`packages/skill/SKILL.md`](../packages/skill/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: 20/20, all twenty clean on the first `check`.** The
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

Twenty cold agents, one per prompt, each in a sandbox holding nothing but
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

The value is in the findings, not the number. A run that scores 20/20 and
surfaces a crash is a better run than one that scores 20/20 and surfaces
nothing.

## Latest round

**Round 13 — 20/20, all twenty clean on the first `check`** (2026-08-05). The
second perfect round in a row, and unlike round 12 it paid for itself: it
surfaced two real defects and one wrong claim before a single agent ran.

**The round never started the first time.** The harness bundles the CLI and
compares it against the repo CLI on a committed solution before spending money;
the bundled one died at startup with `MODULE_NOT_FOUND` on `../package.json`.
Cause: the CLI had just been changed to read its own version from its
`package.json` instead of a hardcoded string, which resolves in the repo and in
a published tarball but not in a single-file bundle where nothing sits one level
up. Nothing in CI bundles the CLI, so no test could have caught it — the
gauntlet is the only thing that does. Fixed by planting a `package.json` beside
the bundle, and the header comment enumerating "three things that survive
bundling only if planted" now says four. Users were never affected: npm ships
`package.json` next to `dist/`.

**A comma cost two iterations.** A cold agent wrote `rows [gw] [create, get,
search]` — the guess every other language invites — and got back a bare `syntax
error near`, which names the line but not the rule. Layout groups now say so
directly ("comma inside a layout group — ids separate with spaces") and write
out the corrected group. The bare error it replaces is suppressed, but only
outside string literals: a label may legitimately read `"Orders [US, EU]"`, and
swallowing a real syntax error because of one would be strictly worse than
staying quiet. All three cases are tested.

**One prompt used a plausible, valid, wrong icon.** 16-everything asks for a
"CloudFront-fronted storefront"; the agent wrote `logos/cloudflare` — a
different company — and `check` correctly passed, because the ref is real. This
is the failure mode no checker can catch: `check` tells you an id exists, never
that it is the one the reader asked for. The transcript shows the agent never
ran `icons search` at all, so SKILL.md now says to search when the request names
a specific product, and names the confusable pairs. **Honest caveat:** the
re-run got `aws/cloudfront` right but *also* never searched, so the fix is
justified on its own merits — it is not demonstrated to have caused the change.
16 is the only prompt in the committed corpus that took two sessions.

Round 12's standing complaint is unchanged and now more urgent: **these twenty
prompts have stopped discriminating.** Two ceiling rounds running. Everything
above was found by the harness, the scorer, and one agent's slip — not by the
prompt set doing its job. The next round needs harder prompts, and it needs
prompts that exercise the surface added since: `style:`/`animate:` and `badge:`
are entirely untested by cold agents, because nothing in the twenty asks for
traffic that moves or a platform with no icon pack.

The corpus in `solutions/` is this round's twenty answers, cold-authored and
deep-scored.
