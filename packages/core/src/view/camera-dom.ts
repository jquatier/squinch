// The camera, attached to a page.
//
// `camera.ts` decides where the picture goes; this listens to the reader and
// writes it down — pointers, wheels, Safari's gesture events, a resize observer,
// one `transform` on one element. Framework-free on purpose: the interactive
// HTML export bundles it into its one viewer script, and the playground calls
// the same function from a React effect, so "the export moves exactly like the
// playground" is a fact about the build rather than a comment (the same bargain
// `dive.ts` strikes for the dive). docs/notes/pan-zoom.md has the reasoning.
//
// UNSTABLE: exported from `@squinch/core/browser` for the playground. It is not
// part of the engine's API and will change shape without a major version.
//
// The DOM is touched only inside `attachCamera`, never at module scope — this
// file is compiled into a package that Node also imports.
import { type Box } from "./dive.js";
import {
  type Camera, type CamLimits, type CamPad, type CamSize,
  DRAG_PX, IDENTITY, TWEEN_MS,
  clampCamera, fitCamera, lerpCamera, normalizeWheel, panBy as panCam, pinchStep, sameCamera,
  toLocal as camToLocal, toScreen as camToScreen, wheelPan, wheelZoomFactor, zoomAt, zoomLimits,
} from "./camera.js";

export interface CameraOpts {
  pad?: CamPad;
  upscale?: boolean;
  /** Every time the transform is written. Keep it cheap: it runs per frame. */
  onChange?: (cam: Camera, atFit: boolean) => void;
}

export interface CameraHandle {
  /** Frame the content. Not animated by default — and then it is synchronous,
   *  because the dive measures straight after. */
  fit(animate?: boolean): void;
  /** About the viewport's centre: the buttons and the keys. */
  zoomBy(factor: number, animate?: boolean): void;
  setScale(k: number, animate?: boolean): void;
  panBy(dx: number, dy: number): void;
  /** The content's natural size changed (a new SVG). Refits if the reader had
   *  not moved the camera; otherwise leaves it where they put it. */
  setContentSize(w: number, h: number): void;
  setFitOptions(o: { pad?: CamPad; upscale?: boolean }): void;
  /** A dive is in flight: ignore input. macOS keeps sending inertial wheel
   *  events for a second after a flick, and they would pan the view that just
   *  arrived fitted. */
  setBusy(busy: boolean): void;
  toLocal(b: Box): Box;
  toScreen(b: Box): Box;
  /** An element's box in screen space — px from the viewport's top-left. */
  screenBox(el: Element): Box;
  viewportBox(): Box;
  state(): Camera;
  atFit(): boolean;
  destroy(): void;
}

/** WebKit's trackpad pinch. Not in lib.dom: it never left Safari. */
interface GestureEvent extends UIEvent { scale: number; clientX: number; clientY: number }

