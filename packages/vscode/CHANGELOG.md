# Changelog

## Unreleased

Pre-alpha, not yet published to the Marketplace. Install the `.vsix` built by
`pnpm --filter squinch-vscode package` — see the [README](README.md).

What works today:

- **Language server** over `.squinch` files: completions that know which block
  the cursor is in, live diagnostics with quick fixes, hover, and document
  symbols.
- **Preview pane** that re-renders as you type, following the view under the
  cursor.
- **Five icon packs** bundled (AWS, Azure, Kubernetes, logos, sys — 1,279
  marks), so icon completion and validation work in an installed copy with
  nothing from the repo.
