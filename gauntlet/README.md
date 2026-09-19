# The gauntlet (end-to-end acceptance)

Thirty-five natural-language architecture prompts. An agent, armed with only
[`packages/skill/skills/squinch/SKILL.md`](../packages/skill/skills/squinch/SKILL.md) and the `squinch` CLI,
must produce a clean diagram for each. **v1 ships at ≥ 16/20 with zero human
layout fixes** (the original ≥ 8/10 bar, at the current prompt count).

> **Current standing: the committed corpus scores 35/35 on the deep scorer; the
> latest round itself scored 34/35, with 22 of 35 clean on the first `check`.** The
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

**Round 26 — 34/35 on the deep scorer; 22 of 35 clean on the first `check`**
(2026-09-18, Sonnet). Run for two new prompts about a *large* system (34, 35)
and the skill section written for them, "When the system is big". The pattern
behind it: people drop an agent into a big repo, say "diagram the system", and
get one enormous page or a landscape with every backend in a row, where they
wanted altitudes. No outside-sandbox read; no agent looked at a render.

**The one miss is not this round's change.** `21-market-data` wrote a single
`animate:` value where the prompt's three cadences need two. The same agent
failure appeared three days earlier in a subset run on the *previous* skill, so
it is that prompt's own variance. The corpus keeps round 25's answer for 21 —
the only one of the thirty-five not authored this round or its re-runs — which
is why CI scores 35/35 while the round scored 34.

**What the new prompts showed, measured before the round over twenty-two cold
sessions** (two prompts, the current skill against four wordings):

- *Agents use structure they are handed and rarely invent it.* Given domain
  folders (35), every agent grouped by folder with or without the new section;
  what the section added there was a declared view per area. Given sixteen
  services and no grouping (34), both control agents drew them flat, around
  twenty things across a 2200px landscape.
- *Placement beat wording.* Every agent read the whole skill, planned by
  transcribing the prompt's list, and several wrote "16 backend services" in
  that plan before drawing sixteen cards. The section alone, 300 lines in,
  moved nobody. A two-sentence step 0 at the top of the loop produced the
  only well-grouped answers — about one in four on 34.
- *Grouping advice gets satisfied the cheapest way.* The first wording got
  all sixteen services in one `backend` system from both agents: a tidy
  landscape, and thirty-six boxes one click down. Hence "it holds at every
  altitude".
- *One agent made it worse*: sixteen systems, all listed in one `rows` band,
  a strip nearly 6000px wide. Hence the sentence telling agents never to
  answer a fan-out that way.

So this is guidance, not a fix: prose moves the ungrouped case only partly,
and 34 is the prompt where a future skill or engine change will show. It was
kept deliberately free of numbers — no "at most N boxes", no aspect ratio. A
`check` size warning was designed and dropped for the same reason, and because
the maintainer preferred a wide six-across landscape to a squarer one: shape is
not a quality measure. Both new prompts score on having used altitudes
(`minSystems`, `minViews`, `requireNarrowerView`), not on size.

**Two router defects, both fixed in this commit.** The new answers drew two
things the corpus never had, and the invariant sweep caught both as a coplanar
wire ending on no boundary (`docs/notes/coplanar.md`, "Round 26"):

- *An edge from an area itself.* `31-checkout-tiers` wrote `checkout ~>
  fulfillment` with `checkout` expanded. The router's straight branch took the
  frame for a bare leaf, ran the wire at the frame's mid-height and stopped it
  in empty canvas below a one-card neighbour. A container endpoint now jogs
  through the gutter like any other unit. No existing render moved.
- *A band the layouter could not keep.* 35 banded six areas in one row and left
  the Kafka bus they all talk through out of `rows`. ELK layered four of the
  areas below the bus, the band came back as two tiers, the hint was silently
  not honoured, and the router drew `commerce → fulfilment` as a 12px stub. It
  is now a check error naming the wedge and writing the `rows` line that
  passes. Zero of the corpus's 67 views with `rows` trip it; every hit was a
  large-system answer. 35 was re-run cold against the fixed engine and that
  answer is the one committed — the agent listed the bus itself and never met
  the new error.

**The committed answers, as drawn.** 34 grouped into four areas — the good
outcome, about one in four in the runs before the round — but banded them one
per row, so its landscape is a tall strip, and its second view still opens all
four at once. 35 grouped by folder with three declared views. Neither was
re-rolled for a better-looking sample: the corpus is a record, and a re-roll
hides the real rate.

**A third fix, the silent kind.** A container's `icon:` was never validated,
where its `glyph:` and a zone's `icon:` are. The first 35 answer wrote `icon:
sys/shopping-cart` and 15 wrote `icon: k8s/k8s`; neither exists, `check` passed
clean, and each card drew a `?` tile. Grouping guidance makes agents write more
container icons, so this was going to recur. It is the same two errors as
`glyph:` now, with the did-you-mean. 15 was re-run cold against the check, as
35 was against the router fix, and those re-runs are what is committed.

Also seen: the new prompts were the round's most expensive, seven and ten
`check` calls (six on 35's re-run) — hint conflicts inside the areas they
created, the rank-conflict class that survives the skill. `subtitle:` held at
eighteen of thirty-five.

The corpus in `solutions/` is this round's answers for thirty-four prompts and
round 25's for `21-market-data`, cold-authored and deep-scored, none
re-authored.
