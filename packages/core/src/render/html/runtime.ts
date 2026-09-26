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
import { hop, upView, viewForPath, type NavView } from "../../view/navigate.js";
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

/** Air around a fitted diagram. Presenting floats the bar and the tabs over
 *  the canvas, so it keeps the picture clear of both. */
const PAD: CamPad = 16;
const PRESENT_PAD: CamPad = { top: 44, right: 24, bottom: 52, left: 24 };

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

    // The view tabs are the deck's one navigation surface — every view by
    // name, the active one on a plate, exactly the SPA's picker. They replaced
    // both the breadcrumb and the dots: the tabs already name where you are
    // and where you can go, so two more spellings of the same facts were
    // chrome without capability.
    const tabs = document.querySelector<HTMLElement>("#sq-tabs");
    if (tabs) {
      tabs.replaceChildren();
      for (const v of data.views) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = v.name === view ? "on" : "";
        b.textContent = v.name;
        b.title = v.title ?? v.name;
        b.onclick = () => go(v.name);
        tabs.append(b);
      }
      // keep the active tab reachable when the deck outgrows the bar
      tabs.querySelector(".on")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
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
      case "Home": e.preventDefault(); go(data.views[0].name); break;
      case "End": e.preventDefault(); go(data.views[data.views.length - 1].name, true); break;
      case "Escape": if (presenting) { e.preventDefault(); present(false); } break;
      case "p": case "P": present(!presenting); break;
      case "f": case "F":
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
        break;
      case "t": case "T": if (data.themes.length > 1) cycleTheme(); break;
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
