// Presentation mode: the deck you already wrote.
//
// A squinch project is a set of views over one model, ordered as declared —
// which is exactly a slide deck, so there is nothing to author twice. Stepping
// forward walks the views; clicking a card zooms in and the deck follows you
// there, so a question from the room doesn't cost you your place.
import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, type Box, type Intent } from "./Stage";
import type { ViewRef } from "./squinch";

export interface PresenterProps {
  svg?: string;
  views: ViewRef[];
  activeView?: string;
  /** ancestor trail of the current view — the way back out of a card */
  crumbs: { label: string; view?: string }[];
  /** one altitude up, if there is one */
  upView?: string;
  animate: boolean;
  intent?: Intent;
  onNavigate(name: string, rect?: Box): void;
  onPick(path: string, box: Box): void;
  onCycleTheme(): void;
  onExit(): void;
}

const HINT =
  "→ ← step · click a card to zoom in, the backdrop to come out · T theme · F fullscreen · Esc exit";

export function Presenter({
  svg, views, activeView, crumbs, upView, animate, intent, onNavigate, onPick, onCycleTheme, onExit,
}: PresenterProps) {
  const at = Math.max(0, views.findIndex((v) => v.name === activeView));
  const current = views[at];
  const [idle, setIdle] = useState(false);
  const [hint, setHint] = useState(true);
  const idleTimer = useRef<number | undefined>(undefined);

  const step = useCallback(
    (by: number) => {
      const next = views[at + by];
      if (next) onNavigate(next.name);
    },
    [views, at, onNavigate],
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
      if (k === "Escape") return onExit();
      if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") { e.preventDefault(); return step(1); }
      if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); return step(-1); }
      // Stepping walks the deck; backing out climbs the model. They are
      // different moves, and after a click into a card it's the second one you
      // want — the previous slide is not where you came from.
      if (k === "ArrowUp" || k === "Backspace") { e.preventDefault(); return upView && onNavigate(upView); }
      if (k === "Home") return onNavigate(views[0]?.name);
      if (k === "End") return onNavigate(views[views.length - 1]?.name);
      if (k === "f" || k === "F") return toggleFullscreen();
      if (k === "t" || k === "T") return onCycleTheme();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [step, upView, onExit, onNavigate, views, toggleFullscreen, onCycleTheme]);

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
        idle ? "cursor-none" : ""
      }`}
    >
      <Stage
        svg={svg}
        animate={animate}
        intent={intent}
        fit
        zoom={1}
        fill
        onPick={onPick}
        onBlank={upView ? () => onNavigate(upView) : undefined}
        className="[background-image:none]"
      />

      {crumbs.length > 1 && (
        <nav
          className={`absolute left-6 top-5 z-10 flex items-center gap-1.5 text-[12px] text-[var(--muted)] transition-opacity duration-500 ${
            idle ? "opacity-0" : "opacity-100"
          }`}
        >
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="opacity-50">›</span>}
              <button
                disabled={!c.view || c.view === activeView}
                onClick={() => c.view && onNavigate(c.view)}
                className={
                  c.view && c.view !== activeView
                    ? "cursor-zoom-out hover:text-[var(--fg)] hover:underline"
                    : "text-[var(--fg)]"
                }
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>
      )}

      <footer
        className={`pointer-events-none absolute inset-x-0 bottom-0 transition-opacity duration-500 ${
          idle ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex items-end justify-between gap-6 px-6 pb-4 text-[12px]">
          <div className="min-w-0">
            <div className="truncate font-medium">{current?.title ?? current?.name ?? ""}</div>
            {hint && <div className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{HINT}</div>}
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-3 text-[var(--muted)]">
            <div className="flex items-center gap-1.5">
              {views.map((v, i) => (
                <button
                  key={v.name}
                  onClick={() => onNavigate(v.name)}
                  title={v.title ?? v.name}
                  aria-label={v.title ?? v.name}
                  className={`h-1.5 rounded-full transition-all ${
                    i === at ? "w-5 bg-[var(--accent)]" : "w-1.5 bg-[var(--line-strong)] hover:bg-[var(--fg)]"
                  }`}
                />
              ))}
            </div>
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
