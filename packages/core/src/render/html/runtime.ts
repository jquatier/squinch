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
  const bodyFor = (v: string, th: string): Node | null => {
    const key = `${v}|${th}`;
    if (key === inlineKey) return inlineBody?.cloneNode(true) ?? null;
    const tpl = document.querySelector<HTMLTemplateElement>(`template[data-key="${CSS.escape(key)}"]`);
    return tpl ? tpl.content.cloneNode(true) : null;
  };
  const scopeOf = (v: string) => data.views.find((x) => x.name === v)?.scope;
  const boxOf = (el: Element): Box => {
    const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
  };

  function paintCrumbs() {
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
  }

  /** Swap the body, then animate the two layers about the card they share.
   *  The playground splits this in two ("arm, then fire") because compiling the
   *  next view is async; here every body is already in the document, so the
   *  swap is synchronous and the whole dance is one function. */
  function go(target: string) {
    if (!target || target === view) return;
    const next = bodyFor(target, theme);
    if (!next) return;
    const { dir, anchor: anchorPath } = hop(data.views, view, target);
    const ghostBox = boxOf(live);
    const prev = live.firstElementChild;

    if (reduced() || !prev) {
      live.replaceChildren(next);
      view = target;
      paintCrumbs();
      return;
    }

    ghost.replaceChildren(prev.cloneNode(true));
    ghost.style.cssText =
      `position:absolute;left:${ghostBox.x}px;top:${ghostBox.y}px;` +
      `width:${ghostBox.w}px;height:${ghostBox.h}px;z-index:1;pointer-events:none`;
    live.replaceChildren(next);
    view = target;
    paintCrumbs();

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
    const body = name === theme ? null : bodyFor(view, name);
    if (!body) return;
    theme = name;
    document.documentElement.dataset.theme = name;
    live.replaceChildren(body);
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
  if (themeBtn)
    themeBtn.onclick = () => setTheme(data.themes[(data.themes.indexOf(theme) + 1) % data.themes.length]);

  addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Backspace" || e.key === "ArrowUp") {
      const up = upView(data.views, view, scopeOf(view));
      if (up) { e.preventDefault(); go(up); }
    } else if (e.key === "t" && data.themes.length > 1) {
      setTheme(data.themes[(data.themes.indexOf(theme) + 1) % data.themes.length]);
    }
  });

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
  paintCrumbs();
  fromHash();
}

if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
else boot();
