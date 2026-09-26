// The view bar: home, then the path to where you stand with every hop a menu
// of the views beside it at that altitude, then the flows apart — a story
// belongs to no one altitude. What goes in each hop is core's `viewBar`, the
// same description the interactive export draws, so the two cannot disagree;
// this file is only how the playground spells it. `docs/notes/view-bar.md`
// has the tabs it replaced and the other shapes it beat.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKey } from "react";
import type { BarItem, BarSegment, ViewBar as Bar } from "@squinch/core/browser";

const hopBtn = "flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md pl-2.5 pr-2 text-[12.5px] transition-colors";
const tone = {
  current: "font-semibold text-[var(--fg)]",
  link: "text-[var(--muted)] hover:text-[var(--fg)]",
  ghost: "italic text-[var(--text-3)] hover:text-[var(--fg)]",
} as const;

/**
 * Short of room the bar gives way in steps, never by overlapping. Each level
 * keeps everything the one before it gave up:
 *   1. labels truncate, ancestors harder than the hop you stand on
 *   2. the outer ancestors fold away (home and a backdrop click still climb)
 *   3. the flows pill drops to its icon
 *   4. the nearest ancestor folds too
 *   5. the hop you stand on truncates hard
 * A ghost hop ("4 inside") is short and says nothing once cut, so it never
 * does. The level is measured, not guessed from the window: the editor pane,
 * the presenter and a phone all hand the bar different room.
 */
const FOLDS = 5;
const labelMax = (state: BarSegment["state"], level: number) =>
  state === "ghost" ? "" : state === "current"
    ? level >= 5 ? "max-w-[6rem]" : level >= 1 ? "max-w-[11rem]" : "max-w-[220px]"
    : level >= 1 ? "max-w-[8rem]" : "max-w-[220px]";

export function ViewBar({
  bar,
  onNavigate,
  flowStep,
  onHide,
}: {
  bar: Bar;
  onNavigate(view: string): void;
  /** where the active flow's walk is, when a presenter is walking it */
  flowStep?: { step: number; steps: number };
  /** present only where the bar may be put away (presentation) */
  onHide?(): void;
}) {
  const [open, setOpen] = useState<string>();
  const [level, setLevel] = useState(0);
  const wrap = useRef<HTMLElement>(null);

  // Fold one level at a time until the bar fits its strip. Runs before paint,
  // so the reader never sees a level that did not fit; any change to what is
  // drawn, or to the room, starts again from the top.
  useLayoutEffect(() => {
    const nav = wrap.current;
    const room = nav?.parentElement?.clientWidth;
    if (nav && room && nav.scrollWidth > room + 0.5 && level < FOLDS) setLevel(level + 1);
  });
  const drawn = bar.segments.map((s) => s.key + s.state + s.label).join() + bar.activeFlow?.view + !!onHide;
  useLayoutEffect(() => setLevel(0), [drawn]);
  useEffect(() => {
    const strip = wrap.current?.parentElement;
    if (!strip) return;
    let last = strip.clientWidth;
    const ro = new ResizeObserver(() => {
      if (strip.clientWidth !== last) { last = strip.clientWidth; setLevel(0); }
    });
    ro.observe(strip);
    return () => ro.disconnect();
  }, []);

  // One menu at a time. Dismissed on pointerdown, so it is gone before a click
  // lands underneath; Escape is caught on the way *down* so a presenter
  // listening on window closes the menu rather than the presentation.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(undefined);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(undefined);
      wrap.current?.querySelector<HTMLElement>(`[data-hop="${CSS.escape(open)}"]`)?.focus();
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc, true);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc, true);
    };
  }, [open]);
  // a view change closes whatever was open
  const where = bar.segments.map((s) => s.key + s.state).join() + bar.activeFlow?.view;
  useEffect(() => setOpen(undefined), [where]);

  const go = (view: string) => {
    setOpen(undefined);
    onNavigate(view);
  };
  const toggle = (key: string) => setOpen((o) => (o === key ? undefined : key));
  const homeLabel = bar.home ?? "home";
  // outer ancestors fold first; the nearest one holds on until the very end
  const nearest = bar.segments.map((s) => s.state).lastIndexOf("link");
  const folded = (s: BarSegment, i: number) =>
    s.state === "link" && (i === nearest ? level >= 4 : level >= 2);

  return (
    <nav ref={wrap} aria-label="Views" className="pointer-events-auto flex shrink-0 items-center gap-2">
      <div className="pg-pill flex shrink-0 items-center gap-px rounded-[9px] p-[3px]">
        <button
          onClick={() => bar.home && go(bar.home)}
          aria-label={homeLabel}
          aria-current={bar.atHome ? "page" : undefined}
          title={`Home — ${homeLabel}`}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
            bar.atHome ? "bg-[var(--control)] text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--fg)]"
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 7.25 8 2.75l5.5 4.5" />
            <path d="M4 6.25v6.25a1 1 0 0 0 1 1h2V10h2v3.5h2a1 1 0 0 0 1-1V6.25" />
          </svg>
        </button>
        {bar.segments.length > 0 && <span className="mx-1 h-4 w-px shrink-0 bg-[var(--line)]" />}
        {bar.segments.map((s, i) =>
          folded(s, i) ? null : (
            // separators trail their hop, so a folded ancestor takes its own
            <span key={s.key} className="flex shrink-0 items-center">
              <Hop seg={s} level={level} open={open === s.key} onToggle={() => toggle(s.key)} onPick={go} />
              {i < bar.segments.length - 1 && <span className="px-px text-[13px] text-[var(--line-strong)]">/</span>}
            </span>
          ),
        )}
      </div>
      {bar.flows.length > 0 && (
        <FlowsHop bar={bar} flowStep={flowStep} iconOnly={level >= 3} open={open === "#flows"} onToggle={() => toggle("#flows")} onPick={go} />
      )}
      {onHide && (
        <button
          onClick={onHide}
          aria-label="Hide the view bar"
          title="Hide (B)"
          className="pg-pill flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-[var(--muted)] hover:text-[var(--fg)]"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4.5 9.5 8 6l3.5 3.5" />
          </svg>
        </button>
      )}
    </nav>
  );
}

