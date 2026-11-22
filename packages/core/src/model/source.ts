// Line endings are an *input* invariant, not only an output one.
//
// The determinism contract is: same (source, packs, theme, tool version) →
// byte-identical SVG. A `.squinch` file checked out on Windows arrives CRLF.
// The grammar itself skips `\r`, so nothing *fails* — which is precisely the
// danger: anything downstream that reads the source text rather than the parse
// tree sees a different string on Windows and quietly renders a different file.
// The sketch theme was the first such reader (its jitter hashed the source, so
// a CRLF checkout wobbled differently); it is gone, and the rule outlives it —
// labels, descriptions and titleblock values are all source text that reaches
// the SVG verbatim, and a host mapping `Loc` offsets back into its own buffer
// depends on the same normalization.
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

/** A string literal's text. The one-line form loses its quotes. A block —
 *  `"""` to `"""` — loses them too, and the indentation it was written at:
 *  the line breaks just inside each quote (so the text can start and end on
 *  lines of their own) and whatever leading spaces every non-blank line
 *  shares, so a block indented to sit inside a view reads as if written at
 *  the margin. Blank lines inside stay — they are paragraph breaks. */
export function unquote(literal: string): string {
  if (!literal.startsWith('"""')) return literal.slice(1, -1);
  const lines = literal.slice(3, -3).split("\n");
  if (lines.length > 1 && !lines[0].trim()) lines.shift();
  if (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut).trimEnd()).join("\n");
}
