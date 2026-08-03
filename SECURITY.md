# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/jquatier/squinch/security/advisories/new)
rather than opening a public issue. Expect an acknowledgement within a few days.

If you'd rather not use GitHub, open an issue saying only that you have a
security report and how to reach you — no details.

## What is in scope

Squinch turns text into SVG and runs in places where the input may not be
yours: a CI job rendering a contributor's `.squinch` file, a VS Code preview
webview, a browser playground. The parts worth attacking:

- **The pack sanitizer** (`packages/core/src/packs/sanitize.ts`) — icon SVGs are
  third-party artwork, sanitized at load with an element/attribute allowlist that
  strips scripts, event handlers, `foreignObject` and external references, and
  namespaces internal ids. Anything that gets executable content, an external
  fetch, or an id collision past it is a vulnerability.
- **Rendered SVG output** — an exported `.svg` must never contain script. It is
  embedded in READMEs and served by other people's sites.
- **The interactive HTML export** (`packages/core/src/render/html.ts`) — the one
  artifact that carries a script, deliberately. It must remain self-contained:
  no network fetches, no external references, and no path by which diagram
  source becomes executable code in the viewer.
- **The VS Code preview webview** and the language server
  (`packages/vscode/`) — content rendered from workspace files.
- **The playground** (`apps/spa`) — including the share link, whose payload is
  attacker-supplied source in a URL fragment.
- **Path handling in the CLI** — `render --sync`/`--check` write files next to
  the source; escaping the project directory would be a bug worth reporting.

## What is not in scope

- A diagram that renders badly, overlaps, or looks wrong. That's a normal issue.
- Denial of service through a deliberately enormous model. Performance budgets
  are in `docs/PLAN.md` §2; pathological input degrading is expected, though a
  small input causing unbounded work is worth reporting.
- Anything requiring the attacker to already control the machine running
  Squinch.
- Vulnerabilities in the icon artwork's upstream sources. Report those upstream;
  tell us too if the sanitizer should have caught it.

## Supported versions

Pre-1.0: only the latest release gets fixes.
