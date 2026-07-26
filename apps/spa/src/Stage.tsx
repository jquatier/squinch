// The canvas, and the motion between altitudes.
//
// Zooming from a landscape into a system is the one navigation move that can
// lose people: the picture is replaced wholesale, and nothing tells you which
// of the five cards you are now inside. So the swap is animated about a single
// anchor — the card you clicked. Both the outgoing diagram and the incoming one
// move around that point, which stays put on screen, so your eye tracks it
// through the cut.
//
// Mechanically: one live layer (in flow, holds the current SVG) and one ghost
// layer (absolutely positioned clone of the previous SVG, pinned where it was,
// purely decorative). Transforms are applied imperatively — React re-rendering
// mid-animation would restart the transition.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Box { x: number; y: number; w: number; h: number }

/** A navigation the stage should animate. `token` re-arms on every trigger, so
 *  clicking the same card twice animates twice. */
export interface Intent {
  token: number;
  dir: "in" | "out";
  /** anchor, already in canvas space — known up front when zooming in */
  rect?: Box;
  /** anchor to locate in the *incoming* diagram — used when zooming out, where
   *  the card we are returning to does not exist until the new SVG mounts */
  path?: string;
}

/** How far the eye travels. Anything past ~3× reads as a jump cut, not a move. */
const CAP = 3.2;
/** The incoming layer travels a fraction of the outgoing one — a full mirror
 *  overshoots and feels like two separate animations played back to back. */
const TRAVEL = 0.62;

/** The dive itself, and the anchorless fallback for a hop between two views at
 *  the same altitude, where there is no shared card to travel through. */
const DIVE = { ms: 460, ease: "cubic-bezier(.32,.72,0,1)" };
const CUT = { ms: 240, ease: "cubic-bezier(.4,0,.2,1)" };

const boxOf = (el: Element, host: HTMLElement): Box => {
  const a = el.getBoundingClientRect();
  const b = host.getBoundingClientRect();
  return { x: a.left - b.left + host.scrollLeft, y: a.top - b.top + host.scrollTop, w: a.width, h: a.height };
};
const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Two copies of one diagram are on screen during a transition, and ids are not
 *  scoped to a document subtree: the live layer's `<use href="#i-lambda">` would
 *  resolve against whichever `<symbol>` comes first in document order. Renaming
 *  the ghost's ids keeps each layer referring to its own artwork. */
