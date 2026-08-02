// The anchored dive, as arithmetic.
//
// Changing altitude animates about the one card the two views share, so the
// reader never has to re-find their place (DESIGN §11, docs/notes/zoom-
// transitions.md). All of the geometry lives here, taking four measured
// rectangles and returning the transforms — no DOM, so it can be tested, and so
// `scripts/hero-gif.mts` can re-derive the README animation from the same
// constants instead of its own copy of them. Two copies in two languages with a
// comment asserting they match is not a thing that stays true.
//
// It sat in `apps/spa/src/lib/` while the playground was the only thing that
// zoomed. The interactive HTML export zooms too and is built by core, so this
// moved here rather than becoming the second copy its own header warns about.

export interface Box { x: number; y: number; w: number; h: number }

/** How far the eye travels. Anything past ~3× reads as a jump cut, not a move. */
export const CAP = 3.2;
/** The incoming layer travels a fraction of the outgoing one — a full mirror
 *  overshoots and feels like two separate animations played back to back. */
export const TRAVEL = 0.62;

/** The dive itself, and the anchorless fallback for a hop between two views at
 *  the same altitude, where there is no shared card to travel through. */
export const DIVE = { ms: 460, ease: "cubic-bezier(.32,.72,0,1)" };
export const CUT = { ms: 240, ease: "cubic-bezier(.4,0,.2,1)" };

export const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Scale factor for a dive through `anchor` within `view`, clamped both ways. */
export const scaleFor = (view: Box, anchor: Box) =>
  clamp(Math.min(view.w / anchor.w, view.h / anchor.h), 1.15, CAP);

export interface DiveInput {
  /** the visible canvas, in canvas space */
  view: Box;
  /** the outgoing layer's box */
  ghostBox: Box;
  /** the incoming layer's box */
  liveBox: Box;
  /** the shared card. Absent = a lateral hop, which gets the cut instead. */
  anchor?: Box;
  dir: "in" | "out";
}

export interface DiveOutput {
  ms: number;
  ease: string;
  gOrigin: string;
  lOrigin: string;
  gEnd: string;
  lStart: string;
}

/**
 * Zooming in, the old picture flies past — the anchor grows to fill the screen —
 * while the new one emerges from where that card sat. Zooming out is the exact
 * inverse, which is why one pair of expressions covers both directions. That
 * symmetry is the thing worth testing: it is easy to break one direction while
 * the other still looks right.
 */
export function diveTransforms(input: DiveInput): DiveOutput {
  const { view, ghostBox, liveBox, anchor, dir } = input;
  const { ms, ease } = anchor ? DIVE : CUT;
  if (!anchor)
    return { ms, ease, gOrigin: "50% 50%", lOrigin: "50% 50%", gEnd: "scale(.97)", lStart: "scale(1.03)" };

  const k = scaleFor(view, anchor);
  const kIn = 1 + (k - 1) * TRAVEL;
  const A = centre(anchor), V = centre(view);
  const dx = V.x - A.x, dy = V.y - A.y; // anchor centre → screen centre
  const into = dir === "in";
  const gPoint = into ? A : V;
  const lPoint = into ? V : A;
  return {
    ms, ease,
    gOrigin: `${gPoint.x - ghostBox.x}px ${gPoint.y - ghostBox.y}px`,
    lOrigin: `${lPoint.x - liveBox.x}px ${lPoint.y - liveBox.y}px`,
    gEnd: into
      ? `translate(${dx}px, ${dy}px) scale(${k})`
      : `translate(${-dx}px, ${-dy}px) scale(${1 / k})`,
    lStart: into
      ? `translate(${-dx}px, ${-dy}px) scale(${1 / kIn})`
      : `translate(${dx}px, ${dy}px) scale(${kIn})`,
  };
}
