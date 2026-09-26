// The viewer that ships inside an exported diagram.
//
// This is the one place in the project where we ship JavaScript to a reader.
// It is a *sibling* of the SVGs, never inside one: every embedded SVG in the
// document is byte-comparable to `squinch render -o x.svg`, and the entry view
// is inline in the markup, so a reader whose browser (or wiki sanitizer) drops
// this script still sees a correct static diagram. That is the whole shape of
// the exception recorded in CLAUDE.md.
//
// It imports `../../view/dive.js` and `../../view/navigate.js` directly and is
// bundled by `scripts/gen-html-runtime.ts`, which is what makes "the export
// performs the same motion as the playground" a fact about the build rather
// than a comment nobody can check.
import { diveTransforms, type Box } from "../../view/dive.js";
import { hop, upView, viewBar, viewForPath, type BarItem, type NavView } from "../../view/navigate.js";
import { KEY_PAN, ZOOM_STEP, cameraKey, type CamPad } from "../../view/camera.js";
import { attachCamera } from "../../view/camera-dom.js";

interface Payload {
  views: NavView[];
  entry: string;
  themes: string[];
  /** view name → hops that render at that altitude, for views with a flow */
  flows: Record<string, number>;
}

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;

/** Air around a fitted diagram. Presenting floats the header — view bar and
 *  all — over the canvas, so it keeps the picture clear of it. */
const PAD: CamPad = 16;
const PRESENT_PAD: CamPad = { top: 52, right: 24, bottom: 24, left: 24 };

