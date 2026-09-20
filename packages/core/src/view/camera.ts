// The camera, as arithmetic.
//
// Pan and zoom for the two surfaces that show a diagram to a reader — the
// playground and the interactive HTML export — is one transform,
// `translate(x, y) scale(k)` about the top-left corner, on a wrapper that holds
// both dive layers (docs/notes/pan-zoom.md). Everything that decides *where*
// that transform goes lives here: no DOM, so it can be tested, and so the two
// hosts cannot drift into two feels. `camera-dom.ts` is the thin half that
// listens to pointers and wheels and writes the style; this is the half with
// opinions.
//
// Spaces: "screen" is px relative to the viewport element's top-left; "local"
// is the content's own px, i.e. the SVG's user units at k = 1. The anchored
// dive (`dive.ts`) is computed entirely in local space, which is what lets it
// run unchanged under any camera.
import { type Box, clamp } from "./dive.js";

export interface Camera { x: number; y: number; k: number }
export interface CamSize { w: number; h: number }
export type CamPad = number | { top: number; right: number; bottom: number; left: number };
export interface CamLimits { min: number; max: number }
export interface FitOpts {
  pad?: CamPad;
  /** Presentation: true contain, scaling a small diagram *up* to fill. */
  upscale?: boolean;
}

/** Past this a dive's ghost is an order of magnitude larger than the viewport,
 *  with a filter on every card. Vector art has no detail to find beyond it. */
export const MAX_K = 4;
/** One press of + or −. Multiplicative, so a step feels the same at any scale. */
export const ZOOM_STEP = 1.25;
/** Shift+Arrow. */
export const KEY_PAN = 80;
/** How much of the content must stay on screen, whatever the drag. */
export const KEEP_VISIBLE = 120;
/** Movement before a press becomes a drag rather than a click. Fingers wobble. */
export const DRAG_PX = { mouse: 4, touch: 8 };
export const TWEEN_MS = 160;
export const IDENTITY: Camera = { x: 0, y: 0, k: 1 };

const sides = (pad: CamPad = 0) =>
  typeof pad === "number" ? { top: pad, right: pad, bottom: pad, left: pad } : pad;

/** The scale at which the whole of `content` is visible inside the padding. */
export function containK(content: CamSize, viewport: CamSize, pad?: CamPad): number {
  const p = sides(pad);
  const aw = viewport.w - p.left - p.right, ah = viewport.h - p.top - p.bottom;
  if (!(content.w > 0 && content.h > 0 && aw > 0 && ah > 0)) return 1;
  return Math.min(aw / content.w, ah / content.h);
}

/**
 * Where a view arrives. Deliberately what both surfaces did before there was a
 * camera: fit the **width**, never above 1:1, centred — and when that leaves the
 * diagram taller than the viewport, start at its **top**, so a long diagram
 * opens readable and scrolling moves down it. (A contain fit opens a 900×4000
 * diagram as a 150px strip; a legibility floor opened it as a 540px one. Both
 * were tried on paper and both lose to what readers already had.)
 *
 * `upscale` is presentation mode: true contain, scaled up to fill the screen.
 */
export function fitCamera(content: CamSize, viewport: CamSize, opts: FitOpts = {}): Camera {
  const p = sides(opts.pad);
  const aw = viewport.w - p.left - p.right, ah = viewport.h - p.top - p.bottom;
  if (!(content.w > 0 && content.h > 0 && aw > 0 && ah > 0)) return { ...IDENTITY };
  const k = opts.upscale ? containK(content, viewport, opts.pad) : Math.min(1, aw / content.w);
  const w = content.w * k, h = content.h * k;
  return {
    k,
    x: p.left + (aw - w) / 2,
    y: h <= ah ? p.top + (ah - h) / 2 : p.top,
  };
}

/** Zooming out always reaches the whole diagram (half of contain, so there is
 *  air around it); zooming in stops at MAX_K — or at the fit itself when
 *  presentation has already scaled a tiny diagram past it. */
export function zoomLimits(content: CamSize, viewport: CamSize, opts: FitOpts = {}): CamLimits {
  const fit = fitCamera(content, viewport, opts);
  return {
    min: Math.min(1, containK(content, viewport, opts.pad), fit.k) * 0.5,
    max: Math.max(MAX_K, fit.k),
  };
}

/** Scale by `factor` keeping the screen point `p` over the same piece of content. */
export function zoomAt(cam: Camera, p: { x: number; y: number }, factor: number, limits: CamLimits): Camera {
  const k = clamp(cam.k * factor, limits.min, limits.max);
  const f = k / cam.k;
  return { k, x: p.x - (p.x - cam.x) * f, y: p.y - (p.y - cam.y) * f };
}

export const panBy = (cam: Camera, dx: number, dy: number): Camera => ({ ...cam, x: cam.x + dx, y: cam.y + dy });

