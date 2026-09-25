// The canvas: the camera, and the motion between altitudes.
//
// Zooming from a landscape into a system is the one navigation move that can
// lose people: the picture is replaced wholesale, and nothing tells you which
// of the five cards you are now inside. So the swap is animated about a single
// anchor — the card you clicked. Both the outgoing diagram and the incoming one
// move around that point, which stays put on screen, so your eye tracks it
// through the cut.
//
// Mechanically: a viewport that never scrolls, a **camera** inside it — one
// element whose transform is the reader's pan and zoom — and inside that, the
// two dive layers: live (the current SVG) and ghost (the previous one, purely
// decorative). The camera is core's `attachCamera`, the same function the
// interactive HTML export bundles, so the two surfaces cannot drift into two
// feels (docs/notes/pan-zoom.md). Every transform here — camera, ghost, live —
// is written imperatively: React re-rendering mid-gesture or mid-dive would
// restart the transition, so none of those elements carries a `style` prop.
//
// The dive runs in the camera's *local* space, where `diveTransforms` neither
// knows nor cares that a camera exists, and every view arrives fitted.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type { Box } from "@squinch/core/browser";
import {
  type Box, type CameraHandle, type CamPad,
  DIVE, KEY_PAN, ZOOM_STEP, attachCamera, diveTransforms,
} from "@squinch/core/browser";
// stays local: the playground compiles per view and never hoists shared defs,
// so its two layers still need their ids kept apart. The HTML export hoists,
// and therefore does not.
import { isolateIds } from "./lib/isolate";

/** A navigation the stage should animate. `token` re-arms on every trigger, so
 *  clicking the same card twice animates twice. */
export interface Intent {
  token: number;
  dir: "in" | "out";
  /** anchor, in the *outgoing* diagram's own px — known up front when zooming
   *  in. Content-local rather than on-screen on purpose: compiling the next
   *  view is async, and the reader can keep panning until it arrives. */
  rect?: Box;
  /** anchor to locate by path — in the incoming diagram when zooming out (the
   *  card we are returning to does not exist until the new SVG mounts), or in
   *  the outgoing one when a tab, not a click, started a zoom in */
  path?: string;
}

/** What the zoom pill drives. The camera's state lives in the DOM, not in React:
 *  a per-frame `setState` would re-render the whole app on every pinch frame. */
export interface StageHandle {
  fit(): void;
  zoomBy(factor: number): void;
  setScale(k: number): void;
}

/** Air around a fitted diagram — enough at the top and bottom to clear the
 *  pills that float over the canvas, so a title block never opens underneath
 *  one. Presenting has less chrome and wants the picture as large as it goes. */
const PAD: CamPad = { top: 64, right: 40, bottom: 60, left: 40 };
const FILL_PAD: CamPad = 36;

/** The renderer always writes unitless px `width` and `height`, adjacent, on the root. */
const sizeOf = (svg: string) => {
  const m = /<svg\b[^>]*?\swidth="([\d.]+)"\s+height="([\d.]+)"/.exec(svg);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 0, h: 0 };
};

/** Keys that belong to a text field, a button or the editor are theirs. */
const typing = (t: EventTarget | null) =>
  !!(t as Element | null)?.closest?.(".cm-editor, input, textarea, select, button, [contenteditable]");

export interface StageProps {
  svg?: string;
  /** the render is out of date (source has errors) — shown dimmed */
  stale?: boolean;
  /** false cuts straight to the new diagram — what `prefers-reduced-motion` gets */
  animate: boolean;
  intent?: Intent;
  /** presentation: contain the artwork in the viewport, scaling it *up* as well
   *  as down */
  fill?: boolean;
  /** Changes when a different *document* is loaded (an example, a share link).
   *  The next render refits, wherever the reader had left the camera — an edit
   *  to the same document never does. */
  fitKey?: string | number;
  /** where the live zoom percentage is written, imperatively */
  readout?: React.RefObject<HTMLElement | null>;
  /** the camera went to, or left, its fitted state — not per frame */
  onFitChange?(atFit: boolean): void;
  /** an element with a `data-path` was clicked; the box is in the diagram's own px */
  onPick(path: string, box: Box): void;
  /** the canvas itself was clicked, away from any diagram element */
  onBlank?(): void;
  /** overlays that live inside the canvas (toolbars, breadcrumbs) */
  children?: React.ReactNode;
  className?: string;
}

