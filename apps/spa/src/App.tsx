import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor, type EditorApi } from "./Editor";
import { IconPalette } from "./IconPalette";
import { CreditsDialog } from "./Credits";
// The brand mark is served, not bundled: docs/assets/mark.svg is copied to
// public/favicon.svg by scripts/sync-media.ts and does double duty as the tab
// icon and the visible logo, here and on the static pages. One drawing, one
// file — there used to be four byte-identical copies of it in the tree.
const markUrl = `${import.meta.env.BASE_URL}favicon.svg`;
import { Presenter } from "./Presenter";
import { Stage, useReducedMotion, type Box, type Intent } from "./Stage";
import { compile, decodeShare, encodeShare, ensureRenderable, svgToPng, type Preview } from "./squinch";
import { themes, exportHTML, crumbs as crumbsFor, hop, upView as upViewFor, viewForPath as viewFor } from "@squinch/core/browser";
import { EXAMPLES } from "./examples";

type Theme = "light" | "dark";
const THEME_CYCLE: Theme[] = ["light", "dark"];
const THEME_LABEL: Record<Theme, string> = { light: "Light", dark: "Dark" };

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
    // first visit follows the OS; an explicit choice (cycleTheme persists it)
    // wins forever after
    () => (localStorage.getItem("squinch:theme") as Theme)
      ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  const [view, setView] = useState<string>();
  const [preview, setPreview] = useState<Preview>({ diagnostics: [], ok: true, views: [] });
  const [lastGood, setLastGood] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const editorApi = useRef<EditorApi | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [intent, setIntent] = useState<Intent>();
  const [presenting, setPresenting] = useState(false);
  // How much of the current view's flow has been narrated. Presentation only:
  // while authoring you want the whole flow at once, not a story.
  const [flowStep, setFlowStep] = useState(1);
  const token = useRef(0);
  const reduced = useReducedMotion();

  const debounced = useDebounced(source, 180);

  // Which example the buffer *is*, derived rather than remembered: the select
  // used to pin `value=""`, so it snapped back to the placeholder the moment
  // you picked anything. Matching on content instead of storing a choice means
  // the dropdown also survives a reload (source comes back from localStorage),
  // and honestly returns to "Examples…" once you edit — at that point the
  // buffer is yours, not the example.
  const currentExample = useMemo(
    () => EXAMPLES.find((x) => x.source === source),
    [source],
  );

  const loadExample = useCallback((ex: (typeof EXAMPLES)[number]) => {
    setSource(ex.source);
    setView(undefined);
  }, []);

  // Prev/next walk the list in its declared order (grouped, so neighbours are
  // related cases). From an edited buffer there is no "current" to step from:
  // next starts the tour at the first example, prev at the last.
  const stepExample = useCallback(
    (dir: 1 | -1) => {
      const i = currentExample ? EXAMPLES.indexOf(currentExample) : dir === 1 ? -1 : EXAMPLES.length;
      loadExample(EXAMPLES[(i + dir + EXAMPLES.length) % EXAMPLES.length]);
    },
    [currentExample, loadExample],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("squinch:theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, source);
  }, [source]);

  useEffect(() => {
    let stale = false;
    compile(debounced, { view, theme, flowStep: presenting ? flowStep : undefined }).then((next) => {
      if (stale) return;
      setPreview(next);
      // last-good preview: never blank the canvas while typing
      if (next.svg) setLastGood(next.svg);
    });
    return () => {
      stale = true;
    };
  }, [debounced, view, theme, presenting, flowStep]);

  // Settle an "enter at the end" overshoot once the view's length is known.
  useEffect(() => {
    if (preview.flow && flowStep > preview.flow.steps) setFlowStep(preview.flow.steps);
  }, [preview.flow, flowStep]);

  const shown = preview.svg ?? lastGood;
  // The light half of the adaptive pair for whatever is on screen: the theme
  // itself if it declares a dark counterpart, otherwise the one that declares
  // *it*. Read off the theme table rather than restated here, so adding a pair
  // needs one edit — and absent when a theme has neither, which is why the
  // export button is optional rather than assumed.
  const adaptiveBase = useMemo(
    () =>
      themes[theme]?.pairsWith
        ? theme
        : Object.values(themes).find((t) => t.pairsWith === theme)?.name,
    [theme],
  );
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
    (path: string) => viewFor(views, activeView, path),
    [views, activeView],
  );

  /** Every view change goes through here, so the canvas can animate the hop.
   *  The direction is derived from how the two scopes relate — not from which
   *  control was clicked — which means the breadcrumb, the view tabs and a
   *  click on a card all behave consistently. A lateral hop (same scope,
   *  different lens) comes back anchorless and the stage cuts instead. */
  const navigate = useCallback(
    (name: string, rect?: Box, enterAtEnd = false) => {
      if (!name || name === activeView) return;
      const { dir, anchor } = hop(views, activeView, name);
      setIntent({ token: ++token.current, dir, path: anchor, ...(dir === "in" && anchor ? { rect } : {}) });
      setView(name);
      // A slide opens on its first hop — unless you reversed into it, in which
      // case you arrive where you left, at the end, and can keep unwinding.
      // How many hops that is isn't known until it renders, so overshoot and
      // let the clamp below settle it; the renderer clamps too, so the first
      // frame is already right.
      setFlowStep(enterAtEnd ? Number.MAX_SAFE_INTEGER : 1);
    },
    [views, activeView],
  );

  /** Ancestor trail of the current scope, each hop a view we can jump to. */
  const crumbs = useMemo(() => crumbsFor(views, activeScope), [views, activeScope]);

  /** One altitude back up: the nearest ancestor that has a view of its own. */
  const upView = useMemo(
    () => upViewFor(views, activeView, activeScope),
    [views, activeView, activeScope],
  );

  /** Hand a blob URL to the browser as a download. The URL is revoked on a
   *  later tick, not immediately: the click only *starts* the save, and
   *  revoking synchronously can pull the data out from under it. */
  const save = useCallback((url: string, ext: string, variant?: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeView ?? "diagram"}.${variant ?? theme}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [activeView, theme]);

  const download = useCallback(() => {
    if (!shown) return;
    save(URL.createObjectURL(new Blob([shown], { type: "image/svg+xml" })), "svg");
  }, [shown, save]);

  const downloadPng = useCallback(async () => {
    if (!shown) return;
    // The browser is the rasterizer here, and it honours the @font-face our
    // SVGs embed — so unlike the CLI there are no fonts to wire up. 2× because
    // a PNG's whole reason to exist is being pasted somewhere, usually a
    // retina screen.
    const png = await svgToPng(shown, 2);
    if (!png) return flash("Could not export PNG");
    save(png, "png");
  }, [shown, save]);

  /** One file that follows the reader's colour scheme — for embedding
   *  somewhere the background isn't ours to pick. Compiled on demand rather
   *  than kept alongside the preview: the canvas only ever shows one palette,
   *  so carrying the other around all the time would be waste. */
  const downloadAdaptive = useCallback(async () => {
    if (!adaptiveBase) return;
    const r = await compile(source, { view: activeView, theme: adaptiveBase, adaptive: true });
    if (!r.svg) return flash("Could not export adaptive SVG");
    save(
      URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml" })),
      "svg",
      "adaptive",
    );
  }, [adaptiveBase, source, activeView, save]);

  /** Every view of the project in one file, with the dive between them — the
   *  altitude experience, portable. Renders view × palette up front, which is a
   *  second or so of work, hence the busy flag. */
  const [exporting, setExporting] = useState(false);
  const downloadHtml = useCallback(async () => {
    setExporting(true);
    try {
      // core renders synchronously, so the packs and every icon must be
      // resident first — the preview usually warmed them, but "usually" is not
      // a thing to ship an export on
      await ensureRenderable(source);
      const r = await exportHTML([{ name: "diagram.squinch", src: source }], {
        ...(activeView ? { view: activeView } : {}),
      });
      if (!r.ok || !r.html) return flash("Could not build the interactive export");
      save(URL.createObjectURL(new Blob([r.html], { type: "text/html" })), "html", "interactive");
    } finally {
      setExporting(false);
    }
  }, [source, activeView, save]);

  const onPick = useCallback(
    (path: string, box: Box) => {
      const target = viewForPath(path);
      if (target) navigate(target.name, box);
    },
    [viewForPath, navigate],
  );

  const cycleTheme = useCallback(
    () => setTheme((t) => THEME_CYCLE[(THEME_CYCLE.indexOf(t) + 1) % THEME_CYCLE.length]),
    [],
  );

  // Cmd/Ctrl-S exports, Cmd/Ctrl-\ toggles the editor pane
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        download();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setEditorOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        setPresenting((p) => (p ? false : views.length > 0));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [download, views.length]);

  if (presenting)
    return (
      <Presenter
        svg={shown}
        views={views}
        activeView={activeView}
        crumbs={crumbs}
        upView={upView}
        flow={preview.flow}
        flowStep={flowStep}
        onFlowStep={setFlowStep}
        animate={!reduced}
        intent={intent}
        onNavigate={navigate}
        onPick={onPick}
        onCycleTheme={cycleTheme}
        onExit={() => setPresenting(false)}
      />
    );

  return (
    <div className="flex h-screen flex-col bg-[var(--chrome)] text-[var(--fg)]">
      {/* offscreen, not decorative — the editor UI has no visible page title,
          so this is the only thing giving the document an <h1> at all */}
      <h1 className="sr-only">Squinch — playground</h1>
      <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-2.5">
        <a
          className="flex items-center gap-2"
          href={import.meta.env.BASE_URL}
          title="Squinch — back to the site"
        >
          <img src={markUrl} width={18} height={18} alt="" />
          <span className="text-[13px] font-medium tracking-tight">squinch</span>
          <span className="rounded bg-[var(--chip)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
            playground
          </span>
        </a>

        <div className="ml-2 flex items-center gap-1">
          <button
            onClick={() => stepExample(-1)}
            className={btn}
            title="Previous example"
            aria-label="Previous example"
          >
            ‹
          </button>
          <select
            className="rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[12px] outline-none"
            value={currentExample ? `${currentExample.group}/${currentExample.name}` : ""}
            onChange={(e) => {
              // keyed by group too: `landscape` is both an example project and
              // a lookbook case, and matching on name alone loaded the wrong one
              const ex = EXAMPLES.find((x) => `${x.group}/${x.name}` === e.target.value);
              if (ex) loadExample(ex);
            }}
          >
            <option value="">Examples…</option>
            {[...new Set(EXAMPLES.map((ex) => ex.group))].map((group) => (
              <optgroup key={group} label={group}>
                {EXAMPLES.filter((ex) => ex.group === group).map((ex) => (
                  <option key={`${ex.group}/${ex.name}`} value={`${ex.group}/${ex.name}`}>
                    {ex.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            onClick={() => stepExample(1)}
            className={btn}
            title="Next example"
            aria-label="Next example"
          >
            ›
          </button>
        </div>

        <div className="flex-1" />

        <button onClick={cycleTheme} className={btn} title="Cycle theme">
          {THEME_LABEL[theme]}
        </button>
        <button
          onClick={() => views.length && setPresenting(true)}
          disabled={!views.length}
          className={`${btn} disabled:opacity-40`}
          title="⌘⏎ — full-screen the views as a deck; arrows to step, click a card to zoom in"
        >
          Present
        </button>
        <button onClick={() => setPaletteOpen(true)} className={btn} title="⌘K — search pack icons, insert at cursor">
          Icons
        </button>
        <button onClick={share} className={btn} title="Copy a link — the source travels in the URL fragment">
          Share
        </button>
        <ExportMenu
          onSvg={download}
          onPng={downloadPng}
          onAdaptive={adaptiveBase ? downloadAdaptive : undefined}
          onHtml={downloadHtml}
          busy={exporting}
        />
      </header>

      <main className="flex min-h-0 flex-1">
        {editorOpen && (
          <section className="flex w-[42%] min-w-[320px] max-w-[640px] flex-col border-r border-[var(--line)] bg-[var(--surface)]">
            <div className="flex-1 overflow-hidden">
              <Editor value={source} diagnostics={preview.diagnostics} onChange={setSource} apiRef={editorApi} />
            </div>
            <Diagnostics errors={errors} warnings={warnings} />
          </section>
        )}

        <Stage
          svg={shown}
          stale={!preview.ok}
          animate={!reduced}
          intent={intent}
          fit={fit}
          zoom={zoom}
          onPick={onPick}
          onBlank={upView ? () => navigate(upView) : undefined}
        >
          <button
            onClick={() => setEditorOpen((o) => !o)}
            className="absolute left-3 top-3 z-10 rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--fg)]"
            title="⌘\"
          >
            {editorOpen ? "Hide editor" : "Show editor"}
          </button>
          {/* The views belong to the diagram, not to the app: they are its
              altitudes, and switching one is a move within the picture rather
              than a global mode. Top-centre keeps them clear of the editor
              toggle and breadcrumb on the left and the zoom control bottom
              right, and they inherit the same surface the other canvas
              overlays use so they read over any theme. */}
          {views.length > 1 && (
            <nav className="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-7rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded border border-[var(--line)] bg-[var(--surface)] p-0.5">
              {views.map((v) => (
                <button
                  key={v.name}
                  onClick={() => navigate(v.name)}
                  title={v.title}
                  // nowrap: a hyphenated name (`orders-pci`) breaks across two
                  // lines otherwise and the whole bar goes ragged
                  className={`whitespace-nowrap rounded px-2 py-1 text-[12px] transition-colors ${
                    v.name === activeView
                      ? "bg-[var(--chip)] text-[var(--fg)]"
                      : "text-[var(--muted)] hover:text-[var(--fg)]"
                  }`}
                >
                  {v.name}
                </button>
              ))}
            </nav>
          )}
          {crumbs.length > 1 && (
            <nav className="absolute left-3 top-12 z-10 flex items-center gap-1 text-[11px] text-[var(--muted)]">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="opacity-50">›</span>}
                  <button
                    disabled={!c.view || c.view === activeView}
                    onClick={() => c.view && navigate(c.view)}
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
          <div className="absolute bottom-3 left-3 z-10 text-[11px] text-[var(--muted)]">
            nothing you draw ever leaves your browser
          </div>
        </Stage>
      </main>
      <IconPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={(ref) => editorApi.current?.insert(ref)}
        onCredits={() => { setPaletteOpen(false); setCreditsOpen(true); }}
      />
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </div>
  );
}

const btn =
  "rounded border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-[var(--muted)] transition-colors hover:text-[var(--fg)] hover:border-[var(--line-strong)]";

/** One Export button over both formats. They are the same intent — get the
 *  picture out — and two of the header's six buttons was a lot of chrome to
 *  spend saying so. ⌘S still goes straight to SVG without opening anything.
 *
 *  Dismiss is bound on pointerdown rather than click so the menu is already
 *  gone by the time a click lands on whatever is underneath it. */
function ExportMenu({
  onSvg,
  onPng,
  onAdaptive,
  onHtml,
  busy,
}: {
  onSvg: () => void;
  onPng: () => void;
  /** absent when the current theme is in no adaptive pair */
  onAdaptive?: () => void;
  onHtml: () => void;
  /** the interactive export renders every view × palette, which takes a beat */
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc);
    };
  }, [open]);

  const item =
    "block w-full px-3 py-1.5 text-left text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]";

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={btn}
        title="Save the diagram — ⌘S for SVG"
      >
        Export ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded border border-[var(--line)] bg-[var(--chrome)] py-1 shadow-xl"
        >
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onSvg();
            }}
          >
            SVG <span className="text-[var(--muted)] opacity-60">⌘S</span>
          </button>
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onPng();
            }}
          >
            PNG <span className="text-[var(--muted)] opacity-60">2×</span>
          </button>
          <button
            role="menuitem"
            disabled={!onAdaptive}
            title={
              onAdaptive
                ? "One file carrying both palettes — for embedding where you don't pick the background"
                : "Contrast has no dark counterpart to pair with"
            }
            className={`${item} disabled:opacity-40 disabled:hover:bg-transparent`}
            onClick={() => {
              setOpen(false);
              onAdaptive?.();
            }}
          >
            SVG <span className="text-[var(--muted)] opacity-60">light + dark</span>
          </button>
          <button
            role="menuitem"
            disabled={busy}
            title="One self-contained file with every view and the zoom between them — no server, no build"
            className={`${item} disabled:opacity-40 disabled:hover:bg-transparent`}
            onClick={() => {
              setOpen(false);
              onHtml();
            }}
          >
            {busy ? "Building…" : (
              <>Interactive <span className="text-[var(--muted)] opacity-60">HTML</span></>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

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