function boot() {
  const data: Payload = JSON.parse($("#sq-data").textContent || "{}");
  const live = $<HTMLElement>("#sq-live");
  const ghost = $<HTMLElement>("#sq-ghost");
  const stage = $<HTMLElement>("#sq-stage");
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  let view = data.entry;
  let theme = data.themes[0];
  let step = 0;
  let presenting = false;
  // The reader's own preference wins over the author's, when the file carries
  // a palette that matches it — the same rule an adaptive SVG follows. Both
  // directions: a light-mode reader of a dark-entry file gets light, not just
  // the reverse (the entry is dark by default now, so one-way promotion would
  // have made the system setting a no-op for half of readers).
  if (data.themes.length > 1) {
    const wantDark = matchMedia("(prefers-color-scheme: dark)").matches;
    const match = data.themes.find((t) => t.includes("dark") === wantDark);
    if (match) theme = match;
  }

  // The entry view is inline rather than in a <template>, so that a reader
  // whose browser never runs this script still sees a diagram. That means it is
  // the one body with no template to clone from — captured here at boot, before
  // anything can replace it, or switching *back* to the entry palette would
  // silently find nothing.
  const inlineKey = `${data.entry}|${data.themes[0]}`;
  const inlineBody = live.firstElementChild?.cloneNode(true) ?? null;
  /** `step` 0 is the whole flow at once — the authoring frame, and what a view
   *  without a flow always shows. 1..N are the walked ones. */
  const bodyFor = (v: string, th: string, step = 0): Node | null => {
    const key = step ? `${v}|${th}|${step}` : `${v}|${th}`;
    if (key === inlineKey) return inlineBody?.cloneNode(true) ?? null;
    const tpl = document.querySelector<HTMLTemplateElement>(`template[data-key="${CSS.escape(key)}"]`);
    return tpl ? tpl.content.cloneNode(true) : null;
  };
  const scopeOf = (v: string) => data.views.find((x) => x.name === v)?.scope;

  // The camera: pan and zoom, on the wrapper that holds both dive layers. It is
  // attached before any click listener below, because its capture-phase click
  // suppressor (the click that ends a drag is not a click) has to run first on
  // the element they share. `sq-pz` is what tells the stylesheet there is a
  // camera at all — without this script the stage keeps its static layout.
  const fitBtn = document.querySelector<HTMLButtonElement>("#sq-fit");
  const cam = attachCamera(stage, $<HTMLElement>("#sq-cam"), {
    pad: PAD,
    onChange: (c) => { if (fitBtn) fitBtn.textContent = `${Math.round(c.k * 100)}%`; },
  });
  document.documentElement.classList.add("sq-pz");
  /** The renderer always writes unitless px `width`/`height` on the root. */
  const sizeOf = () => {
    const s = live.querySelector("svg");
    return { w: Number(s?.getAttribute("width")) || 0, h: Number(s?.getAttribute("height")) || 0 };
  };
  /** A new body is in: tell the camera its size. It refits if the reader had
   *  not moved it, and otherwise leaves the picture where they put it — which
   *  is what a palette switch or a flow step (same view, same size) wants. */
  const framed = () => { const s = sizeOf(); cam.setContentSize(s.w, s.h); return s; };

  function paintChrome() {
    document.title = data.views.find((v) => v.name === view)?.title ?? document.title;

    paintNav();
    // Mark the cards that actually lead somewhere. Only the runtime can know:
    // it depends on which views this file carries and which one you are in.
    // Without it every card wore a zoom cursor and the ones with no view were
    // a dead click — the bug this whole pass came from.
    for (const el of live.querySelectorAll("[data-path]")) {
      const p = el.getAttribute("data-path");
      el.classList.toggle("sq-zoom", !!(p && viewForPath(data.views, view, p)));
    }

    const counter = document.querySelector<HTMLElement>("#sq-step");
    const hops = data.flows[view] ?? 0;
    if (counter) counter.textContent = presenting && hops ? `${step || 1} / ${hops}` : "";
  }

  // ── the view bar ──────────────────────────────────────────────────────────
  // Home, the path to where you stand with a menu of the views beside each
  // hop, and the flows. What goes in each hop is `viewBar` — the function the
  // playground draws from — so this is only the DOM spelling of it. Built with
  // properties, never markup attributes: the file carries no inline handlers.
  let openHop: string | undefined;
  let navHidden = false;
  let navView = "";
  const nav = document.querySelector<HTMLElement>("#sq-nav");
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const btn = (cls: string, text = "") => {
    const b = mk("button", cls, text);
    b.type = "button";
    return b;
  };
  const setNavHidden = (h: boolean) => {
    navHidden = h;
    openHop = undefined;
    document.body.classList.toggle("sq-navhidden", h);
    if (!h) paintNav();
  };
  const closeMenu = (refocus: boolean) => {
    const key = openHop;
    openHop = undefined;
    paintNav();
    if (refocus && key) nav?.querySelector<HTMLElement>(`[data-hop="${CSS.escape(key)}"]`)?.focus();
  };

  function hopEl(key: string, label: string, state: string, items: BarItem[], extra = "", count = "") {
    const wrap = mk("span", `sq-hop${extra ? ` ${extra}` : ""}`);
    if (!items.length) {
      wrap.append(mk("span", `sq-seg ${state}`, label));
      return wrap;
    }
    const b = btn(`sq-seg ${state}`);
    b.dataset.hop = key;
    b.append(mk("span", "sq-l", label));
    if (count) b.append(mk("span", "sq-count", count));
    wrap.append(b);
    if (items.length === 1) {
      if (items[0].active) b.setAttribute("aria-current", "page");
      b.onclick = () => go(items[0].view);
      return wrap;
    }
    b.append(mk("span", "sq-caret", "\u25BE"));
    b.setAttribute("aria-haspopup", "menu");
    b.setAttribute("aria-expanded", String(openHop === key));
    if (state === "current") b.setAttribute("aria-current", "page");
    b.onclick = () => {
      openHop = openHop === key ? undefined : key;
      paintNav();
      const m = nav?.querySelector<HTMLElement>(".sq-menu");
      // kept on screen: a hop near the edge would run its menu off it
      if (m) {
        const r = m.getBoundingClientRect();
        const over = r.right - (document.documentElement.clientWidth - 8);
        if (over > 0) m.style.transform = `translateX(${-Math.min(over, Math.max(0, r.left - 8))}px)`;
      }
      (m?.querySelector<HTMLElement>("[aria-checked=true]") ?? m?.querySelector<HTMLElement>("button"))?.focus();
    };
    if (openHop !== key) return wrap;
    const menu = mk("div", "sq-menu");
    menu.setAttribute("role", "menu");
    for (const it of items) {
      const r = btn("");
      r.setAttribute("role", "menuitemradio");
      r.setAttribute("aria-checked", String(it.active));
      r.title = it.view;
      r.dataset.label = it.label.toLowerCase();
      r.append(mk("span", "sq-l", it.label));
      if (it.auto) r.append(mk("span", "sq-auto", "auto"));
      if (it.lenses) r.append(mk("span", "sq-n", `+${it.lenses} ${it.lenses === 1 ? "lens" : "lenses"}`));
      r.append(mk("span", "sq-ck", it.active ? "\u2713" : ""));
      r.onclick = () => { openHop = undefined; if (it.active) paintNav(); else go(it.view); };
      menu.append(r);
    }
    // arrows move, a letter jumps; none of it reaches the deck's own keys
    menu.onkeydown = (e) => {
      wake();
      const rows = [...menu.querySelectorAll<HTMLElement>("button")];
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const to = (i: number) => rows[(i + rows.length) % rows.length]?.focus();
      if (e.key === "ArrowDown") to(at + 1);
      else if (e.key === "ArrowUp") to(at - 1);
      else if (e.key === "Home") to(0);
      else if (e.key === "End") to(rows.length - 1);
      else if (e.key.length === 1 && /\S/.test(e.key)) {
        const k = e.key.toLowerCase();
        [...rows.slice(at + 1), ...rows.slice(0, at + 1)].find((r) => r.dataset.label?.startsWith(k))?.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    wrap.append(menu);
    return wrap;
  }

  function paintNav() {
    if (!nav) return;
    // a view change closes whatever menu led there
    if (navView !== view) { navView = view; openHop = undefined; }
    const bar = viewBar(data.views, view);
    nav.dataset.view = view; // where you are, for a test or a stylesheet to read
    const path = mk("div", "sq-path");
    const home = btn("sq-home", "\u2302");
    home.setAttribute("aria-label", bar.home ?? "home");
    home.title = `Home \u2014 ${bar.home ?? ""}`;
    if (bar.atHome) home.setAttribute("aria-current", "page");
    home.onclick = () => bar.home && go(bar.home);
    path.append(home);
    if (bar.segments.length) path.append(mk("span", "sq-div"));
    const nearest = bar.segments.map((s) => s.state).lastIndexOf("link");
    bar.segments.forEach((s, i) => {
      const hop = hopEl(s.key, s.label, s.state, s.items);
      // folding classes, and a trailing separator so a folded hop takes its own
      if (s.state === "link") hop.classList.add(i === nearest ? "sq-near" : "sq-outer");
      if (i < bar.segments.length - 1) hop.append(mk("span", "sq-sep", "/"));
      path.append(hop);
    });
    nav.replaceChildren(path);
    if (bar.flows.length) {
      const f = bar.activeFlow;
      const hops = data.flows[view] ?? 0;
      // one flow is a link to it, named — a menu of one is a click for nothing
      const only = bar.flows.length === 1 ? bar.flows[0] : undefined;
      const count = f ? (presenting && hops ? `${step || 1}/${hops}` : "") : only ? "" : String(bar.flows.length);
      const label = f ? f.label : only ? only.label : "Flows";
      const flows = hopEl("#flows", label, f ? "current" : "link", bar.flows, "sq-flows", count);
      // a text glyph, so the pill still says what it is once its label folds
      const pill = flows.querySelector<HTMLElement>(".sq-seg");
      if (pill) { pill.prepend(mk("span", "sq-fg", "\u219D")); pill.title = label; }
      nav.append(flows);
    }
    const hide = btn("", "\u2303");
    hide.id = "sq-hide";
    hide.setAttribute("aria-label", "Hide the view bar");
    hide.title = "Hide (b)";
    hide.onclick = () => setNavHidden(true);
    nav.append(hide);
    fold();
  }

  /** Short of room the bar gives way in steps, never by overlapping — the
   *  playground's levels (ViewBar.tsx): truncate, fold the outer ancestors,
   *  drop the flows label, fold the nearest ancestor, truncate hard. Measured
   *  with no menu open, since an open one counts toward the width. */
  function fold() {
    if (!nav || openHop) return;
    for (let l = 0; l <= 5; l++) {
      nav.className = Array.from({ length: l }, (_, i) => `sq-f${i + 1}`).join(" ");
      if (nav.scrollWidth <= nav.clientWidth + 0.5) return;
    }
  }
  addEventListener("resize", fold);

  // what is left of the bar while it is put away
  const handle = btn("");
  handle.id = "sq-handle";
  handle.setAttribute("aria-label", "Show the view bar");
  handle.title = "Show the view bar (b)";
  handle.onclick = handle.onpointerenter = () => setNavHidden(false);
  if (nav) document.body.append(handle);

  // one menu at a time, gone on the press — before the click lands underneath
  addEventListener("pointerdown", (e) => {
    if (openHop && !(e.target as Element).closest?.(".sq-menu,[aria-expanded=true]")) closeMenu(false);
  });

  /** Finish the dive in flight, if there is one. Everything `go` measures has
   *  to be at rest, and a second click mid-dive used to measure a moving layer. */
  let settleNow = () => {};

  /** Swap the body, then animate the two layers about the card they share.
   *  The playground splits this in two ("arm, then fire") because compiling the
   *  next view is async; here every body is already in the document, so the
   *  swap is synchronous and the whole dance is one function. */
  function go(target: string, enterAtEnd = false) {
    if (!target || target === view) return;
    settleNow();
    // A slide opens on its first hop — unless you reversed into it, in which
    // case you arrive where you left and can keep unwinding.
    const want = presenting && data.flows[target] ? (enterAtEnd ? data.flows[target] : 1) : 0;
    const next = bodyFor(target, theme, want);
    if (!next) return;
    step = want;
    const { dir, anchor: anchorPath } = hop(data.views, view, target);
    const prev = live.firstElementChild;
    const find = (root: Element) =>
      anchorPath ? root.querySelector(`[data-path="${CSS.escape(anchorPath)}"]`) : null;

    // What the reader is looking at, in screen space, before anything moves —
    // however they had panned or zoomed it. Going down, the shared card is in
    // this layer; coming up it is in the one about to arrive.
    const oldRect = cam.screenBox(live);
    const oldCard = dir === "in" ? find(live) : null;
    const oldAnchor = oldCard ? cam.screenBox(oldCard) : undefined;

    // Every view arrives fitted. The camera is set for the NEW picture now,
    // synchronously, and then does not move for the whole dive: the dive is
    // computed in the camera's local space, where `diveTransforms` neither
    // knows nor cares that there is a camera (docs/notes/pan-zoom.md).
    live.replaceChildren(next);
    view = target;
    const size = framed();
    cam.fit();
    paintChrome();
    if (reduced() || !prev) return;

    cam.setBusy(true);
    // The old picture goes into the ghost at the box that puts it exactly where
    // it was on screen; its svg fills that box, so the first frame of the dive
    // is the last thing the reader saw. Moved, not cloned — the defs are
    // hoisted, so nothing in it is referenced by id from the live layer.
    const ghostBox = cam.toLocal(oldRect);
    ghost.replaceChildren(prev);
    ghost.style.cssText =
      `position:absolute;left:${ghostBox.x}px;top:${ghostBox.y}px;` +
      `width:${ghostBox.w}px;height:${ghostBox.h}px;z-index:1;pointer-events:none`;
    const liveBox: Box = { x: 0, y: 0, w: size.w, h: size.h };
    const newCard = dir === "in" ? null : find(live);
    let anchor = oldAnchor ? cam.toLocal(oldAnchor) : newCard ? cam.toLocal(cam.screenBox(newCard)) : undefined;
    // From deep zoom the old picture is already several screens wide, and the
    // dive would scale it up to 3.2x more with a filter on every card. Past
    // three viewports, cut instead — the anchorless crossfade lateral hops get.
    const port = cam.viewportBox();
    if (oldRect.w > port.w * 3 || oldRect.h > port.h * 3) anchor = undefined;
    const t = diveTransforms({ view: cam.toLocal(port), ghostBox, liveBox, anchor, dir });

    const g = ghost.style, l = live.style;
    g.transition = "none"; g.transformOrigin = t.gOrigin; g.transform = "none"; g.opacity = "1";
    l.transition = "none"; l.transformOrigin = t.lOrigin; l.transform = t.lStart; l.opacity = "0";
    void live.offsetHeight; // commit the start state before transitioning off it
    g.transition = `transform ${t.ms}ms ${t.ease}, opacity ${Math.round(t.ms * 0.55)}ms ${t.ease}`;
    l.transition =
      `transform ${t.ms}ms ${t.ease}, opacity ${Math.round(t.ms * 0.6)}ms ${t.ease} ${Math.round(t.ms * 0.25)}ms`;
    g.transform = t.gEnd; g.opacity = "0";
    l.transform = "none"; l.opacity = "1";
    // Clean up when the dive actually lands, not on a wall-clock guess. The
    // old timer fired t.ms after the *click*, but the transition cannot start
    // until the browser paints the swapped-in body — a heavy first layout of
    // a large view delayed that by hundreds of ms, the timer stripped the
    // transition mid-flight, and the diagram visibly snapped into place a
    // beat after the zoom. Watch the observable fact instead of an event:
    // live's computed transform reads as interpolated matrices while the
    // transition runs and becomes the literal "none" only when it has truly
    // finished — one cheap read per frame for under half a second, immune to
    // the transitionend quirks headless engines showed when this was
    // event-driven. The timer is only a net for a hidden tab, where rAF
    // stops; by then the motion is long over and cleanup is invisible.
    let settled = false;
    let raf = 0;
    const settle = () => {
      if (settled) return;
      settled = true;
      settleNow = () => {};
      cancelAnimationFrame(raf);
      clearTimeout(net);
      ghost.replaceChildren();
      ghost.removeAttribute("style");
      live.removeAttribute("style");
      cam.setBusy(false);
      // the window may have been resized (or gone fullscreen) mid-dive, while
      // the camera was holding still for it
      if (cam.atFit()) cam.fit();
    };
    const watch = () => {
      if (getComputedStyle(live).transform === "none") settle();
      else raf = requestAnimationFrame(watch);
    };
    settleNow = settle;
    raf = requestAnimationFrame(watch);
    const net = setTimeout(settle, t.ms + 1000);
  }

  function setTheme(name: string) {
    const body = name === theme ? null : bodyFor(view, name, step);
    if (!body) return;
    theme = name;
    document.documentElement.dataset.theme = name;
    live.replaceChildren(body);
    framed();
  }

  /** Walking a flow and walking the deck are one axis: keep stepping hops
   *  until the story runs out, then move to the next view. The playground
   *  merges them the same way, and for the same reason — one arrow key tells
   *  the whole story rather than two that each tell half. */
  function step_(by: 1 | -1) {
    const hops = data.flows[view] ?? 0;
    const next = step + by;
    if (hops && next >= 1 && next <= hops) {
      const body = bodyFor(view, theme, next);
      if (body) { step = next; live.replaceChildren(body); framed(); paintChrome(); }
      return;
    }
    const at = data.views.findIndex((v) => v.name === view);
    const to = data.views[at + by];
    if (to) go(to.name, by < 0);
  }

  // On the stage, not the live layer: the margin around the artwork is backdrop
  // too, and with a camera the artwork can be anywhere inside it.
  stage.addEventListener("click", (e) => {
    const el = (e.target as Element).closest?.("[data-path]");
    const path = el?.getAttribute("data-path");
    if (path) {
      const target = viewForPath(data.views, view, path);
      if (target) return go(target.name);
    }
    // clicking the canvas itself climbs, which is the gesture the playground
    // gives the backdrop
    if (!path) {
      const up = upView(data.views, view, scopeOf(view));
      if (up) go(up);
    }
  });

  const themeBtn = document.querySelector<HTMLButtonElement>("#sq-theme");
  if (themeBtn) themeBtn.onclick = () => setTheme(data.themes[(data.themes.indexOf(theme) + 1) % data.themes.length]);

  /** Full-bleed deck. The declared views in declaration order *are* the slides —
   *  nothing is authored twice (DESIGN §11). Fullscreen is requested on the
   *  gesture that turns it on, which is also the only time a browser allows it;
   *  the playground can ask on mount because entering is already a gesture
   *  there, but a file opens as a document. */
  function present(on: boolean) {
    if (on === presenting) return;
    presenting = on;
    document.body.classList.toggle("presenting", on);
    if (on) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      const hops = data.flows[view] ?? 0;
      if (hops && !step) {
        const body = bodyFor(view, theme, 1);
        if (body) { step = 1; live.replaceChildren(body); }
      }
    } else {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      if (step) {
        const body = bodyFor(view, theme, 0);
        if (body) { step = 0; live.replaceChildren(body); }
      }
    }
    // A slide fills the screen: contain, scaled UP — the one place a diagram is
    // drawn larger than life. Going fullscreen resizes the stage a moment later,
    // and a fitted camera refits itself on resize.
    cam.setFitOptions(on ? { upscale: true, pad: PRESENT_PAD } : { upscale: false, pad: PAD });
    framed();
    cam.fit();
    paintChrome();
  }

  // Chrome gets out of the way while nothing is happening, and comes back on
  // the first movement — a deck that keeps its furniture on screen is a
  // screenshot of an app, not a presentation.
  let idle: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    document.body.classList.remove("idle");
    clearTimeout(idle);
    if (presenting) idle = setTimeout(() => document.body.classList.add("idle"), 3500);
  };
  addEventListener("mousemove", wake);
  addEventListener("keydown", wake);

  const cycleTheme = () =>
    setTheme(data.themes[(data.themes.indexOf(theme) + 1) % data.themes.length]);

  addEventListener("keydown", (e) => {
    // The zoom keys, bare and ⌘/Ctrl — the same table the playground reads.
    const z = cameraKey(e);
    if (z) {
      e.preventDefault();
      if (z.act === "in") cam.zoomBy(ZOOM_STEP);
      else if (z.act === "out") cam.zoomBy(1 / ZOOM_STEP);
      else if (z.act === "fit") cam.fit(true);
      else cam.setScale(1);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // An open menu owns Escape; it closes the menu, not the presentation.
    if (e.key === "Escape" && openHop) { e.preventDefault(); return closeMenu(true); }
    // A focused button keeps its own activation keys. This handler used to
    // swallow Space and Enter and step the deck instead, which made every
    // button in the file — tabs, palette, Present — dead to the keyboard.
    const onButton = !!(e.target as Element | null)?.closest?.("button");
    if (onButton && (e.key === " " || e.key === "Enter")) return;
    // Shift+Arrow pans. Checked before the switch, which reads `e.key` and so
    // cannot tell a shifted arrow from a plain one.
    if (e.shiftKey && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const d = KEY_PAN;
      cam.panBy(e.key === "ArrowLeft" ? d : e.key === "ArrowRight" ? -d : 0,
                e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0);
      return;
    }
    switch (e.key) {
      case "ArrowRight": case "PageDown": case " ": case "Enter":
        e.preventDefault(); step_(1); break;
      case "ArrowLeft": case "PageUp":
        e.preventDefault(); step_(-1); break;
      // climbing an altitude is a *different* move from stepping the deck, and
      // gets its own keys
      case "ArrowUp": case "Backspace": {
        const up = upView(data.views, view, scopeOf(view));
        if (up) { e.preventDefault(); go(up); }
        break;
      }
      case "Home": {
        const home = viewBar(data.views, view).home;
        e.preventDefault();
        if (home) go(home);
        break;
      }
      case "End": e.preventDefault(); go(data.views[data.views.length - 1].name, true); break;
      case "Escape": if (presenting) { e.preventDefault(); present(false); } break;
      case "p": case "P": present(!presenting); break;
      case "f": case "F":
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
        break;
      case "t": case "T": if (data.themes.length > 1) cycleTheme(); break;
      case "b": case "B": if (presenting && nav) setNavHidden(!navHidden); break;
    }
  });
  // leaving fullscreen by the browser's own affordance should leave the deck
  addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && presenting) present(false);
  });

  const presentBtn = document.querySelector<HTMLButtonElement>("#sq-present");
  if (presentBtn) presentBtn.onclick = () => present(!presenting);

  const zin = document.querySelector<HTMLButtonElement>("#sq-zin");
  const zout = document.querySelector<HTMLButtonElement>("#sq-zout");
  if (zin) zin.onclick = () => cam.zoomBy(ZOOM_STEP);
  if (zout) zout.onclick = () => cam.zoomBy(1 / ZOOM_STEP);
  if (fitBtn) fitBtn.onclick = () => cam.fit(true);

  // A deep link opens on that view — what makes the file shareable by more than
  // its filename. Kept in sync so the reader's back button and a copied URL
  // both do what they look like they do.
  const fromHash = () => {
    const want = decodeURIComponent(location.hash.slice(1));
    if (want && want !== view && data.views.some((v) => v.name === want)) go(want);
  };
  addEventListener("hashchange", fromHash);

  document.documentElement.dataset.theme = theme;
  if (theme !== data.themes[0]) {
    const body = bodyFor(view, theme);
    if (body) live.replaceChildren(body);
  }
  framed();
  cam.fit();
  paintChrome();
  fromHash();
}

if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
else boot();
