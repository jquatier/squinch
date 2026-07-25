# The gauntlet (Phase-3 acceptance, docs/PLAN.md §3)

Ten natural-language architecture prompts. An agent, armed with only
[`packages/skill/SKILL.md`](../packages/skill/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 8/10 with zero human
layout fixes.**

- `prompts.json` — the prompts plus machine-checkable expectations
  (structure, icons, tags, views).
- `solutions/` — the agent-authored `.squinch` files under test (in-session).
- `independent/` — the certification run: solutions authored cold by fresh
  agents (see below).
- `score.ts` — deterministic scorer: builds each solution, renders every
  declared view in both themes, validates the SVG, checks expectations.

```bash
npx tsx gauntlet/score.ts                        # in-session solutions
npx tsx gauntlet/score.ts gauntlet/independent   # certification run
```

## Results

**In-session: 10/10** — authored by the model that built the tool, using skill
knowledge plus the tool's own diagnostics (two solutions initially failed with
`hint conflict … runs upward` and were fixed exactly as the error message
suggested). An upper bound by construction.

**Independent certification: 10/10** (2026-07-25) — ten fresh Claude Sonnet
sessions, one prompt each, no shared context, explicitly barred from reading
`gauntlet/`, `examples/`, `docs/` and core sources. Resources: `SKILL.md` +
the CLI, nothing else. Every solution checked clean and passed the scorer;
mean 1.8 check iterations (seven of ten passed on the first or second try;
worst case four). Every failed iteration was self-recovered from diagnostics
alone — no human intervention anywhere.

Findings feed back into the tool. From the certification run: a `layout`
block misplaced inside a `system` **crashed** `check` (two agents hit it
independently) — now a null-safe, targeted diagnostic that names the fix, plus
an explicit rule in SKILL.md. Earlier in-session findings: keywords were
accidentally reserved (`builtin/person` unwritable), `box` nodes lost their
icon — both fixed. The loop — agent error → diagnostic → self-fix → tool
hardening — is the product working as designed.
