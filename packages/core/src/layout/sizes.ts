// How big things are: the size of every leaf, pill and note, from the text
// they hold and the theme's font. Shared by the planner (which hands sizes to
// the engine), the annotation passes and the renderer — one source of truth,
// so room is always reserved for the thing that is actually drawn.
import { fit, measure, wrapText, type FontFamily } from "../metrics.js";
import type { VNode, FieldRow } from "../view/resolve.js";
import type { ThemeFont } from "../themes/index.js";


const LEAF_TIERS = [120, 160, 200, 240];
/** Past 240 only a label earns more room: a long subtitle on every leaf would
 *  otherwise widen a whole view for text that can be shortened. */
const LEAF_LABEL_TIERS = [240, 280, 320];
const CARD_TIERS = [200, 240, 280, 320];
const LEAF_H = 64;
/** 88 → 96: the card grew a 30px shelf along its bottom, and 66 of body is
 *  what the title/tagline pair needs above it (docs/design). */
const CARD_H = 96;
/** Actor tiles: a name and a caption, no plate row under them. */
const PERSON_H = 56;
/** The bordered chip holding a card's kind glyph, top-right. */
const GLYPH_CHIP = 26;
/** The shelf strip along a card's bottom: child icons, `+N`, domain chip. */
export const SHELF_H = 30;
/** One row of a detailed card (`preview <path>`): a 22 plate and a name with
 *  its caption, under a hairline. Three rows make the card exactly 2×CARD_H. */
export const ROW_H = 32;
/** The head of a card that has a shelf — plate, title, tagline. A detailed
 *  card keeps it at this height and grows below it, so the two altitudes of one
 *  card line up head to head in a rank. */
export const CARD_HEAD_H = 66;
/** One row of a leaf's schema (docs/notes/fields.md): a name, marker chips, a
 *  ref and a type on one 12px line — no plate, so a third shorter than a card
 *  row. 24 keeps 64 + 24·n on the 8px grid for every n, with no shelf needed. */
export const FIELD_ROW_H = 24;
/** A leaf drawing its fields: a row holds a name, chips and a type on one line,
 *  which the plain leaf tiers cannot fit; 320 is the cap, past it a type cuts. */
const DETAIL_LEAF_TIERS = [280, 320];
/** Marker chips: mono 10 on a plate, 4 inside each side, 4 between. */
export const CHIP_PAD = 4;
export const CHIP_GAP = 4;
/** Room between a row's name-and-chips and its right-aligned type. */
export const FIELD_GAP = 12;
/** A ref's arrow is drawn, not typed: `→` is outside the bundled Latin
 *  subsets, so as text it was a gap in a PNG and a system-font fallback in a
 *  browser. 7 of stroke and 4 of air before the ref's own text. */
export const REF_ARROW_W = 11;
/** How far the stacked sheets bleed below a container (they are inset at the
 *  sides, so nothing bleeds right). Not added to the node's size on purpose —
 *  see the comment at `canvasExtent`. */
export const SHEET_BLEED = 12;
const PLATE = 40;
const PAD = 12;
/** Zone chip height (docs/design). Shared: the placer reserves it, the
 *  renderer fills it, and the chip straddles its border by half of it. */
export const CHIP_H = 22;
/** Room a note reserves for its leading glyph, gutter included. Shared: layout
 *  wraps text to what is left, the renderer draws the mark in it. */
export const NOTE_GUTTER = 19;
/** A note's widest box, and the text column inside it. The column is what the
 *  wrap runs against; the box is the column plus padding plus the gutter, so
 *  the two can never disagree about whether the text fits. */
const NOTE_MAX_W = 200;
/** A note stands this far off its anchor; the dotted leader spans it. */
export const NOTE_GAP = 24;
/** …and this far past the last wire on a face it shares with wires, or past
 *  a pill it shares a wire's reservation with. */
export const NOTE_CLEAR = 8;
const NOTE_TEXT_W = NOTE_MAX_W - 24 - NOTE_GUTTER;
/** The pill a label will render as, measured with the layout's font — the
 *  single source of truth shared by the room the layout reserves (plan.ts) and the
 *  renderer's pill text (svg.ts). If these two ever diverge, the reservation
 *  is for a different pill than the one drawn. Cap 240 mirrors computePills'
 *  maxW; the canvas-width term is unknowable before layout and only ever
 *  shrinks tiny diagrams, where a slightly generous reservation is harmless. */
export function pillDims(text: string, font: Pick<ThemeFont, "metrics" | "scale">): { label: string; w: number; h: number } {
  const fx11 = Math.round(11 * font.scale);
  const label = fit(text, 240 - 12, fx11, "400", font.metrics);
  return { label, w: Math.round(measure(label, fx11, "400", font.metrics)) + 12, h: 18 };
}

/** The box a note will render as, and the lines inside it — the single source
 *  of truth shared by every path that places one (edge notes, layer notes, the
 *  candidate-ladder resolver) and by the renderer that draws it.
 *
 *  It is one function because it was briefly two. The resolver kept its own
 *  copy of this arithmetic, so when notes gained a leading glyph only the
 *  other copy learned about the gutter: corner and `right-of` notes reserved a
 *  box 19px narrower than the text drawn into it, and the text ran out through
 *  the side. Exactly the failure `pillDims` exists to prevent, in the one
 *  place that had not been given the same treatment.
 *
 *  The column narrows by the gutter and the box widens by it, so the text
 *  keeps its 12px right margin whatever the glyph does. */