export const Stage = forwardRef<StageHandle, StageProps>(function Stage(
  { svg, stale, animate, intent, fill, fitKey, readout, onFitChange, onPick, onBlank, children, className },
  ref,
) {
  const viewport = useRef<HTMLElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const cam = useRef<CameraHandle | null>(null);
  /** armed at trigger time, consumed when a *different* SVG arrives */
  const armed = useRef<{ intent: Intent; svg: string; size: { w: number; h: number } } | null>(null);
  const timers = useRef<number[]>([]);
  /** the token already handled — a remount must not re-arm an old navigation */
  const seen = useRef(intent?.token);
  /** the next SVG to arrive is framed from scratch, whatever the camera was doing */
  const pendingFit = useRef(true);
  const wasFit = useRef(true);
  const fitChanged = useRef(onFitChange);
  fitChanged.current = onFitChange;

  const cancel = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const settle = useCallback(() => {
    armed.current = null;
    const g = ghostRef.current;
    if (g) { g.replaceChildren(); g.removeAttribute("style"); }
    const el = liveRef.current;
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
      el.style.opacity = "";
      el.style.transformOrigin = "";
      el.style.willChange = "";
    }
    const c = cam.current;
    c?.setBusy(false);
    // the pane may have been resized mid-dive, while the camera held still for it
    if (c?.atFit()) c.fit();
  }, []);

  // The camera. Declared before the arm and fire effects, because layout
  // effects run in declaration order and both of them need it on first mount.
  useLayoutEffect(() => {
    const vp = viewport.current, el = cameraRef.current;
    if (!vp || !el) return;
    const c = attachCamera(vp, el, {
      pad: fill ? FILL_PAD : PAD,
      upscale: !!fill,
      onChange(state, atFit) {
        if (readout?.current) readout.current.textContent = `${Math.round(state.k * 100)}%`;
        if (atFit !== wasFit.current) { wasFit.current = atFit; fitChanged.current?.(atFit); }
      },
    });
    cam.current = c;
    pendingFit.current = true;
    return () => { cam.current = null; c.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill]);

  useImperativeHandle(ref, () => ({
    fit: () => cam.current?.fit(true),
    zoomBy: (f) => cam.current?.zoomBy(f),
    setScale: (k) => cam.current?.setScale(k),
  }), []);

  // A different document: frame the next render from scratch.
  useLayoutEffect(() => { pendingFit.current = true; }, [fitKey]);

  // Arm: freeze the diagram currently on screen, before the new one replaces it.
  useLayoutEffect(() => {
    if (!intent || intent.token === seen.current) return;
    seen.current = intent.token;
    pendingFit.current = true; // every view arrives fitted — animated or not
    const c = cam.current, g = ghostRef.current;
    if (!animate || !svg || !c || !g) return;
    cancel();
    settle(); // a dive still in flight would be measured mid-move
    const size = sizeOf(svg);
    armed.current = { intent, svg, size };
    // Input stops here, not at fire: macOS keeps sending inertial wheel events
    // for a second after a flick, and compiling the next view takes a while.
    c.setBusy(true);
    // The ghost is parsed now — a large innerHTML must not land in the dive's
    // first frame — and sits exactly over the live layer, in the camera's own
    // space, where it is invisible. It gets its real box at fire.
    g.innerHTML = isolateIds(svg);
    g.style.cssText = `left:0;top:0;width:${size.w}px;height:${size.h}px`;
    // A view can render byte-identical SVG (a lateral hop to an equivalent
    // view), in which case the swap below never fires. Don't strand the ghost.
    timers.current.push(window.setTimeout(settle, DIVE.ms + 600));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.token]);

  // Every new SVG: tell the camera its size — and, if a navigation is armed,
  // fire the dive now that both layers exist.
  useLayoutEffect(() => {
    const c = cam.current, live = liveRef.current, g = ghostRef.current;
    if (!c || !svg || !live || !g) return;
    const size = sizeOf(svg);
    const a = armed.current;
    if (!a || svg === a.svg) {
      c.setContentSize(size.w, size.h); // refits only if the reader had not moved it
      if (pendingFit.current && !a) { pendingFit.current = false; c.fit(); }
      return;
    }
    armed.current = null;
    pendingFit.current = false;
    cancel();

    const find = (root: Element) =>
      a.intent.path ? root.querySelector(`[data-path="${CSS.escape(a.intent.path)}"]`) : null;

    // Where the old picture is on screen *now* — the reader may have kept
    // panning while the next view compiled — and the clicked card with it.
    // The ghost still overlays the old content exactly, so a card found in it
    // by path measures the same as the one that was clicked.
    const oldRect = c.toScreen({ x: 0, y: 0, w: a.size.w, h: a.size.h });
    const inCard = a.intent.dir === "in" ? (a.intent.rect ?? (() => {
      const el = find(g);
      return el ? c.toLocal(c.screenBox(el)) : undefined;
    })()) : undefined;
    const oldAnchor = inCard ? c.toScreen(inCard) : undefined;

    // The camera is set for the NEW picture, synchronously, and then does not
    // move for the whole dive.
    c.setContentSize(size.w, size.h);
    c.fit();

    const ghostBox = c.toLocal(oldRect);
    g.style.cssText =
      `left:${ghostBox.x}px;top:${ghostBox.y}px;width:${ghostBox.w}px;height:${ghostBox.h}px`;
    const liveBox: Box = { x: 0, y: 0, w: size.w, h: size.h };
    const outCard = a.intent.dir === "out" ? find(live) : null;
    let anchor = oldAnchor ? c.toLocal(oldAnchor) : outCard ? c.toLocal(c.screenBox(outCard)) : undefined;
    // From deep zoom the old picture is already several screens wide, and the
    // dive would scale it up to 3.2x more with a filter on every card. Past
    // three viewports, cut instead — what a lateral hop gets.
    const port = c.viewportBox();
    if (oldRect.w > port.w * 3 || oldRect.h > port.h * 3) anchor = undefined;

    // All of the geometry lives in core's view/dive.ts — no DOM, so
    // scripts/hero-gif.mts re-derives the README animation from the same
    // constants rather than its own copy. A missing anchor means the two views
    // sit at the same altitude: a change of lens, not of depth, so it cuts.
    const { ms, ease, gOrigin, lOrigin, gEnd, lStart } = diveTransforms({
      view: c.toLocal(port), ghostBox, liveBox, anchor, dir: a.intent.dir,
    });

    live.style.willChange = "transform, opacity";
    g.style.transition = "none";
    g.style.transformOrigin = gOrigin;
    g.style.transform = "none";
    g.style.opacity = "1";
    live.style.transition = "none";
    live.style.transformOrigin = lOrigin;
    live.style.transform = lStart;
    live.style.opacity = "0";
    void live.offsetHeight; // commit the start state before transitioning off it

    // The ghost clears out early and the incoming layer arrives late, so the
    // two are never both at full strength — a straight crossfade muddies them.
    g.style.transition = `transform ${ms}ms ${ease}, opacity ${Math.round(ms * 0.55)}ms ${ease}`;
    g.style.transform = gEnd;
    g.style.opacity = "0";
    live.style.transition = `transform ${ms}ms ${ease}, opacity ${Math.round(ms * 0.6)}ms ${ease} ${Math.round(ms * 0.25)}ms`;
    live.style.transform = "none";
    live.style.opacity = "1";

    timers.current.push(window.setTimeout(settle, ms + 40));
  }, [svg]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => cancel, [cancel]);

  // Keys, wherever the focus is — except in anything that types. Hovering the
  // canvas and pressing + should just work; needing to click it first would
  // cost a backdrop click, which climbs a view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = cam.current;
      if (!c || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.shiftKey && e.key.startsWith("Arrow")) {
        e.preventDefault();
        return c.panBy(
          e.key === "ArrowLeft" ? KEY_PAN : e.key === "ArrowRight" ? -KEY_PAN : 0,
          e.key === "ArrowUp" ? KEY_PAN : e.key === "ArrowDown" ? -KEY_PAN : 0,
        );
      }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); c.zoomBy(ZOOM_STEP); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); c.zoomBy(1 / ZOOM_STEP); }
      else if (e.key === "0") { e.preventDefault(); c.fit(true); }
      else if (e.key === "1") { e.preventDefault(); c.setScale(1); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const click = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-path]");
      const path = el?.getAttribute("data-path");
      const c = cam.current;
      if (path && c) return onPick(path, c.toLocal(c.screenBox(el!)));
      // Clicking a diagram element that leads nowhere does nothing — only true
      // backdrop climbs back out.
      if (!path) onBlank?.();
    },
    [onPick, onBlank],
  );

  return (
    // Two layers, on purpose: the outer box is the positioning context for the
    // overlay pills (`children`), which must not move with the picture; the
    // inner section is the viewport the camera looks through.
    <div className={`relative min-w-0 flex-1 ${className ?? ""}`}>
      <section
        ref={viewport}
        onClick={click}
        // A plain ground, the diagram's own: the stage floods with its canvas
        // colour, so a render has no visible edge to sit inside.
        className="absolute inset-0 cursor-grab select-none overflow-hidden bg-[var(--canvas)]"
      >
        {/* No `style` prop on the camera or on either layer: they are written
            imperatively, and a prop would be re-applied over a gesture or a
            dive on the next render. */}
        <div ref={cameraRef} className="absolute left-0 top-0">
          <div
            ref={ghostRef}
            aria-hidden
            className="pointer-events-none absolute z-[1] [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          />
          <div
            ref={liveRef}
            className={`[&>svg]:block ${stale ? "opacity-60" : ""}`}
            dangerouslySetInnerHTML={{ __html: svg ?? "" }}
          />
        </div>
        {!svg && (
          <p className="absolute inset-0 grid place-items-center text-[13px] text-[var(--muted)]">Rendering…</p>
        )}
      </section>
      {children}
    </div>
  );
});

/** System preference wins over the picker — motion sickness is not a setting we
 *  get to override. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
