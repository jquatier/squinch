# Squinch for VS Code

Language support and a live preview for `.squinch` architecture diagrams.

- **Diagnostics** as you type — the same checks `squinch check` runs, including
  hint conflicts that only appear once a view is laid out.
- **Quick fixes** — every `did you mean …?` is one click.
- **Completion** — all 316 icons (`aws/`, `sys/`, `builtin/`), node paths after
  an arrow, and the keywords legal in the block you're editing.
- **Hover** — icon titles, node labels, descriptions and tags.
- **Outline** — systems and their children, plus zones, flows and views.
- **Live preview** — *Squinch: Open Preview to the Side*, with a view picker;
  theme via `squinch.preview.theme`.

## Running it

From the repo root, press <kbd>F5</kbd> ("Run Squinch extension") — the
pre-launch task bundles core and the extension, then opens `examples/` in a
development host. Or bundle by hand:

```bash
pnpm --filter @squinch/core build && pnpm --filter squinch-vscode build
```

## Layout

`src/features.ts` holds every piece of editor intelligence as pure functions
over source text, unit-tested in `test/features.test.ts`. `src/server.ts` is a
thin LSP shell over it; `test/server.test.ts` drives the bundled server over
real stdio LSP. `src/extension.ts` is the client plus the preview webview.

Not packaged as a `.vsix` yet — the bundler copies the AWS pack beside the
output so that path already works when we do.
