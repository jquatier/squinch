# @squinch/skill

[`SKILL.md`](SKILL.md) is the whole contract an agent needs to author Squinch
diagrams: the grammar, the visibility rules, a layout cookbook, and the
check-render-fix loop. It is the *only* thing the twenty cold agents in the
[gauntlet](../../gauntlet/) are given, alongside the `squinch` binary — so if
something an agent needs isn't in here, the gauntlet is where that shows up.

## Using it with Claude Code

A skill is a directory containing `SKILL.md`. Install it for yourself:

```bash
mkdir -p ~/.claude/skills/squinch
cp packages/skill/SKILL.md ~/.claude/skills/squinch/
```

or per-project, so it travels with the repo you're diagramming:

```bash
mkdir -p .claude/skills/squinch
cp path/to/squinch/packages/skill/SKILL.md .claude/skills/squinch/
```

Then ask for a diagram in plain language — the frontmatter's `description` is
what makes it fire, so "draw the architecture of this service" is enough. It
needs `squinch` on PATH to be useful, since step one of the loop is
`squinch check`; until the CLI is published, build from source and put
`packages/cli/bin/squinch.js` on PATH.

## Using it with any other agent

There is nothing Claude-specific in the file below the frontmatter. Paste
`SKILL.md` into a system prompt, attach it as a tool description, or hand it to
whatever your harness calls context. What matters is that the agent can run
`squinch check` and read the diagnostics — the skill is written around that
loop, not around one vendor's format.

## Keeping it true

`test/skill.test.ts` compiles every DSL snippet in `SKILL.md` through the real
engine and asserts every icon id it names actually resolves in an installed
pack. Documentation that drifts from the language fails the build, which is the
point: an agent reading a stale cookbook produces diagrams that don't check.