export function attachCamera(viewport: HTMLElement, cameraEl: HTMLElement, opts: CameraOpts = {}): CameraHandle {
  let cam: Camera = { ...IDENTITY };
  let content: CamSize = { w: 0, h: 0 };
  let fitOpts = { pad: opts.pad, upscale: opts.upscale };
  let fitted = true;
  let busy = false;
  let frame = 0, tween = 0;
  /** Where the running tween lands. A second + pressed mid-tween steps from
   *  here, not from the frame on screen — else a double press, or a held key's
   *  repeat, loses most of every step after the first. */
  let goal: Camera | null = null;
  let size: CamSize = { w: viewport.clientWidth, h: viewport.clientHeight };

  const limits = (): CamLimits => zoomLimits(content, size, fitOpts);
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const origin = () => { const r = viewport.getBoundingClientRect(); return { x: r.left + viewport.clientLeft, y: r.top + viewport.clientTop }; };

  const write = () => {
    frame = 0;
    cameraEl.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
    opts.onChange?.(cam, fitted);
  };
  const soon = () => { if (!frame) frame = requestAnimationFrame(write); };
  /** Programmatic, non-animated sets land NOW and beat anything queued: a stale
   *  tween frame must never overwrite a fit the dive has already measured. */
  const now = () => { halt(); write(); };
  /** A gesture interrupts a tween — and nothing else. It must never cancel a
   *  pending paint: a wheel event that changes nothing (zoom already at its
   *  cap) schedules no paint of its own, so cancelling the last one left the
   *  screen a frame behind the camera until something else moved it. */
  const stopTween = () => { if (tween) cancelAnimationFrame(tween); tween = 0; goal = null; };
  const halt = () => {
    stopTween();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const moveTo = (next: Camera) => {
    const c = clampCamera(next, content, size);
    if (sameCamera(c, cam, 1e-6)) return;
    cam = c;
    fitted = false;
    soon();
  };

  const animateTo = (target: Camera, isFit: boolean) => {
    halt();
    fitted = isFit;
    if (reduced()) { cam = target; write(); return; }
    const from = cam, t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / TWEEN_MS);
      cam = p < 1 ? lerpCamera(from, target, p, size) : target;
      write();
      tween = p < 1 ? requestAnimationFrame(step) : 0;
      if (!tween) goal = null;
    };
    tween = requestAnimationFrame(step);
    goal = target;
  };

  // ── pointers: drag to pan, two to pinch ──────────────────────────────────
  // A press is only *recorded*. Capturing here would retarget the click to the
  // viewport and break every `closest("[data-path]")` the hosts rely on, so the
  // pointer is captured only once the press has become a drag.
  type P = { x: number; y: number; sx: number; sy: number };
  const pointers = new Map<number, P>();
  let dragging = false;
  let swallow = false; // the click that ends a drag or a pinch is not a click

  const grab = (id: number) => { try { viewport.setPointerCapture(id); } catch { /* synthetic or already gone */ } };
  const begin = () => { dragging = true; swallow = true; stopTween(); viewport.setAttribute("data-cam", "drag"); };

  const down = (e: PointerEvent) => {
    if (busy || (e.pointerType === "mouse" && e.button !== 0)) return;
    swallow = false;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pointers.size === 2) { begin(); for (const id of pointers.keys()) grab(id); }
  };

  const move = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (e.pointerType === "mouse" && e.buttons === 0) return up(e); // released outside the window
    if (pointers.size === 1) {
      if (!dragging) {
        const slop = e.pointerType === "mouse" ? DRAG_PX.mouse : DRAG_PX.touch;
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < slop) return;
        begin();
        grab(e.pointerId);
        // No re-basing here: the pan runs from the press point, so the piece of
        // diagram that was grabbed stays under the pointer. The few px of slop
        // arrive as one invisible jump; discarding them left the content
        // trailing the cursor by however far the first move event travelled.
      }
      moveTo(panCam(cam, e.clientX - p.x, e.clientY - p.y));
    } else if (pointers.size === 2) {
      const o = origin();
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const rel = (q: { x: number; y: number }) => ({ x: q.x - o.x, y: q.y - o.y });
      moveTo(pinchStep(cam, rel(p), rel(other), rel({ x: e.clientX, y: e.clientY }), rel(other), limits()));
    }
    p.x = e.clientX; p.y = e.clientY;
  };

  const up = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size) return; // the surviving finger carries on as a drag, from where it is
    if (dragging) viewport.setAttribute("data-cam", "idle");
    dragging = false;
    // A click is not guaranteed after a drag (released off-window, cancelled),
    // so the flag must not outlive this task and eat the *next* click.
    setTimeout(() => { swallow = false; }, 0);
  };

  const click = (e: MouseEvent) => {
    if (!swallow) return;
    swallow = false;
    e.stopPropagation();
    e.preventDefault();
  };

  // ── wheel: scroll pans, Ctrl/⌘ (and a Chrome/Firefox trackpad pinch) zooms ─
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    if (busy) return;
    const deltaMode = e.deltaMode; // read BEFORE the deltas: Firefox reports pixels otherwise
    const { dx, dy } = normalizeWheel({ deltaMode, deltaX: e.deltaX, deltaY: e.deltaY, shiftKey: e.shiftKey }, size);
    stopTween();
    if (e.ctrlKey || e.metaKey) {
      const o = origin();
      moveTo(zoomAt(cam, { x: e.clientX - o.x, y: e.clientY - o.y }, wheelZoomFactor(dy), limits()));
    } else {
      const next = wheelPan(cam, dx, dy, content, size, fitOpts.pad);
      if (sameCamera(next, cam, 1e-6)) return;
      cam = next; fitted = false; soon();
    }
  };

  // ── Safari's trackpad pinch. iOS fires these for a touch pinch *as well as*
  // pointer events, so they are ignored while a finger is being tracked — a
  // state check, not a guess about the browser.
  let k0 = 1;
  const gStart = (e: Event) => { e.preventDefault(); k0 = cam.k; stopTween(); };
  const gChange = (e: Event) => {
    e.preventDefault();
    if (busy || pointers.size) return;
    const g = e as GestureEvent, o = origin();
    moveTo(zoomAt(cam, { x: g.clientX - o.x, y: g.clientY - o.y }, (k0 * g.scale) / cam.k, limits()));
  };
  const gEnd = (e: Event) => e.preventDefault();

  const noDrag = (e: Event) => e.preventDefault(); // the browser's own image/text drag

  const bound: [string, EventListener, AddEventListenerOptions?][] = [
    ["click", click as EventListener, { capture: true }],
    ["pointerdown", down as EventListener],
    ["pointermove", move as EventListener],
    ["pointerup", up as EventListener],
    ["pointercancel", up as EventListener],
    ["lostpointercapture", up as EventListener],
    ["wheel", wheel as EventListener, { passive: false }],
    ["gesturestart", gStart, { passive: false }],
    ["gesturechange", gChange, { passive: false }],
    ["gestureend", gEnd, { passive: false }],
    ["dragstart", noDrag],
  ];
  for (const [type, fn, o] of bound) viewport.addEventListener(type, fn, o);

  const before = { touchAction: viewport.style.touchAction, origin: cameraEl.style.transformOrigin };
  viewport.style.touchAction = "none";
  viewport.setAttribute("data-cam", "idle");
  cameraEl.style.transformOrigin = "0 0";

  // ── resize: a fitted view refits; a moved one keeps its centre ───────────
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    const next = { w: viewport.clientWidth, h: viewport.clientHeight };
    if (next.w === size.w && next.h === size.h) return;
    const prev = size;
    size = next;
    if (busy) return; // the dive owns the frame; the host refits on settle if it must
    if (fitted) { cam = fitCamera(content, size, fitOpts); return now(); }
    const cx = (prev.w / 2 - cam.x) / cam.k, cy = (prev.h / 2 - cam.y) / cam.k;
    cam = clampCamera({ k: cam.k, x: size.w / 2 - cx * cam.k, y: size.h / 2 - cy * cam.k }, content, size);
    now();
  }) : undefined;
  ro?.observe(viewport);

  const handle: CameraHandle = {
    fit(animate = false) {
      size = { w: viewport.clientWidth, h: viewport.clientHeight };
      const target = fitCamera(content, size, fitOpts);
      if (animate) return animateTo(target, true);
      cam = target; fitted = true; now();
    },
    zoomBy(factor, animate = true) {
      const base = goal ?? cam;
      const target = clampCamera(zoomAt(base, { x: size.w / 2, y: size.h / 2 }, factor, limits()), content, size);
      if (sameCamera(target, cam, 1e-6)) return;
      if (animate) return animateTo(target, false);
      cam = target; fitted = false; now();
    },
    setScale(k, animate = true) { handle.zoomBy(k / (goal ?? cam).k, animate); },
    panBy(dx, dy) { stopTween(); moveTo(panCam(cam, dx, dy)); },
    setContentSize(w, h) {
      content = { w, h };
      size = { w: viewport.clientWidth, h: viewport.clientHeight };
      if (fitted) { cam = fitCamera(content, size, fitOpts); return now(); }
      const l = limits();
      cam = clampCamera({ ...cam, k: Math.min(l.max, Math.max(l.min, cam.k)) }, content, size);
      now();
    },
    setFitOptions(o) { fitOpts = { ...fitOpts, ...o }; },
    setBusy(b) {
      busy = b;
      if (!b) return;
      halt();
      pointers.clear();
      if (dragging) viewport.setAttribute("data-cam", "idle");
      dragging = false;
      write(); // whatever was queued lands before the dive measures
    },
    toLocal: (b) => camToLocal(cam, b),
    toScreen: (b) => camToScreen(cam, b),
    screenBox(el) {
      const r = el.getBoundingClientRect(), o = origin();
      return { x: r.left - o.x, y: r.top - o.y, w: r.width, h: r.height };
    },
    viewportBox: () => ({ x: 0, y: 0, w: size.w, h: size.h }),
    state: () => ({ ...cam }),
    atFit: () => fitted,
    destroy() {
      halt();
      ro?.disconnect();
      for (const [type, fn, o] of bound) viewport.removeEventListener(type, fn, o);
      viewport.style.touchAction = before.touchAction;
      viewport.removeAttribute("data-cam");
      cameraEl.style.transform = "";
      cameraEl.style.transformOrigin = before.origin;
    },
  };
  write();
  return handle;
}
