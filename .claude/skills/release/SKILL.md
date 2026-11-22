---
name: release
description: Cut a squinch release — write the release notes as prose in the house style, with each new feature's SVG beside the paragraph that announces it, show them to the maintainer, and only on their go-ahead run `pnpm release`. Use when asked to release, cut, tag or ship a version of squinch.
---

# Cutting a squinch release

`pnpm release` (scripts/release.mjs) does the mechanics: bumps every manifest,
writes the CHANGELOG section, commits, tags and pushes; `.github/workflows/release.yml`
then builds, tests, publishes the GitHub Release with that section as its
notes, and publishes to npm. What it cannot do is write the notes. Its draft is
the commit list, with the SVG of every new lookbook case and example embedded
under the commit that added it. This skill turns that draft into the notes a
reader deserves — and the maintainer approves them before anything is tagged.

A tag push publishes to npm. **Never run `pnpm release` without `--dry-run`
until the maintainer has read the notes and said to go ahead.**

## 1. Preflight

- On `main`, clean, up to date with `origin/main` — `pnpm release` refuses
  otherwise; check first so the refusal is not the first thing they see.
- Tags fetched: `git fetch --tags origin`. The last tag is
  `git describe --tags --abbrev=0`; the range is `<lastTag>..HEAD`.
- The version: use the one the maintainer gave. If none, propose one from
  the range — a new language feature or a picture that changes is a minor
  bump (0.21.0 → 0.22.0), fixes only a patch — and ask.

## 2. Read what changed

- The draft, images placed: `pnpm release <version> --dry-run --no-edit`.
  Keep every `![…](…?raw=true)` line it prints: those are the pictures.
- The commits whole, not only subjects: `git log --no-merges <lastTag>..HEAD`.
  Skim the diffs of the big ones. The notes describe what a user can now do,
  not what was refactored.
- Whether existing diagrams redraw: committed renders changed in the range —
  `git diff --name-only --diff-filter=M <lastTag>..HEAD -- 'examples/**/*.svg' 'lookbook/out/*.svg'`.
  Any → the notes say which views redraw and to run `squinch render --sync`.
  None → they say "No existing diagram redraws."
- Whether the skill changed: `git diff --quiet <lastTag>..HEAD -- packages/skill/skills`
  exits 1 → the notes say to re-run `squinch skill`.

## 3. Write the notes — the house style

Read the last two sections of `CHANGELOG.md` before writing; they are the
model. In short:

- **Open with the headline feature**: one bold sentence saying what a user can
  now do, a sentence or two on why it matters, then a short `squinch` code
  block showing it, then its picture.
- Then the redraw line and, if the skill changed, the `squinch skill` line.
- A `### <Feature>` section per feature: bullets that each open with a bold
  claim, then the detail. Real numbers where there are any (crossings, ms,
  counts) — never vague ones.
- `### Fixed` — what was wrong, in the user's terms, and what happens now.
- `### Agents` — what the skill now teaches; the latest gauntlet round's
  result if one ran in the range.
- `### Also in this release` — the rest, briefly.
- **Every picture beside the paragraph that announces its feature**, as its
  own line. Use the image lines from the dry run as they are — the alt text
  and the `blob/v<version>/…?raw=true` URL are already right. Never gather
  them at the end, and never link a picture at another tag.
- Link a new lookbook case or example at `blob/main/…` (the case's source),
  as 0.21.0 does.
- No commit hashes, no internal names (`weft` internals, test files), no
  "refactor" entries. Plain English, present tense, no hype words.

Write the notes to a file outside the repo (the scratchpad), not to
CHANGELOG.md — `pnpm release` writes that.

## 4. Check them

`pnpm release <version> --dry-run --notes-file <file>` — it prints the
section as it will be published, and:

- names any new feature the notes show **no picture** of ("your notes show no
  picture of …") — place each one, then run it again;
- stops on a picture linked at another version or of a missing file.

Both must be clean.

## 5. Show the maintainer, then release

Show the notes in full and wait for an explicit go-ahead. Then:

```bash
printf 'y\n' | pnpm release <version> --notes-file <file>
```

(`y` answers the "tag and push?" prompt — only after they said go.) It pushes
`main` and the tag; give them the Actions link it prints. If the workflow
fails, no release exists: fix on `main` and cut the next patch number, never
re-tag.
