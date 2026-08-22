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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type { Box } from "@squinch/core/browser";
import { type Box, DIVE, diveTransforms } from "@squinch/core/browser";
// stays local: the playground compiles per view and never hoists shared defs,
// so its two layers still need their ids kept apart. The HTML export hoists,
// and therefore does not.
import { isolateIds } from "./lib/isolate";

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

const boxOf = (el: Element, host: HTMLElement): Box => {
  const a = el.getBoundingClientRect();
  const b = host.getBoundingClientRect();
  return {
    x: a.left - b.left + host.scrollLeft,
    y: a.top - b.top + host.scrollTop,
    w: a.width,
    h: a.height,
  };
};

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
  svg,
  stale,
  animate,
  intent,
  fit,
  zoom,
  fill,
  onPick,
  onBlank,
  children,
  className,
}: StageProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  // The sizing rules are frozen alongside the artwork: the ghost has to sit at
  // exactly the size the live layer had, and the user can change fit or zoom
  // mid-flight.
  const [ghost, setGhost] = useState<{
    svg: string;
    box: Box;
    cls: string;
    scale: number;
  } | null>(null);
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
    if (!a || !svg || svg === a.svg || !live || !host || !ghostRef.current)
      return;
    armed.current = null;
    cancel();

    const view: Box = {
      x: host.scrollLeft,
      y: host.scrollTop,
      w: host.clientWidth,
      h: host.clientHeight,
    };
    const ghostBox = { ...(ghost?.box ?? view) };
    const liveBox = boxOf(live, host);

    // The anchor: the clicked card, already measured. Otherwise find it — going
    // down, it is in the diagram we are leaving; coming back up, it is the card
    // we are landing on, which only exists in the diagram that just mounted.
    let anchor = a.intent.rect;
    if (!anchor && a.intent.path) {
      const from = a.intent.dir === "in" ? ghostRef.current : live;
      const el = from.querySelector(
        `[data-path="${CSS.escape(a.intent.path)}"]`,
      );
      if (el) anchor = boxOf(el, host);
    }

    // All of the geometry lives in core's view/dive.ts — no DOM, so it is
    // scripts/hero-gif.mts re-derives the README animation from the same
    // constants rather than its own copy. A missing anchor means the two views
    // sit at the same altitude: a change of lens, not of depth, so it cuts.
    const { ms, ease, gOrigin, lOrigin, gEnd, lStart } = diveTransforms({
      view,
      ghostBox,
      liveBox,
      anchor,
      dir: a.intent.dir,
    });

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
    live.style.transition = `transform ${ms}ms ${ease}, opacity ${Math.round(ms * 0.6)}ms ${ease} ${Math.round(ms * 0.25)}ms`;
    live.style.transform = "none";
    live.style.opacity = "1";

    timers.current.push(window.setTimeout(settle, ms + 40));
  }, [svg]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => cancel, [cancel]);

  const click = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-path]");
      const path = el?.getAttribute("data-path");
      if (path && scroller.current)
        return onPick(path, boxOf(el!, scroller.current));
      // Clicking a diagram element that leads nowhere does nothing — only true
      // backdrop climbs back out.
      if (!path) onBlank?.();
    },
    [onPick, onBlank],
  );

  return (
    // Two layers, on purpose: the outer box is the positioning context for the
    // overlay pills (`children`) and never scrolls; the inner section is the
    // scroller. With one element doing both jobs, `absolute` overlays are laid
    // out against the scrolled content, so a diagram taller than the viewport
    // carried the altitude hint and zoom controls off the bottom with it.
    <div className={`relative min-w-0 flex-1 ${className ?? ""}`}>
      <section
        ref={scroller}
        className={`absolute inset-0 bg-[var(--canvas)] ${
          fill
            ? "overflow-hidden"
            : "overflow-auto [background-image:radial-gradient(var(--dot)_1px,transparent_1px)] [background-size:22px_22px]"
        }`}
      >
        {ghost && (
          <div
            ref={ghostRef}
            aria-hidden
            className="pointer-events-none absolute z-[1] will-change-transform"
            style={{
              left: ghost.box.x,
              top: ghost.box.y,
              width: ghost.box.w,
              height: ghost.box.h,
            }}
          >
            <div
              className={ghost.cls}
              style={
                ghost.scale === 1
                  ? undefined
                  : {
                      transform: `scale(${ghost.scale})`,
                      transformOrigin: "top left",
                    }
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
            style={
              fill || fit
                ? undefined
                : { transform: `scale(${zoom})`, transformOrigin: "center" }
            }
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
      {children}
    </div>
  );
}

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