function isolateIds(svg: string): string {
  return svg
    .replace(/\bid="([^"]+)"/g, 'id="ghost-$1"')
    .replace(/href="#([^"]+)"/g, 'href="#ghost-$1"')
    .replace(/url\(#([^)]+)\)/g, "url(#ghost-$1)");
}

export interface StageProps {
  svg?: string;
  /** the render is out of date (source has errors) — shown dimmed */
  stale?: boolean;
  /** false cuts straight to the new diagram — what `prefers-reduced-motion` gets */
  animate: boolean;
  intent?: Intent;
  fit: boolean;
  zoom: number;
  /** presentation sizing: contain the artwork in the viewport, scaling it *up*
   *  as well as down. `fit`/`zoom` are ignored. */
  fill?: boolean;
  /** an element with a `data-path` was clicked; the box is in canvas space */
  onPick(path: string, box: Box): void;
  /** the canvas itself was clicked, away from any diagram element. Passing this
   *  is also what puts the zoom-out cursor on the backdrop, so only wire it up
   *  when there is somewhere to go. */
  onBlank?(): void;
  /** overlays that live inside the canvas (toolbars, breadcrumbs) */
  children?: React.ReactNode;
  className?: string;
}

export function Stage({
  svg, stale, animate, intent, fit, zoom, fill, onPick, onBlank, children, className,
}: StageProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  // The sizing rules are frozen alongside the artwork: the ghost has to sit at
  // exactly the size the live layer had, and the user can change fit or zoom
  // mid-flight.
  const [ghost, setGhost] = useState<{ svg: string; box: Box; cls: string; scale: number } | null>(null);
  /** armed at trigger time, consumed when a *different* SVG arrives */
  const armed = useRef<{ intent: Intent; svg: string } | null>(null);
  const timers = useRef<number[]>([]);
  /** the token already handled — a remount must not re-arm an old navigation */
  const seen = useRef(intent?.token);

  // How the artwork is sized. Presenting contains it in the viewport (the root
  // <svg> carries a viewBox, so width+height together letterbox correctly);
  // editing leaves it at natural size, capped to the pane unless zoomed.
  const artCls = fill
    ? "h-full w-full [&>svg]:h-full [&>svg]:w-full"
    : fit
      ? "[&>svg]:h-auto [&>svg]:max-w-full"
      : "";

  const cancel = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const settle = useCallback(() => {
    armed.current = null;
    setGhost(null);
    const el = liveRef.current;
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
      el.style.opacity = "";
      el.style.transformOrigin = "";
      el.style.willChange = "";
    }
  }, []);

  // Arm: freeze the diagram currently on screen, before the new one replaces it.
  useLayoutEffect(() => {
    if (!intent || intent.token === seen.current) return;
    seen.current = intent.token;
    if (!animate || !svg || !liveRef.current || !scroller.current) return;
    cancel();
    armed.current = { intent, svg };
    setGhost({
      svg,
      box: boxOf(liveRef.current, scroller.current),
      cls: artCls,
      scale: fill || fit ? 1 : zoom,
    });
    // A view can render byte-identical SVG (a lateral hop to an equivalent
    // view), in which case the swap below never fires. Don't strand the ghost.
    timers.current.push(window.setTimeout(settle, DIVE.ms + 600));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.token]);

  // Fire: the incoming diagram has mounted, so both layers can be measured.
  useLayoutEffect(() => {
    const a = armed.current;
    const live = liveRef.current;
    const host = scroller.current;
    if (!a || !svg || svg === a.svg || !live || !host || !ghostRef.current) return;
    armed.current = null;
    cancel();

    const view: Box = { x: host.scrollLeft, y: host.scrollTop, w: host.clientWidth, h: host.clientHeight };
    const ghostBox = { ...(ghost?.box ?? view) };
    const liveBox = boxOf(live, host);

    // The anchor: the clicked card, already measured. Otherwise find it — going
    // down, it is in the diagram we are leaving; coming back up, it is the card
    // we are landing on, which only exists in the diagram that just mounted.
    let anchor = a.intent.rect;
    if (!anchor && a.intent.path) {
      const from = a.intent.dir === "in" ? ghostRef.current : live;
      const el = from.querySelector(`[data-path="${CSS.escape(a.intent.path)}"]`);
      if (el) anchor = boxOf(el, host);
    }

    // No shared card means the two views sit at the same altitude — a change of
    // lens, not a change of depth. Nothing to fly through, so it gets a short
    // depth cut instead.
    const { ms, ease } = anchor ? DIVE : CUT;
    let gOrigin = "50% 50%", lOrigin = "50% 50%", gEnd = "scale(.97)", lStart = "scale(1.03)";
    if (anchor) {
      const k = clamp(Math.min(view.w / anchor.w, view.h / anchor.h), 1.15, CAP);
      const kIn = 1 + (k - 1) * TRAVEL;
      const A = centre(anchor), V = centre(view);
      const dx = V.x - A.x, dy = V.y - A.y; // anchor centre → screen centre
      const into = a.intent.dir === "in";
      // Zooming in, the old picture flies past (anchor grows to fill the screen)
      // while the new one emerges from where that card sat. Zooming out is the
      // exact inverse, so one pair of expressions covers both.
      const gPoint = into ? A : V;
      const lPoint = into ? V : A;
      gOrigin = `${gPoint.x - ghostBox.x}px ${gPoint.y - ghostBox.y}px`;
      lOrigin = `${lPoint.x - liveBox.x}px ${lPoint.y - liveBox.y}px`;
      gEnd = into
        ? `translate(${dx}px, ${dy}px) scale(${k})`
        : `translate(${-dx}px, ${-dy}px) scale(${1 / k})`;
      lStart = into
        ? `translate(${-dx}px, ${-dy}px) scale(${1 / kIn})`
        : `translate(${dx}px, ${dy}px) scale(${kIn})`;
    }

    const g = ghostRef.current;
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
    live.style.transition =
      `transform ${ms}ms ${ease}, opacity ${Math.round(ms * 0.6)}ms ${ease} ${Math.round(ms * 0.25)}ms`;
    live.style.transform = "none";
    live.style.opacity = "1";

    timers.current.push(window.setTimeout(settle, ms + 40));
  }, [svg]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => cancel, [cancel]);

  const click = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-path]");
      const path = el?.getAttribute("data-path");
      if (path && scroller.current) return onPick(path, boxOf(el!, scroller.current));
      // Clicking a diagram element that leads nowhere does nothing — only true
      // backdrop climbs back out.
      if (!path) onBlank?.();
    },
    [onPick, onBlank],
  );

  return (
    <section
      ref={scroller}
      className={`relative min-w-0 flex-1 bg-[var(--canvas)] ${
        fill
          ? "overflow-hidden"
          : "overflow-auto [background-image:radial-gradient(var(--dot)_1px,transparent_1px)] [background-size:20px_20px]"
      } ${className ?? ""}`}
    >
      {children}
      {ghost && (
        <div
          ref={ghostRef}
          aria-hidden
          className="pointer-events-none absolute z-[1] will-change-transform"
          style={{ left: ghost.box.x, top: ghost.box.y, width: ghost.box.w, height: ghost.box.h }}
        >
          <div
            className={ghost.cls}
            style={
              ghost.scale === 1
                ? undefined
                : { transform: `scale(${ghost.scale})`, transformOrigin: "top left" }
            }
            dangerouslySetInnerHTML={{ __html: isolateIds(ghost.svg) }}
          />
        </div>
      )}
      <div
        className={`flex items-center justify-center ${fill ? "h-full p-[4vmin]" : "min-h-full p-10"} ${
          onBlank ? "cursor-zoom-out" : ""
        }`}
        onClick={click}
      >
        <div
          className={fill ? "h-full w-full" : ""}
          style={fill || fit ? undefined : { transform: `scale(${zoom})`, transformOrigin: "center" }}
        >
          {svg ? (
            <div
              ref={liveRef}
              className={`${stale ? "opacity-60" : ""} ${artCls}`}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className="text-[13px] text-[var(--muted)]">Rendering…</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** System preference wins over the picker — motion sickness is not a setting we
 *  get to override. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
