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
import { crumbs, hop, upView, viewForPath, type NavView } from "../../view/navigate.js";

interface Payload {
  views: NavView[];
  entry: string;
  themes: string[];
  /** view name → hops that render at that altitude, for views with a flow */
  flows: Record<string, number>;
}

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;

function boot() {
  const data: Payload = JSON.parse($("#sq-data").textContent || "{}");
  const live = $<HTMLElement>("#sq-live");
  const ghost = $<HTMLElement>("#sq-ghost");
  const trail = $<HTMLElement>("#sq-crumbs");
  const stage = $<HTMLElement>("#sq-stage");
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  let view = data.entry;
  let theme = data.themes[0];
  let step = 0;
  let presenting = false;
  // The reader's own preference wins over the author's, when the file carries
  // a palette that matches it — the same rule an adaptive SVG follows.
  if (data.themes.length > 1 && matchMedia("(prefers-color-scheme: dark)").matches) {
    const dark = data.themes.find((t) => t.includes("dark"));
    if (dark) theme = dark;
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
  const boxOf = (el: Element): Box => {
    const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
  };

  function paintChrome() {
    trail.replaceChildren();
    const trailItems = crumbs(data.views, scopeOf(view));
    trailItems.forEach((c, i) => {
      if (i) trail.append(Object.assign(document.createElement("span"), { className: "sep", textContent: "›" }));
      if (c.view && c.view !== view) {
        const a = document.createElement("button");
        a.type = "button";
        a.textContent = c.label;
        a.onclick = () => go(c.view!);
        trail.append(a);
      } else {
        trail.append(Object.assign(document.createElement("span"), { textContent: c.label }));
      }
    });
    document.title = data.views.find((v) => v.name === view)?.title ?? document.title;

    const dots = document.querySelector<HTMLElement>("#sq-dots");
    if (dots) {
      dots.replaceChildren();
      for (const v of data.views) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = v.name === view ? "on" : "";
        // a real label, not a decorative dot: this is the deck's only
        // random-access control and it has to be reachable by name
        b.setAttribute("aria-label", v.title ?? v.name);
        b.title = v.title ?? v.name;
        b.onclick = () => go(v.name);
        dots.append(b);
      }
    }
    const counter = document.querySelector<HTMLElement>("#sq-step");
    const hops = data.flows[view] ?? 0;
    if (counter) counter.textContent = presenting && hops ? `${step || 1} / ${hops}` : "";
  }

  /** Swap the body, then animate the two layers about the card they share.
   *  The playground splits this in two ("arm, then fire") because compiling the
   *  next view is async; here every body is already in the document, so the
   *  swap is synchronous and the whole dance is one function. */
  function go(target: string, enterAtEnd = false) {
    if (!target || target === view) return;
    // A slide opens on its first hop — unless you reversed into it, in which
    // case you arrive where you left and can keep unwinding.
    const want = presenting && data.flows[target] ? (enterAtEnd ? data.flows[target] : 1) : 0;
    const next = bodyFor(target, theme, want);
    if (!next) return;
    step = want;
    const { dir, anchor: anchorPath } = hop(data.views, view, target);
    const ghostBox = boxOf(live);
    const prev = live.firstElementChild;

    if (reduced() || !prev) {
      live.replaceChildren(next);
      view = target;
      paintChrome();
      return;
    }

    ghost.replaceChildren(prev.cloneNode(true));
    ghost.style.cssText =
      `position:absolute;left:${ghostBox.x}px;top:${ghostBox.y}px;` +
      `width:${ghostBox.w}px;height:${ghostBox.h}px;z-index:1;pointer-events:none`;
    live.replaceChildren(next);
    view = target;
    paintChrome();

    const liveBox = boxOf(live);
    // Going down, the shared card is in the layer we just left; coming up it is
    // in the one that just arrived. Both layers are on screen either way, which
    // is why one lookup covers both.
    const from = dir === "in" ? ghost : live;
    const el = anchorPath ? from.querySelector(`[data-path="${CSS.escape(anchorPath)}"]`) : null;
    const t = diveTransforms({
      view: { x: 0, y: 0, w: stage.clientWidth, h: stage.clientHeight },
      ghostBox, liveBox, anchor: el ? boxOf(el) : undefined, dir,
    });

    const g = ghost.style, l = live.style;
    g.transition = "none"; g.transformOrigin = t.gOrigin; g.transform = "none"; g.opacity = "1";
    l.transition = "none"; l.transformOrigin = t.lOrigin; l.transform = t.lStart; l.opacity = "0";
    void live.offsetHeight; // commit the start state before transitioning off it
    g.transition = `transform ${t.ms}ms ${t.ease}, opacity ${Math.round(t.ms * 0.55)}ms ${t.ease}`;
    l.transition =
      `transform ${t.ms}ms ${t.ease}, opacity ${Math.round(t.ms * 0.6)}ms ${t.ease} ${Math.round(t.ms * 0.25)}ms`;
    g.transform = t.gEnd; g.opacity = "0";
    l.transform = "none"; l.opacity = "1";
    setTimeout(() => {
      ghost.replaceChildren();
      ghost.removeAttribute("style");
      live.removeAttribute("style");
    }, t.ms + 40);
  }

  function setTheme(name: string) {
    const body = name === theme ? null : bodyFor(view, name, step);
    if (!body) return;
    theme = name;
    document.documentElement.dataset.theme = name;
    live.replaceChildren(body);
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
      if (body) { step = next; live.replaceChildren(body); paintChrome(); }
      return;
    }
    const at = data.views.findIndex((v) => v.name === view);
    const to = data.views[at + by];
    if (to) go(to.name, by < 0);
  }

  live.addEventListener("click", (e) => {
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
    if (e.metaKey || e.ctrlKey || e.altKey) return;
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
  paintChrome();
  fromHash();
}

if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
else boot();
