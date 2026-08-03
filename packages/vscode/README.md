# Squinch for VS Code

Language support and a live preview for `.squinch` architecture diagrams.

- **Diagnostics** as you type — the same checks `squinch check` runs, including
  hint conflicts that only appear once a view is laid out.
- **Quick fixes** — every `did you mean …?` is one click.
- **Completion** — all 1,279 icons (`aws/`, `azure/`, `logos/`, `sys/`, `k8s/`, `builtin/`), node paths after
  an arrow, and the keywords legal in the block you're editing.
- **Hover** — icon titles, node labels, descriptions and tags.
- **Outline** — systems and their children, plus zones, flows and views.
- **Live preview** — *Squinch: Open Preview to the Side*, with a view picker;
  theme via `squinch.preview.theme`.

## Running it

From the repo root, press <kbd>F5</kbd> ("Run Squinch extension") — the
pre-launch task bundles core and the extension, then opens `examples/` in a
development host.

The bundle task deliberately runs in a login+interactive shell: VS Code
launched from the Dock inherits a minimal `PATH`, and Node version managers
(nvm, fnm, volta, asdf) add `node`/`pnpm` from `~/.zshrc` or `~/.bashrc`, which
a plain task shell never sources. If a task ever reports `command not found:
pnpm`, that is the cause.

Or bundle by hand:

```bash
pnpm --filter @squinch/core build && pnpm --filter squinch-vscode build
```

## Installing it into your own VS Code

Download `squinch-vscode-<version>.vsix` from the repo's
[GitHub Releases](https://github.com/jquatier/squinch/releases) — each release
carries a `SHA256SUMS` beside it — and install:

```bash
code --install-extension squinch-vscode-<version>.vsix
```

The same file installs in Cursor, Windsurf and VSCodium. A sideloaded VSIX
never auto-updates: to update, download the next release and install it over
the old one.

Or build it from a checkout — no marketplace account needed:

```bash
pnpm install && pnpm -r build
pnpm --filter squinch-vscode package     # writes packages/vscode/squinch.vsix
code --install-extension packages/vscode/squinch.vsix
```

Then reload VS Code. (No `code` command? In VS Code: <kbd>⌘⇧P</kbd> → *Shell
Command: Install 'code' command in PATH*. Or install from the UI: Extensions
view → `…` menu → *Install from VSIX…*.)

The package is self-contained — the bundle inlines the engine and all five icon
packs ship beside it, so an installed copy needs nothing from this repo.
Uninstall with `code --uninstall-extension squinch.squinch-vscode`.

## Layout

`src/features.ts` holds every piece of editor intelligence as pure functions
over source text, unit-tested in `test/features.test.ts`. `src/server.ts` is a
thin LSP shell over it; `test/server.test.ts` drives the bundled server over
real stdio LSP. `src/extension.ts` is the client plus the preview webview.

## Publishing

GitHub Releases is the current channel: `pnpm release` from the repo root tags
a version, and CI builds the VSIX from that exact commit and attaches it. The
VS Code Marketplace is deliberately deferred — it needs the publisher ID
claimed first — and nothing about the artifact changes when it happens; the
listing just becomes another place the same VSIX lives. See
[CHANGELOG.md](CHANGELOG.md).