/** What is left of the bar while it is put away: a sliver at the top edge
 *  that brings it back on hover or click, so no shortcut has to be known. */
export function ViewBarHandle({ onShow }: { onShow(): void }) {
  return (
    <button
      onClick={onShow}
      onPointerEnter={onShow}
      aria-label="Show the view bar"
      title="Show the view bar (B)"
      className="group pointer-events-auto flex h-[22px] w-60 justify-center pt-[7px]"
    >
      <span className="block h-1 w-11 rounded-full bg-[var(--line-strong)] opacity-60 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function Hop({ seg, level, open, onToggle, onPick }: {
  seg: BarSegment; level: number; open: boolean; onToggle(): void; onPick(view: string): void;
}) {
  const label = <span className={`truncate ${labelMax(seg.state, level)}`}>{seg.label}</span>;
  if (!seg.items.length)
    return <span className={`${hopBtn} ${tone[seg.state]} cursor-default pr-2.5`}>{label}</span>;
  if (seg.items.length === 1) {
    const only = seg.items[0];
    return (
      <button
        data-hop={seg.key}
        onClick={() => !only.active && onPick(only.view)}
        aria-current={only.active ? "page" : undefined}
        className={`${hopBtn} ${tone[seg.state]} pr-2.5`}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="relative flex">
      <button
        data-hop={seg.key}
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-current={seg.state === "current" ? "page" : undefined}
        className={`${hopBtn} ${tone[seg.state]} ${open ? "bg-[var(--control)] text-[var(--fg)]" : ""}`}
      >
        {label}
        <Caret />
      </button>
      {open && <Menu items={seg.items} onPick={onPick} />}
    </span>
  );
}

function FlowsHop({ bar, flowStep, iconOnly, open, onToggle, onPick }: {
  bar: Bar; flowStep?: { step: number; steps: number }; iconOnly: boolean;
  open: boolean; onToggle(): void; onPick(view: string): void;
}) {
  const f = bar.activeFlow;
  // One flow is a link to it, named — a menu of one is a click for nothing.
  const only = bar.flows.length === 1 ? bar.flows[0] : undefined;
  return (
    <span className="relative flex shrink-0">
      <button
        data-hop="#flows"
        onClick={only ? () => !only.active && onPick(only.view) : onToggle}
        aria-haspopup={only ? undefined : "menu"}
        aria-expanded={only ? undefined : open}
        aria-current={f ? "page" : undefined}
        title={f ? f.label : only ? only.label : "Flows"}
        className={`pg-pill flex h-9 items-center gap-[7px] whitespace-nowrap rounded-[9px] px-[11px] text-[12.5px] ${
          open ? "bg-[var(--control)]" : ""
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"
          className={`shrink-0 ${f ? "text-[var(--accent)]" : "text-[var(--text-3)]"}`}>
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <path d="M5.5 4H10a2 2 0 0 1 0 4H6a2 2 0 0 0 0 4h4.5" />
        </svg>
        <span className={`max-w-[200px] truncate ${iconOnly ? "hidden" : ""} ${f ? "font-semibold text-[var(--fg)]" : "text-[var(--muted)]"}`}>
          {f ? f.label : only ? only.label : "Flows"}
        </span>
        <span className="pg-mono text-[10.5px] tabular-nums text-[var(--text-3)]">
          {f && flowStep ? `${flowStep.step}/${flowStep.steps}` : f || only ? "" : bar.flows.length}
        </span>
        {!only && <Caret />}
      </button>
      {open && !only && <Menu items={bar.flows} onPick={onPick} alignRight />}
    </span>
  );
}

/** A hop's menu. Focus lands on the view you are on, arrows move, a letter
 *  jumps, Enter picks — and none of those keys leak out to a presenter that
 *  would read them as "next slide". */
function Menu({ items, onPick, alignRight }: { items: BarItem[]; onPick(view: string): void; alignRight?: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  // kept on screen: on a phone the bar sits right, and a menu opening from a
  // hop near the edge would run off it
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const over = r.right - (document.documentElement.clientWidth - 8);
    if (over > 0) el.style.transform = `translateX(${-Math.min(over, Math.max(0, r.left - 8))}px)`;
  }, []);
  useEffect(() => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
    (rows.find((r) => r.getAttribute("aria-checked") === "true") ?? rows[0])?.focus();
  }, []);

  const onKey = (e: ReactKey) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const to = (i: number) => rows[(i + rows.length) % rows.length]?.focus();
    if (e.key === "ArrowDown") to(at + 1);
    else if (e.key === "ArrowUp") to(at - 1);
    else if (e.key === "Home") to(0);
    else if (e.key === "End") to(rows.length - 1);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase();
      const next = [...rows.slice(at + 1), ...rows.slice(0, at + 1)].find((r) => r.dataset.label?.startsWith(k));
      next?.focus();
    } else if (e.key !== "Enter" && e.key !== " " && e.key !== "Tab") return;
    // keys the menu handles stay in the menu; Tab and Enter act normally
    if (e.key !== "Tab" && e.key !== "Enter" && e.key !== " ") e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={list}
      role="menu"
      onKeyDown={onKey}
      className={`absolute top-full z-40 mt-1.5 max-h-[min(420px,70vh)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[11px] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[var(--panel-shadow)] ${
        alignRight ? "right-0" : "left-0"
      }`}
    >
      {items.map((it) => (
        <button
          key={it.view}
          role="menuitemradio"
          aria-checked={it.active}
          data-label={it.label.toLowerCase()}
          onClick={() => (it.active ? undefined : onPick(it.view))}
          title={it.view}
          className={`flex w-full items-center gap-2 rounded-[7px] px-2.5 py-[7px] text-left text-[13px] outline-none transition-colors focus-visible:bg-[var(--control)] hover:bg-[var(--control)] ${
            it.active ? "bg-[var(--control)] font-semibold text-[var(--fg)]" : "text-[var(--fg)]"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{it.label}</span>
          {it.auto && (
            <span className="pg-mono rounded border border-[var(--line)] px-1 text-[9.5px] text-[var(--text-3)]">auto</span>
          )}
          {it.lenses ? (
            <span className="pg-mono text-[10.5px] text-[var(--text-3)]">+{it.lenses} {it.lenses === 1 ? "lens" : "lenses"}</span>
          ) : null}
          <span className="w-3.5 text-[var(--accent)]">
            {it.active && (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m3.5 8.5 3 3 6-7" />
              </svg>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function Caret() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-[var(--text-3)]">
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}
