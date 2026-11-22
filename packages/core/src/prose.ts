// Prose: the few kinds of formatting a note or a view's `about` may carry, and
// the lines they wrap to. Shared by layout (a note's size) and the renderer
// (what it draws), so the two can never disagree about where a line breaks —
// the reason `noteBox` exists, at a larger scale.
//
// The set is closed and small on purpose, and every member is something the
// bundled faces can draw (no environment fonts, ever — CLAUDE.md):
//
//   a blank line      a new paragraph
//   "- " at a line's start   a bullet; a line after it, not blank and not a
//                     bullet, continues it
//   **bold**          Inter 600
//   `code`            the bundled mono, on a quiet plate
//   [text](https://…) a link — absolute http(s) only, as `link:` is
//
// Anything else is text, drawn as typed. Two spellings would read as a mistake
// once drawn — a heading's `#` and an emphasis's single `*` or `_`, which have
// no face to draw them in — and those are reported (`unsupported`) so the
// check can say so, rather than a reader finding the asterisks.
import { measure, type FontFamily } from "./metrics.js";

export type RunStyle = "plain" | "bold" | "code" | "link";
export interface Run { text: string; style: RunStyle; href?: string }
export interface Block { bullet: boolean; runs: Run[] }
/** `unsupported`: formatting written that has no face here, drawn as typed;
 *  `badLinks`: the targets of links that are not absolute http(s) URLs. */
export interface Prose { blocks: Block[]; unsupported: string[]; badLinks: string[] }

const LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/;
const ANY_LINK = /^\[[^\]\n]+\]\(([^)\s]*)\)/;

/** Split prose into paragraphs and bullets, each a list of styled runs. */
export function parseProse(text: string): Prose {
  const blocks: Block[] = [], unsupported = new Set<string>(), badLinks = new Set<string>();
  let cur: { bullet: boolean; lines: string[] } | undefined;
  const close = () => { if (cur) blocks.push({ bullet: cur.bullet, runs: inline(cur.lines.join(" "), unsupported, badLinks) }); cur = undefined; };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    if (/^#{1,6}\s/.test(line)) unsupported.add("a heading (`#`)");
    const bullet = /^[-*]\s+/.exec(line);
    if (bullet) { close(); cur = { bullet: true, lines: [line.slice(bullet[0].length)] }; continue; }
    if (!cur) cur = { bullet: false, lines: [] };
    cur.lines.push(line);
  }
  close();
  return { blocks, unsupported: [...unsupported], badLinks: [...badLinks] };
}

/** One paragraph's runs: bold, code and links found left to right; a marker
 *  with no partner is text. */
function inline(s: string, unsupported: Set<string>, badLinks: Set<string>): Run[] {
  const runs: Run[] = [];
  let plain = "";
  const push = (r: Run) => { if (plain) runs.push({ text: plain, style: "plain" }); plain = ""; if (r.text) runs.push(r); };
  for (let i = 0; i < s.length; ) {
    if (s.startsWith("**", i)) {
      const end = s.indexOf("**", i + 2);
      if (end > i + 2) { push({ text: s.slice(i + 2, end), style: "bold" }); i = end + 2; continue; }
    }
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) { push({ text: s.slice(i + 1, end), style: "code" }); i = end + 1; continue; }
    }
    if (s[i] === "[") {
      const m = LINK.exec(s.slice(i));
      if (m) { push({ text: m[1], style: "link", href: m[2] }); i += m[0].length; continue; }
      const any = ANY_LINK.exec(s.slice(i));
      if (any) badLinks.add(any[1]);
    }
    // a single `*` or `_` hugging a word on both sides is emphasis, which has no face here
    if ((s[i] === "*" || s[i] === "_") && /\S/.test(s[i + 1] ?? "") && (i === 0 || /[\s(]/.test(s[i - 1]))) {
      const end = s.indexOf(s[i], i + 1);
      if (end > i + 1 && /\S/.test(s[end - 1]) && !/\w/.test(s[end + 1] ?? "")) unsupported.add(`emphasis (\`${s[i]}…${s[i]}\`)`);
    }
    plain += s[i++];
  }
  push({ text: "", style: "plain" });
  return runs;
}

/** How prose is set: its size, line pitch, the gap between blocks, and how far
 *  a bullet's text stands in from the bullet. */
export interface ProseFont { size: number; pitch: number; gap: number; indent: number; fam: FontFamily }
/** One piece of one drawn line, at `x` from the column's left edge. */
export interface Seg { x: number; w: number; text: string; style: RunStyle; href?: string }
export interface Line { y: number; segs: Seg[]; bullet: boolean }
/** `width` is the widest line, rounded up; `height` the lines on their pitch
 *  and the gaps between blocks. */
export interface SetProse { lines: Line[]; width: number; height: number }

/** A code run's plate stands this far past its text on either side. */
export const CODE_PAD = 3;
const face = (style: RunStyle, f: ProseFont): [number, "400" | "600", FontFamily | "mono"] =>
  style === "code" ? [f.size - 1, "400", "mono"] : [f.size, style === "bold" ? "600" : "400", f.fam];
export const runWidth = (text: string, style: RunStyle, f: ProseFont): number => {
  const [size, weight, fam] = face(style, f);
  return measure(text, size, weight, fam) + (style === "code" ? 2 * CODE_PAD : 0);
};

/** Wrap parsed prose to a column `maxW` wide. Greedy, word by word, a word
 *  keeping its run's style; a word wider than the column stands alone on its
 *  line (it is never cut — prose is never truncated). `y` is each line's
 *  baseline offset from the top of the block. */
export function setProse(p: Prose, maxW: number, f: ProseFont): SetProse {
  const lines: Line[] = [];
  let y = 0, width = 0;
  for (const [bi, b] of p.blocks.entries()) {
    if (bi) y += f.gap;
    const left = b.bullet ? f.indent : 0;
    let line: Line = { y: 0, segs: [], bullet: b.bullet }, x = left, pending = false;
    const flush = () => { line.y = y + f.size; lines.push(line); width = Math.max(width, x); y += f.pitch; };
    for (const run of b.runs) {
      // words keep the spaces between them; a run that starts or ends on a space keeps that too
      const words = run.text.split(/(\s+)/).filter((w) => w !== "");
      for (const word of words) {
        if (/^\s+$/.test(word)) { pending = line.segs.length > 0; continue; }
        // a space between words of one run is that run's; one between two runs, the one before's
        const space = runWidth(" ", line.segs.length ? line.segs[line.segs.length - 1].style === "code" ? "plain" : line.segs[line.segs.length - 1].style : run.style, f);
        const w = runWidth(word, run.style, f), gapW = pending ? space : 0;
        if (line.segs.length && x + gapW + w > maxW) { flush(); line = { y: 0, segs: [], bullet: false }; x = left; pending = false; }
        const at = x + (pending && line.segs.length ? space : 0);
        // a word that continues the previous segment's run joins it, so a line draws as few texts as it can
        const last = line.segs[line.segs.length - 1];
        if (last && last.style === run.style && last.href === run.href && run.style !== "code") { last.text += (pending ? " " : "") + word; last.w = at + w - last.x; }
        else line.segs.push({ x: at, w, text: word, style: run.style, href: run.href });
        x = at + w; pending = false;
      }
      if (/\s$/.test(run.text)) pending = true;
    }
    if (line.segs.length) flush();
  }
  // the height is the lines on their pitch, with the gaps between blocks: a
  // first baseline `size` down leaves the last line's descent inside it
  return { lines, width: Math.ceil(width), height: y };
}