export function noteBox(text: string, font: Pick<ThemeFont, "metrics" | "scale">) {
  const fx11 = Math.round(11 * font.scale);
  const lines = wrapText(text, NOTE_TEXT_W, fx11, font.metrics, 3);
  // ceil the *text*, then add the padding — rounding the total instead let a
  // 32.4px word round its box down and quietly spend a pixel of the right
  // margin. Integers either way (DESIGN §8); this way the margin is the 12 it
  // claims to be.
  const widest = Math.ceil(Math.max(...lines.map((l) => measure(l, fx11, "400", font.metrics))));
  const w = Math.min(NOTE_MAX_W, widest + 24 + NOTE_GUTTER);
  return { lines, w, h: lines.length * 15 + 12 };
}


// Node width depends on the theme's font — the theme is a determinism input,
// so this is still a pure function of (source, theme). Both shipping themes
// use Inter at scale 1, so the parameter is currently constant; it stays
// because a theme that changed the face would change every node's width, and
// that dependency should be visible in the signature rather than assumed away.
export const INTER: Pick<ThemeFont, "metrics" | "scale"> = { metrics: "inter", scale: 1 };

/** What one schema row needs, left to right: the name (its dotted prefix
 *  included), each marker chip, `→ ref`, the gap, the type. The renderer spends
 *  exactly these, so a row that fits here is never cut there. */
export function fieldRowNeed(f: FieldRow, fx: (px: number) => number, fam: FontFamily): number {
  const chips = f.markers.reduce((a, m) => a + CHIP_GAP + CHIP_PAD * 2 + measure(m, fx(10), "400", "mono"), 0);
  return PAD + measure((f.prefix ?? "") + f.name, fx(12), "500", fam) + chips +
    (f.ref ? 8 + REF_ARROW_W + measure(f.ref, fx(11), "400", fam) : 0) +
    // a caption earns the wider tier when that lets it draw on its row
    (f.caption ? 8 + measure(f.caption, fx(11), "400", fam) : 0) +
    (f.type ? FIELD_GAP + measure(f.type, fx(11), "400", "mono") : 0) + PAD;
}

export function sizeOf(n: VNode, font: Pick<ThemeFont, "metrics" | "scale">): { w: number; h: number } {
  const fam = font.metrics as FontFamily;
  const fx = (px: number) => Math.round(px * font.scale);
  const isCard = n.kind === "card" || n.kind === "context-card";
  if (isCard) {
    // The text column now starts after an icon plate and ends before the
    // glyph chip, so both come out of the width rather than letting the label
    // run under either.
    const headNeed = PAD + PLATE + PAD + Math.max(
      // the 4 is what the renderer spends beside a name: the plate sits 5 in from
      // the spine, the chip 1 closer to the edge. Without it a name within 4px
      // of a tier was cut with a wider tier free. A tagline has the chip's column
      // to run under, so it never needed it.
      measure(n.label, fx(15), "500", fam) + 4,
      measure(n.tagline ?? "", fx(11), "400", fam),
    ) + PAD + GLYPH_CHIP + PAD;
    // A detailed card's rows widen the tier the way a tagline does: a 22 plate,
    // the name at 12/500, then its caption at 11 — the widest row sets the need.
    const rows = n.detailed ? n.rows ?? [] : [];
    const rowNeed = Math.max(0, ...rows.map((r) =>
      PAD + 22 + 10 + measure(r.label, fx(12), "500", fam) +
      (r.subtitle ? 8 + measure(r.subtitle, fx(11), "400", fam) : 0) + PAD));
    const need = Math.max(headNeed, rowNeed);
    // Detailed: the head stays where it is, the rows hang below it, and the
    // shelf always closes the card — with `+N more` and the domain chip when
    // there are any, as a bare base when not. Always, because a rank of
    // detailed cards (`preview *`) must line up along the bottom as well as
    // the top, and because 66 + 32·n lands off the 8px grid without it.
    const h = n.detailed ? CARD_HEAD_H + ROW_H * rows.length + SHELF_H : CARD_H;
    return { w: CARD_TIERS.find((t) => t >= need) ?? CARD_TIERS[CARD_TIERS.length - 1], h };
  }
  // A subtitle widens the tier the way a card's tagline does: the smallest
  // tier leaves 44px of text room, which would clip nearly every one. The
  // check-time length lint is what keeps this from costing diagram width.
  const need = PAD + PLATE + PAD + Math.max(
    measure(n.label, fx(13), "500", fam),
    measure(n.subtitle ?? "", fx(11), "400", fam),
  ) + PAD;
  const labelNeed = PAD + PLATE + PAD + measure(n.label, fx(13), "500", fam) + PAD;
  const w = LEAF_TIERS.find((t) => t >= need)
    ?? LEAF_LABEL_TIERS.find((t) => t >= labelNeed)
    ?? LEAF_LABEL_TIERS[LEAF_LABEL_TIERS.length - 1];
  // Schema rows hang under the 64px head; "+N more fields" is one more row.
  // The widest row picks the tier, never past 320 — beyond it the type cuts
  // (with its full text in a <title>) rather than widening the whole view.
  if (n.fields) {
    const rowNeed = Math.max(...n.fields.map((f) => fieldRowNeed(f, fx, fam)));
    const fieldW = DETAIL_LEAF_TIERS.find((t) => t >= Math.max(w, rowNeed)) ?? DETAIL_LEAF_TIERS[DETAIL_LEAF_TIERS.length - 1];
    return { w: fieldW, h: LEAF_H + FIELD_ROW_H * (n.fields.length + (n.moreFields ? 1 : 0)) };
  }
  // An actor is shorter than a service: no description line, and its round
  // avatar reads at 34 where a service plate reads at 40.
  return { w, h: n.kind === "person" ? PERSON_H : LEAF_H };
}

