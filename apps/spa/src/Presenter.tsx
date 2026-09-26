// Presentation mode: the deck you already wrote.
//
// A squinch project is a set of views over one model, ordered as declared —
// which is exactly a slide deck, so there is nothing to author twice. Stepping
// forward walks the views; clicking a card zooms in and the deck follows you
// there, so a question from the room doesn't cost you your place.
import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, type Box, type Intent } from "./Stage";
import type { ViewBar as Bar } from "@squinch/core/browser";
import type { ViewRef } from "./squinch";
import { ViewBar, ViewBarHandle } from "./ViewBar";

export interface PresenterProps {
  svg?: string;
  views: ViewRef[];
  activeView?: string;
  /** home, the path to here and the flows — the same bar the playground draws */
  bar: Bar;
  /** one altitude up, if there is one */
  upView?: string;
  /** the flow this view narrates, if any, and how far it runs */
  flow?: { label: string; steps: number };
  /** which hop is currently lit (1-based) */
  flowStep: number;
  onFlowStep(step: number): void;
  animate: boolean;
  intent?: Intent;
  onNavigate(name: string, rect?: Box, enterAtEnd?: boolean): void;
  onPick(path: string, box: Box): void;
  onCycleTheme(): void;
  onExit(): void;
}

const HINT =
  "→ ← step · B hides the bar · click a card to zoom in, the backdrop to come out · drag or scroll to pan, pinch or + − to zoom, 0 to fit · T theme · F fullscreen · Esc exit";

export function Presenter({
  svg, views, activeView, bar, upView, flow, flowStep, onFlowStep,
  animate, intent, onNavigate, onPick, onCycleTheme, onExit,
}: PresenterProps) {
  const at = Math.max(0, views.findIndex((v) => v.name === activeView));
  const current = views[at];
  const [idle, setIdle] = useState(false);
  const [hint, setHint] = useState(true);
  // Put away for the rest of the talk, not just until the next slide: a
  // presenter who hid it wants the picture, and would otherwise hide it again
  // on every step.
  const [barHidden, setBarHidden] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);

  // One key does both jobs, in the order a narrator needs them: walk the
  // current view's flow to its end, and only then move to the next view. Going
  // back unwinds the same way. A view with no flow is just a one-step view.
  const step = useCallback(
    (by: number) => {
      const nextStep = flowStep + by;
      if (flow && nextStep >= 1 && nextStep <= flow.steps) return onFlowStep(nextStep);
      const next = views[at + by];
      // stepping back lands on the previous slide's *last* hop, so a story can
      // be unwound as smoothly as it was told
      if (next) onNavigate(next.name, undefined, by < 0);
    },
    [views, at, flow, flowStep, onFlowStep, onNavigate],
  );

  // Full screen is best-effort: it needs a user gesture, and the click that got
  // us here counts — but an iframe without `allow="fullscreen"` will refuse.
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      // A held modifier is not the deck's (⌘← goes back; ⌘+ − 0 are the
      // stage's zoom keys) — this handler used to step the deck *and* swallow
      // it. And a shifted arrow is the stage's too: it pans the camera.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.shiftKey && k.startsWith("Arrow")) return;
      if (k === "Escape") return onExit();
      if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") { e.preventDefault(); return step(1); }
      if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); return step(-1); }
      // Stepping walks the deck; backing out climbs the model. They are
      // different moves, and after a click into a card it's the second one you
      // want — the previous slide is not where you came from.
      if (k === "ArrowUp" || k === "Backspace") { e.preventDefault(); return upView && onNavigate(upView); }
      if (k === "Home") return bar.home && onNavigate(bar.home);
      if (k === "End") return onNavigate(views[views.length - 1]?.name);
      if (k === "f" || k === "F") return toggleFullscreen();
      if (k === "t" || k === "T") return onCycleTheme();
      if (k === "b" || k === "B") return setBarHidden((h) => !h);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [step, upView, onExit, onNavigate, views, bar.home, toggleFullscreen, onCycleTheme]);

  // The chrome earns its place only while you're moving; after that it's in the
  // way of the diagram, which is the whole point of the mode.
  useEffect(() => {
    const wake = () => {
      setIdle(false);
      clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), 3500);
    };
    wake();
    addEventListener("mousemove", wake);
    addEventListener("keydown", wake);
    return () => {
      removeEventListener("mousemove", wake);
      removeEventListener("keydown", wake);
      clearTimeout(idleTimer.current);
    };
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setHint(false), 5000);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-[var(--canvas)] text-[var(--fg)] ${
        idle ? "cursor-none [&_*]:!cursor-none" : ""
      }`}
    >
      <Stage
        svg={svg}
        animate={animate}
        intent={intent}
        fill
        onPick={onPick}
        onBlank={upView ? () => onNavigate(upView) : undefined}
        className="[background-image:none]"
      />

      {views.length > 1 && (
        <div
          className={`pointer-events-none absolute left-1/2 z-10 flex w-[calc(100%-3rem)] -translate-x-1/2 justify-center transition-opacity duration-500 ${
            barHidden ? "top-0" : "top-3.5"
          } ${idle ? "opacity-0 [&_*]:!pointer-events-none" : "opacity-100"}`}
        >
          {barHidden ? (
            <ViewBarHandle onShow={() => setBarHidden(false)} />
          ) : (
            <ViewBar
              bar={bar}
              onNavigate={(name) => onNavigate(name)}
              flowStep={flow ? { step: flowStep, steps: flow.steps } : undefined}
              onHide={() => setBarHidden(true)}
            />
          )}
        </div>
      )}

      <footer
        className={`pointer-events-none absolute inset-x-0 bottom-0 transition-opacity duration-500 ${
          idle ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex items-end justify-between gap-6 px-6 pb-4 text-[12px]">
          {/* No view title here: the diagram carries its own, and a second
              copy in the corner was a label on a label. What stays is state
              the picture cannot show — where a flow walk is — and the hint. */}
          <div className="min-w-0">
            {flow && (
              <div className="text-[11px] text-[var(--muted)]">
                {/* a view named after the flow it narrates shouldn't say it twice */}
                {flow.label !== (current?.title ?? current?.name) && `${flow.label} · `}
                step <span className="tabular-nums text-[var(--fg)]">{flowStep}</span>
                <span className="tabular-nums">/{flow.steps}</span>
              </div>
            )}
            {hint && <div className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{HINT}</div>}
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-3 text-[var(--muted)]">
            <span className="tabular-nums">
              {at + 1} / {views.length}
            </span>
            <button onClick={onExit} className="rounded px-1.5 py-0.5 hover:text-[var(--fg)]" title="Esc">
              Exit
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
