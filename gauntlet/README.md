# The gauntlet (Phase-3 acceptance, docs/PLAN.md §3)

Ten natural-language architecture prompts. An agent, armed with only
[`packages/skill/SKILL.md`](../packages/skill/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 8/10 with zero human
layout fixes.**

- `prompts.json` — the prompts plus machine-checkable expectations
  (structure, icons, tags, views).
- `solutions/` — the agent-authored `.squinch` files under test.
- `score.ts` — deterministic scorer: builds each solution, renders every
  declared view in both themes, validates the SVG, checks expectations.

```bash
npx tsx gauntlet/score.ts
```

Current status: **10/10** — authored in-session by the model that built the
tool, using skill knowledge plus the tool's own diagnostics (two solutions
initially failed with `hint conflict … runs upward` and were fixed exactly as
the error message suggested — that loop is the product working as designed).

Honest caveat: the true certification is an **independent** agent — a fresh
session, ideally a smaller model — running these prompts cold. This harness
makes that run reproducible and scoreable; treat the in-session score as an
upper bound. Findings so far either became fixes (keywords were accidentally
reserved words — `builtin/person` was unwritable; `box` nodes lost their icon)
or confirmed the diagnostics carry their weight.
