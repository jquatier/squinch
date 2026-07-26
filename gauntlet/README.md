# The gauntlet (Phase-3 acceptance, docs/PLAN.md §3)

Sixteen natural-language architecture prompts. An agent, armed with only
[`packages/skill/SKILL.md`](../packages/skill/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 13/16 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

- `prompts.json` — the prompts plus machine-checkable expectations
  (structure, icons, tags, views).
- `independent-v2/` — the current certification set: 16 solutions authored cold
  by fresh agents. CI regression-tests this corpus on every push.
- `independent/` — the first certification run (10 prompts), kept as a record.
- `score.ts` — deterministic scorer: builds each solution, renders every
  declared view in both themes, validates the SVG, checks expectations.

```bash
npx tsx gauntlet/score.ts                        # the current certified set
npx tsx gauntlet/score.ts gauntlet/independent   # the first run, for comparison
```

## Results

**Round 2 — 16/16** (2026-07-25), the certification that matters now. Six more
prompts were added to cover everything built after round 1: zones, numbered
flows, `channel` trunks, tag lenses, the logos pack, and one end-to-end prompt
combining most of it. Six fresh Sonnet sessions, one prompt each, no shared
context, barred from reading `gauntlet/`, `examples/`, `lookbook/`, `docs/` and
the engine. Resources: `SKILL.md` and the CLI.

Every prompt passed. More usefully, the run found nine real defects — a crash, a
silent no-op, a silently-dropped hint, and six documentation faults — all listed
in "What round 2 found" below.

**Round 1 — in-session: 10/10** — authored by the model that built the tool, using skill
knowledge plus the tool's own diagnostics (two solutions initially failed with
`hint conflict … runs upward` and were fixed exactly as the error message
suggested). An upper bound by construction.

**Round 1 — independent: 10/10** (2026-07-25) — ten fresh Claude Sonnet
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


## What round 2 found

Cold agents are worth more than the score they produce. Round 2's nine findings:

**Engine**
1. **A crash.** `expand`ing a container while an edge targets that container's
   bare id handed ELK a port id that does not exist, producing a raw
   `JsonImportException` and exit code 2 — no location, no problem statement,
   no fix, in direct violation of the "errors serve the agent loop"
   non-negotiable. Edges now attach to the compound itself.
2. **`include #tag` was a silent no-op.** `include` adds to a view and cannot
   narrow one, so an auditor view written as `include #pci` checked clean and
   rendered *everything*. An include that changes nothing now warns and names
   the alternatives.
3. **Zones could vanish silently.** A zone whose members all sit inside
   collapsed cards simply did not render. Now a warning naming the members,
   suppressed for auto-generated views.

**Documentation** — each of these cost a cold agent a wasted iteration:
4. `cols` was implemented but never documented, so no agent could use it.
5. The cookbook recommended `include #pci` for "show only one concern" — the
   exact thing finding 2 proves does not work. It now points at `highlight`.
6. The flow example showed steps whose edges were never declared, leaving it
   unclear whether flows create connections. Rewritten self-contained.
7. `rows` + `place` on the same node is an error the docs stated but the
   cookbook did not, and the mistake is natural. Now keyed to the error text.
8. Nothing said that `include *` shows only *top-level* entities, so wrapping
   services in a parent `system` for grouping collapses them into one card.
9. Edge-level `tags:`, `glyph:` with non-`sys` packs, the three `box` kinds, and
   `view` taking no positional label were all undocumented or ambiguous.

The methodology note from round 1 still holds: the value is in the findings, not
the number. A run that scores 16/16 and surfaces a crash is a better run than
one that scores 16/16 and surfaces nothing.
