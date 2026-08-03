// Line endings are an *input* invariant, not only an output one.
//
// The determinism contract is: same (source, packs, theme, tool version) →
// byte-identical SVG. A `.squinch` file checked out on Windows arrives CRLF,
// and the sketch theme's jitter is seeded from `hash(source)` — so without
// normalization the same diagram renders with different wobble on Windows than
// on macOS, and the contract is quietly false. The grammar itself already skips
// `\r`, which is exactly why the bug would have been invisible.
//
// This is the ONE place source line endings are normalized. It is applied at
// core's two entry points (`buildProject` and `renderProject`) rather than in
// each host, because there are many hosts — CLI, VS Code, the playground, the
// lookbook builder, the gauntlet scorer, the HTML export — and the one that
// forgets produces a subtly different diagram rather than an error.

/** CRLF (and lone CR) → LF. Returns the same string when there is nothing to
 *  do, so the common path costs one `memchr`-class scan. */
export const normalizeSource = (src: string): string =>
  src.includes("\r") ? src.replace(/\r\n?/g, "\n") : src;

/** Positions are safe across this transform: a CR only ever sits at the end of
 *  a line, so every line/character pair is identical before and after. That is
 *  what lets a host normalize its own buffer and still map core's offsets back
 *  into it — see `packages/vscode/src/features.ts`. */
export const normalizeFiles = <T extends { src: string }>(files: T[]): T[] =>
  files.some((f) => f.src.includes("\r"))
    ? files.map((f) => (f.src.includes("\r") ? { ...f, src: normalizeSource(f.src) } : f))
    : files;