/** The loose clamp, for drags and zooms: the content may go mostly off-screen —
 *  that is what looking at one corner of it means — but never entirely. */
export function clampCamera(cam: Camera, content: CamSize, viewport: CamSize): Camera {
  const axis = (pos: number, size: number, view: number) => {
    const m = Math.min(KEEP_VISIBLE, size / 2, view / 2);
    return clamp(pos, m - size, view - m);
  };
  return {
    k: cam.k,
    x: axis(cam.x, content.w * cam.k, viewport.w),
    y: axis(cam.y, content.h * cam.k, viewport.h),
  };
}

/**
 * A wheel or two-finger scroll. Not a second clamp — a rule, stated as an
 * invariant and tested as one: **the wheel never moves content further outside
 * the bounds it can fully reach, always lets it come back, and a zero delta is
 * the identity.** So a mouse wheel over a diagram that already fits does
 * nothing (there is nothing hidden to scroll to), a larger one scrolls edge to
 * edge and stops, and content a drag left half off-screen scrolls back in
 * without snapping there on the first tick.
 */
export function wheelPan(
  cam: Camera, dx: number, dy: number, content: CamSize, viewport: CamSize, pad?: CamPad,
): Camera {
  const p = sides(pad);
  const axis = (cur: number, d: number, size: number, view: number, lead: number, trail: number) => {
    const a = lead, b = view - size - trail;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const fits = a <= b; // the content fits the padded viewport on this axis
    const next = cur - d;
    if (cur < lo) return clamp(next, cur, fits ? lo : hi);
    if (cur > hi) return clamp(next, fits ? hi : lo, cur);
    return fits ? cur : clamp(next, lo, hi);
  };
  return {
    k: cam.k,
    x: axis(cam.x, dx, content.w * cam.k, viewport.w, p.left, p.right),
    y: axis(cam.y, dy, content.h * cam.k, viewport.h, p.top, p.bottom),
  };
}

export interface WheelLike { deltaMode: number; deltaX: number; deltaY: number; shiftKey: boolean }

/** Wheel deltas in px. Lines and pages are converted (a mouse on Firefox
 *  reports lines), and Shift turns a vertical wheel sideways — done here rather
 *  than trusted to the browser, which only some of them do. */
export function normalizeWheel(e: WheelLike, viewport: CamSize): { dx: number; dy: number } {
  const ux = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.w : 1;
  const uy = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.h : 1;
  let dx = e.deltaX * ux, dy = e.deltaY * uy;
  if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
  return { dx, dy };
}

/** Ctrl/⌘+wheel, which is also how Chrome and Firefox deliver a trackpad pinch.
 *  Pinch deltas are ~1–10 and pass through; a mouse notch is ±100 and would be
 *  ×2.7, so each event is capped near one button step. A feel parameter, not a
 *  guarantee — a hi-res wheel sends many small events per notch. */
export const wheelZoomFactor = (dy: number): number => Math.exp(-clamp(dy, -24, 24) * 0.01);

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Two fingers, one frame: scale about where they were, then follow where they went. */
export function pinchStep(cam: Camera, a0: Pt, b0: Pt, a1: Pt, b1: Pt, limits: CamLimits): Camera {
  const m0 = mid(a0, b0), m1 = mid(a1, b1);
  const d0 = dist(a0, b0);
  const z = zoomAt(cam, m0, d0 > 0 ? dist(a1, b1) / d0 : 1, limits);
  return panBy(z, m1.x - m0.x, m1.y - m0.y);
}

export const toLocal = (cam: Camera, b: Box): Box =>
  ({ x: (b.x - cam.x) / cam.k, y: (b.y - cam.y) / cam.k, w: b.w / cam.k, h: b.h / cam.k });
export const toScreen = (cam: Camera, b: Box): Box =>
  ({ x: b.x * cam.k + cam.x, y: b.y * cam.k + cam.y, w: b.w * cam.k, h: b.h * cam.k });

export const sameCamera = (a: Camera, b: Camera, eps = 0.5): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.k - b.k) < 1e-3;

/** A point between two cameras: the scale moves geometrically and the content
 *  point at the viewport's centre moves linearly, so a tween reads as one
 *  motion rather than a slide and a zoom that happen to overlap. */
export function lerpCamera(a: Camera, b: Camera, t: number, viewport: CamSize): Camera {
  const e = 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const k = a.k * Math.pow(b.k / a.k, e);
  const cx = viewport.w / 2, cy = viewport.h / 2;
  const ax = (cx - a.x) / a.k, ay = (cy - a.y) / a.k;
  const bx = (cx - b.x) / b.k, by = (cy - b.y) / b.k;
  return { k, x: cx - (ax + (bx - ax) * e) * k, y: cy - (ay + (by - ay) * e) * k };
}
