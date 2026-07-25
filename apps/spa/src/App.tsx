import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "./Editor";
import { compile, decodeShare, encodeShare, type Preview } from "./squinch";
import { EXAMPLES } from "./examples";

type Theme = "light" | "dark" | "sketch" | "sketch-dark";
const THEME_CYCLE: Theme[] = ["light", "dark", "sketch", "sketch-dark"];
const THEME_LABEL: Record<Theme, string> = {
  light: "Light", dark: "Dark", sketch: "Sketch", "sketch-dark": "Sketch dark",
};

const STORAGE_KEY = "squinch:source";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function App() {
  const [source, setSource] = useState(() => {
    const fragment = location.hash.slice(1);
    if (fragment.startsWith("s=")) {
      const decoded = decodeShare(fragment.slice(2));
      if (decoded) return decoded;
    }
    return localStorage.getItem(STORAGE_KEY) ?? EXAMPLES[0].source;
  });
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("squinch:theme") as Theme) ?? "light",
  );
  const [view, setView] = useState<string>();
  const [preview, setPreview] = useState<Preview>({ diagnostics: [], ok: true, views: [] });
  const [lastGood, setLastGood] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);

  const debounced = useDebounced(source, 180);

  useEffect(() => {
    // app chrome only knows light/dark; sketch maps to its nearest shade
    document.documentElement.dataset.theme = theme.includes("dark") ? "dark" : "light";
    localStorage.setItem("squinch:theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, source);
  }, [source]);

  useEffect(() => {
    let stale = false;
    compile(debounced, { view, theme }).then((next) => {
      if (stale) return;
      setPreview(next);
      // last-good preview: never blank the canvas while typing
      if (next.svg) setLastGood(next.svg);
    });
    return () => {
      stale = true;
    };
  }, [debounced, view, theme]);

  const shown = preview.svg ?? lastGood;
  const errors = preview.diagnostics.filter((d) => d.severity === "error");
  const warnings = preview.diagnostics.filter((d) => d.severity === "warning");

  const flash = (what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(undefined), 1400);
  };

  const share = useCallback(() => {
    const url = `${location.origin}${location.pathname}#s=${encodeShare(source)}`;
    navigator.clipboard.writeText(url);
    history.replaceState(null, "", `#s=${encodeShare(source)}`);
    flash("Link copied");
  }, [source]);

  const views = preview.views;
  const activeView = views.find((v) => v.name === view)?.name ?? views[0]?.name;
  const activeScope = views.find((v) => v.name === activeView)?.scope;

  /** Zoom target for a clicked element: the view scoped to that container. */
  const viewForPath = useCallback(
    (path: string) => views.find((v) => v.scope === path && v.name !== activeView),
    [views, activeView],
  );

  /** Ancestor trail of the current scope, each hop a view we can jump to. */
  const crumbs = useMemo(() => {
    const trail: { label: string; view?: string }[] = [];
    const root = views.find((v) => !v.scope);
    if (root) trail.push({ label: "landscape", view: root.name });
    if (!activeScope) return trail;
    const parts = activeScope.split(".");
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join(".");
      const target = views.find((v) => v.scope === path);
      trail.push({ label: parts[i], view: target?.name });
    }
    return trail;
  }, [views, activeScope]);

  const download = useCallback(() => {
    if (!shown) return;
    const blob = new Blob([shown], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${activeView ?? "diagram"}.${theme}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [shown, activeView, theme]);

  const onCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-path]");
      const path = el?.getAttribute("data-path");
      if (!path) return;
      const target = viewForPath(path);
      if (target) {
        setView(target.name);
        flash(`Zoomed into ${path}`);
      }
    },
    [viewForPath],
  );

  // Cmd/Ctrl-S exports, Cmd/Ctrl-\ toggles the editor pane
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        download();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setEditorOpen((o) => !o);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [download]);

  return (
    <div className="flex h-screen flex-col bg-[var(--chrome)] text-[var(--fg)]">
      <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Mark />
          <span className="text-[13px] font-medium tracking-tight">squinch</span>
          <span className="rounded bg-[var(--chip)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
            playground
          </span>
        </div>

        <div className="ml-2 flex items-center gap-1">
          <select
            className="rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[12px] outline-none"
            value=""
            onChange={(e) => {
              const ex = EXAMPLES.find((x) => x.name === e.target.value);
              if (ex) {
                setSource(ex.source);
                setView(undefined);
              }
            }}
          >
            <option value="">Examples…</option>
            {EXAMPLES.map((ex) => (
              <option key={ex.name} value={ex.name}>
                {ex.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        {views.length > 1 && (
          <div className="flex items-center gap-1 rounded border border-[var(--line)] p-0.5">
            {views.map((v) => (
              <button
                key={v.name}
                onClick={() => setView(v.name)}
                title={v.title}
                className={`rounded px-2 py-1 text-[12px] transition-colors ${
                  v.name === activeView
                    ? "bg-[var(--chip)] text-[var(--fg)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
              >
                {v.name}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length])}
          className={btn}
          title="Cycle theme"
        >
          {THEME_LABEL[theme]}
        </button>
        <button onClick={share} className={btn} title="Copy a link — the source travels in the URL fragment">
          Share
        </button>
        <button onClick={download} className={btn} title="⌘S">
          Export SVG
        </button>
      </header>

      <main className="flex min-h-0 flex-1">
        {editorOpen && (
          <section className="flex w-[42%] min-w-[320px] max-w-[640px] flex-col border-r border-[var(--line)] bg-[var(--surface)]">
            <div className="flex-1 overflow-hidden">
              <Editor value={source} diagnostics={preview.diagnostics} onChange={setSource} />
            </div>
            <Diagnostics errors={errors} warnings={warnings} />
          </section>
        )}

        <section className="relative min-w-0 flex-1 overflow-auto bg-[var(--canvas)] [background-image:radial-gradient(var(--dot)_1px,transparent_1px)] [background-size:20px_20px]">
          <button
            onClick={() => setEditorOpen((o) => !o)}
            className="absolute left-3 top-3 z-10 rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--fg)]"
            title="⌘\"
          >
            {editorOpen ? "Hide editor" : "Show editor"}
          </button>
          {crumbs.length > 1 && (
            <nav className="absolute left-3 top-12 z-10 flex items-center gap-1 text-[11px] text-[var(--muted)]">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="opacity-50">›</span>}
                  <button
                    disabled={!c.view || c.view === activeView}
                    onClick={() => c.view && setView(c.view)}
                    className={c.view && c.view !== activeView ? "hover:text-[var(--fg)] hover:underline" : "text-[var(--fg)]"}
                  >
                    {c.label}
                  </button>
                </span>
              ))}
            </nav>
          )}
          <div className="flex min-h-full items-center justify-center p-10" onClick={onCanvasClick}>
            {shown ? (
              <div
                className={`transition-opacity ${preview.ok ? "opacity-100" : "opacity-60"} ${
                  fit ? "[&>svg]:h-auto [&>svg]:max-w-full" : ""
                }`}
                style={fit ? undefined : { transform: `scale(${zoom})`, transformOrigin: "center" }}
                dangerouslySetInnerHTML={{ __html: shown }}
              />
            ) : (
              <p className="text-[13px] text-[var(--muted)]">Rendering…</p>
            )}
          </div>
          <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded border border-[var(--line)] bg-[var(--surface)] p-0.5 text-[11px]">
            <button
              onClick={() => { setFit(true); setZoom(1); }}
              className={`rounded px-2 py-1 ${fit ? "bg-[var(--chip)] text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}
            >
              Fit
            </button>
            <button
              onClick={() => { setFit(false); setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2))); }}
              className="rounded px-2 py-1 text-[var(--muted)] hover:text-[var(--fg)]"
            >
              −
            </button>
            <span className="w-10 text-center tabular-nums text-[var(--muted)]">
              {fit ? "auto" : `${Math.round(zoom * 100)}%`}
            </span>
            <button
              onClick={() => { setFit(false); setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2))); }}
              className="rounded px-2 py-1 text-[var(--muted)] hover:text-[var(--fg)]"
            >
              +
            </button>
          </div>
          {copied && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-[var(--fg)] px-3 py-1.5 text-[12px] text-[var(--canvas)]">
              {copied}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const btn =
  "rounded border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-[var(--muted)] transition-colors hover:text-[var(--fg)] hover:border-[var(--line-strong)]";

function Diagnostics({
  errors,
  warnings,
}: {
  errors: { message: string; fix?: string; loc: { line: number; col: number } }[];
  warnings: { message: string; loc: { line: number } }[];
}) {
  if (!errors.length && !warnings.length)
    return (
      <div className="border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--muted)]">
        No problems
      </div>
    );
  return (
    <div className="max-h-44 overflow-auto border-t border-[var(--line)] px-3 py-2 text-[11px]">
      {errors.map((d, i) => (
        <div key={`e${i}`} className="mb-1.5">
          <span className="text-[var(--error)]">error</span>{" "}
          <span className="text-[var(--muted)]">
            {d.loc.line}:{d.loc.col}
          </span>{" "}
          {d.message}
          {d.fix && <div className="pl-12 text-[var(--muted)]">{d.fix}</div>}
        </div>
      ))}
      {warnings.map((d, i) => (
        <div key={`w${i}`} className="mb-1.5 text-[var(--muted)]">
          <span className="text-[var(--warn)]">warning</span> {d.loc.line} {d.message}
        </div>
      ))}
    </div>
  );
}

/** The squinch itself: a dome carried on four corner arches. */
function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 100 100" aria-hidden>
      <rect x="12" y="12" width="76" height="76" fill="none" stroke="var(--muted)" strokeWidth="6" />
      <g fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round">
        <path d="M 35.74 12 A 23.74 23.74 0 0 1 12 35.74" />
        <path d="M 64.26 12 A 23.74 23.74 0 0 0 88 35.74" />
        <path d="M 64.26 88 A 23.74 23.74 0 0 1 88 64.26" />
        <path d="M 35.74 88 A 23.74 23.74 0 0 0 12 64.26" />
      </g>
      <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="7" />
    </svg>
  );
}
