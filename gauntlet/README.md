# The gauntlet (Phase-3 acceptance, docs/PLAN.md §3)

Twenty natural-language architecture prompts. An agent, armed with only
[`packages/skill/SKILL.md`](../packages/skill/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

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
material for a `SKILL.md` edit — that loop, not the score, is what rounds 2 and
3 were actually worth.

A failed session leaves the committed solution untouched and reports
`no-solution`: losing a good diagram to one rate-limited session is the worst
thing a maintenance script can do. `--prune` opts into strict overwrite.

Rounds 1–3 were orchestrated by hand, one conversation per prompt; the earlier
rounds' solution directories are gone with them. The findings below are the part
worth keeping, and the originals remain in git history.

## Results

**Round 4 — 20/20** (2026-07-31), the first round run by `run.ts` rather than by
hand: twenty sandboxed Sonnet sessions, 4 at a time, ~18 minutes, zero
outside-sandbox reads. **7 of 20 were clean on the first `check`**, which is the
number that matters and the one earlier rounds could not measure at all — nobody
was counting invocations before the shim existed.

It found five defects, three of them in the engine.

**Engine**

1. **`check` crashed with a raw null deref** — `Cannot read properties of null
   (reading 'from')`, exit 2, no location, no fix, in direct violation of the
   "errors serve the agent loop" non-negotiable. `scope`, `title` and `theme`
   each took their operand with a `!`, so *any* keystroke between typing the
   keyword and typing its argument threw — which means it crashed the language
   server too, on every edit. An agent reaching for "show everything" wrote
   `scope *`, which parses as a `ScopeStmt` with no `Path`, and hit it twice.
   All three now diagnose; `scope *` points at `include *`, the thing that
   actually widens a view.
2. **A valid diagram failed `check` with a view the author never wrote.** With
   no `view` block and no container to auto-generate one, the CLI's view list
   fell back to a literal `["default"]` that every caller then handed the
   renderer. Round 3's fix — an unknown `--view` is now a hard error — armed
   that sentinel, so `check` reported ``unknown view `default` `` with the fix
   text "this project declares no views": the tool contradicting itself in one
   sentence. **Five of twenty agents hit it**, the single most common failure of
   the round, and `--sync` was broken the same way. `default` is now a filename
   label and never a view request.
3. **`place` + `rows` was only half-guarded** (found in the single-prompt run
   that preceded this round, and hit again here by three more agents). The
   check listed only `right-of`/`left-of`, so `above`/`below` — the directions
   that collide with `rows` on the axis `rows` actually pins — passed at exit 0
   with one hint silently dropped. `cols` had no guard at all.

**Documentation**

4. **The cookbook row for the rows+place error was keyed to the wrong string.**
   "a node can hold only one rank position" is the fix text of a *different*
   diagnostic (a node listed in `rows` twice), so an agent hitting the real
   error found nothing and an agent listing a node twice was pointed at a
   `place` problem it did not have. Both errors now have their own row.
5. **"Show only one concern" was answered with `highlight`, which shows
   everything.** Prompt 14 asks for "an auditor's view that shows only the
   PCI-tagged parts"; the agent wrote `highlight #pci`, producing a view titled
   "PCI Scope" that renders the whole platform with the rest greyed — a
   different claim, at exit 0, and the only prompt the scorer failed. The row
   did mention `exclude`, but at the end of a long cell under a headline that
   said "show only". Fixing the row was not enough: a re-run picked `highlight`
   again, because the *reference block* an agent copies from listed `highlight`
   and no tag-based `exclude`. With both fixed it narrowed correctly.

Still open, and the reason finding 5 took two attempts: **there is no way to say
"only #tag"**. `include #tag` cannot narrow (round 2, finding 2), so an auditor
view has to enumerate the complement by id — backwards for the one feature whose
entire purpose is selecting a cross-cutting slice. Round 2 papered over this by
pointing at `highlight`; two rounds later it is still the sharp edge.

**Round 3 — 20/20** (2026-07-26). Four prompts were added for everything built
after round 2: the Azure pack, boundaries three deep, a flow to walk through,
and a hybrid estate mixing Azure with `logos`. Four fresh cold sessions, one
prompt each, barred from `gauntlet/`, `examples/`, `lookbook/`, `docs/` and the
engine.

Every prompt passed — three of the four on the *first* `check`, which is the
result that mattered least. The run found seven real defects, four of them
silent, listed in "What round 3 found" below. The headline: a whole `layout`
block could be dead code, and a typo'd `--view` could hand you a different
diagram with exit 0.

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


## What round 3 found

Three of four agents passed on the first `check`, so the score says the tool is
fine. It wasn't. Four of these seven are *silent* failures — clean exit, valid
SVG, wrong diagram — which is the category a scorer structurally cannot catch
and only a reader can.

**Engine**

1. **A whole `layout` block could be dead code.** Ranking granularity is the
   outermost zone, so members of one zone collapse to a single unit: `rows`,
   `cols`, `place` and `align` between them were discarded, *and* the
   "runs upward" conflict check was comparing that unit against itself. Wrap a
   diagram in one boundary — the normal shape for a cloud estate, and what
   prompt 18 asks for — and deliberately inverted rows rendered byte-identical
   to no hints at all, with `check` reporting nothing. The agent only caught it
   by hashing two renders. Now a warning naming the nodes and the zone.
2. **`align` could drag a node outside its own boundary.** Zone frames are
   sized by ELK long before the align pass moves anything, so a snap could
   leave a member drawn outside the zone that contains it — the diagram
   asserting something false, `check` exit 0. Now refused with a warning, in
   the same shape as the existing "would collide" skip.
3. **A typo'd `--view` rendered a different diagram and exited 0.** An unknown
   view name fell through to the implicit default: not a no-op, a *different*
   picture with none of the named view's settings. Two agents found it
   independently. For a tool whose premise is an agent loop driven by exit
   codes, this was the worst possible failure mode. Now an error with
   did-you-mean.
4. **`icons search` failed on the queries people actually type.** It was a raw
   substring test against the id, so `"front door"`, `"key vault"`,
   `"api management"`, `"container registry"` and `"data factory"` all returned
   nothing while the icons sat right there. All four agents hit it. Worse, two
   concluded SKILL.md was *wrong* and nearly rewrote correct files — the ids it
   documents are real, search just couldn't find them. Now matches every word
   against id and title, singular/plural aware, with short acronyms left
   unstemmed so `sqs` doesn't match `postgresql`.
5. **Search hid the aliases the docs teach.** One row per icon is right, but
   answering only `azure/key-vaults` reads as proof that `azure/key-vault` —
   which SKILL.md tells you to write — does not exist. Rows now name their
   short forms.
6. **No way to list a file's views.** The quality bar says render every view you
   declared; the tool wouldn't say what those were. All four agents ended up
   copying the file to a scratch directory and running `--sync` to read the
   names back off disk. `check` now prints them, and `--format json` carries
   them.

**Documentation** — each cost a cold agent real time:

7. `title` in a view renders nothing unless the view also has a `titleblock`;
   the first view example in the guide leads with `title`. Three agents wrote
   one and wondered where it went. Also fixed: top-level components were never
   shown (every example nests them in a `system`), `flow` block placement was
   never stated, mixing a cloud pack with `logos` read as forbidden when it is
   the normal way to draw a hybrid estate, zone `icon:` looked like a closed
   list of AWS group marks, zone `kind` silently drives colour so nested zones
   come out the same shade, and `show descriptions` truncates without warning.

The methodology note from rounds 1 and 2 holds, and this run is the clearest
case of it yet: **20/20 with seven defects found is a better run than 20/20 with
none.** Three agents needed one iteration and still surfaced a bug that made an
entire feature inert.

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
