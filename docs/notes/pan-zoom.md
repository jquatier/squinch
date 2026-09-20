# Note — pan and zoom

Engineering note, not a requirement. The playground could zoom only from a
button pill — 25% steps about the centre, and at high zoom the left and top
overflow was unreachable, because native scroll only extends right and down. The
interactive HTML export could not zoom or pan at all. Neither surface had a line
of pointer, wheel or touch code. DESIGN §10 had promised "buttery zoom/pan
(trackpad-native)" since the restyle. This records what was built (2026-09), the
decisions that would otherwise get relitigated, and what is deliberately absent.

## The shape

**One camera, in core, used by both surfaces.** `view/camera.ts` is the
arithmetic — no DOM, unit-tested — and `view/camera-dom.ts` is the thin half that
listens to pointers and wheels and writes one `transform`. The export bundles
the controller into its viewer script; the playground calls the same function
from a React effect. It is the bargain `dive.ts` struck for the dive: two hosts,
one implementation, so "they feel the same" is a fact about the build.

**The transform lives on a wrapper around both dive layers.** The dive owns the
live layer's inline style and wipes it when it settles, so the camera cannot go
there. It goes on a new element holding ghost *and* live — `#sq-cam` in the
export, the camera div in `Stage.tsx` — inside a viewport that never scrolls.
The SVG renders at its natural size; the renderer always writes unitless px
`width`/`height` and a matching `viewBox`, which is all fit-to-window needs.

**The dive runs in the camera's local space, and every view arrives fitted.**
`diveTransforms` did not change — see the addendum in `zoom-transitions.md`. A
new view is a different size and shape, so carrying the old zoom into it has no
meaning; the dive still *starts* from exactly what was on screen.

## Decisions

- **Scroll pans; pinch or Ctrl/⌘+wheel zooms.** The Figma model, chosen by the
  owner over "wheel zooms" (a casual two-finger swipe zooming is jumpy) and over
  guessing mouse-versus-trackpad from the event's shape (it misfires on hi-res
  mice and Windows touchpads). A mouse-only reader zooms with Ctrl+wheel, the
  buttons, or `+`/`−`; the button titles say so.
- **The first view is what it always was**: fit the *width*, never above 1:1,
  and open at the *top* when that leaves the diagram taller than the window. A
  contain fit opens a 900×4000 diagram as a 150px strip, and a "legibility
  floor" draft opened it as a 540px one; both lose to what readers already had,
  where a long diagram opens readable and scrolling moves down it. Zooming
  *out* always reaches true contain (the minimum is half of it). Presentation
  alone contains with upscaling — a slide is the one place a diagram is drawn
  larger than life.
- **Two movement rules, not two clamps.** A drag may take the content mostly
  off-screen (that is what looking at one corner means) but never entirely. The
  wheel is defined by an invariant and tested as one: it never moves content
  further outside the bounds it can fully reach, always lets it come back, and
  a zero delta is the identity. So a wheel over a diagram that already fits does
  nothing, and content a drag left half off-screen scrolls back without snapping.
- **A press is only recorded; the pointer is captured once it has become a
  drag** (4px mouse, 8px touch). Capturing on `pointerdown` retargets the
  `click` to the viewport and breaks every `closest("[data-path]")`. Because a
  captured drag *also* ends in a click on the viewport — where backdrop-climb
  lives — a capture-phase suppressor, armed only by a real drag or pinch and
  registered before the host's handler, is load-bearing. It disarms on the next
  press and on a zero timeout, since a click is not guaranteed after a drag.
- **The grabbed point stays under the pointer.** The pan runs from the press
  point; the few px of slop arrive as one invisible jump. Discarding them left
  the content trailing the cursor by however far the first move event went.
- **A gesture cancels a tween, never a pending paint.** Each wheel event used to
  cancel the queued frame before computing its move; once zoom hit its cap the
  next event had nothing to change, scheduled nothing, and the screen sat a
  frame behind the camera. Found by a probe whose screenshot said 125% when the
  state said 400%.
- **Programmatic, non-animated sets are synchronous** and beat anything queued.
  The dive measures straight after `fit()`.
- **Input is dropped while a dive is in flight** (`setBusy`). macOS keeps sending
  inertial wheel events for a second after a flick, and they would pan the view
  that just arrived fitted. In the playground that starts at *arm*, not fire.
- **Max zoom is 4×, and a dive from past three viewports cuts instead.** The
  ghost is the old picture at its on-screen size, and the dive scales it up to
  3.2× more with an `feDropShadow` on every card.
- **No `will-change`.** A spike measured a scaled wrapper against the same SVG
  scaled by layout: identical edge sharpness at rest in Chromium and WebKit at
  1× and 2× density. Headless screenshots repaint from scratch and cannot see a
  compositor's raster scale, so that proves the at-rest case only — sharpness
  in real Safari and on iOS stays a hand check (below). If a browser ever
  rasters soft, the remedy is to bake `W·k × H·k` into the svg at rest and keep
  the transform for gestures.
- **Keys are window-level and yield to anything that types**: `+` `=` `−` `0`
  `1`, Shift+arrows. No click-to-focus, because focusing the canvas would cost a
  backdrop click, which climbs a view. In the export the handler also yields
  Space and Enter to a focused button — it used to swallow them and step the
  deck, so every button in the file was dead to the keyboard.
- **React holds none of it.** The scale changes per frame during a pinch; state
  in `App` would re-render the editor with it. The pill drives the camera
  through a handle, the percentage is written into its element directly, and
  only "is it fitted?" comes back as state. The camera div, the ghost and the
  live layer carry no `style` prop.
- **The dot grid moves with the camera**, its spacing folding back by powers of
  two so the density reads the same from 10% to 400%.

## Rejected

- **Zooming by `viewBox`, or a `<g>` matrix inside the SVG.** The embedded SVGs
  are byte-comparable to `render -o x.svg`, and the viewer is their sibling,
  never their content.
- **Native scroll plus CSS zoom** — what the playground had. It cannot reach
  left or top overflow, cannot anchor at the cursor, and gives the export
  nothing.
- **Double-click to zoom.** A card click dives at once and a backdrop click
  climbs; a double-click cannot be told from two of those without delaying
  every click.
- **Keeping the zoom level across a dive, or remembering a camera per view.**
  Offered to the owner; "every view arrives fitted" won.
- **A legibility floor on the fit.** See above: it regressed the common tall
  diagram from 100% to 60%.

## Deliberately out of scope

- **The VS Code preview** has its own webview and no camera. It is now the one
  surface without one.
- **An export inside an iframe traps the wheel** (and touch). Passing a plain
  wheel through when the camera has nothing to pan was designed and cut: no
  embed exists in the repo, and it complicates every `preventDefault`.
- **Diagram text is no longer selectable** on either surface. A drag must pan,
  not start a selection.
- **Exiting Present loses the pre-present camera.** The stage remounts.
- **Untested: a Windows precision touchpad.** No machine to hand.

## What only a person can check

Playwright has no multi-touch, and headless engines have no compositor worth
trusting. Before changing the controller, by hand: trackpad pinch in Chrome,
Firefox and Safari (the point under the fingers holds still; the page does not
zoom); a horizontal swipe at the content's edge does not trigger browser back;
a flick followed at once by a card click still arrives fitted; small text at
400% is sharp at rest in Safari and on iOS, including right after a dive; on a
phone, one finger pans, two pinch without double speed, and a tap dives.
Everything else is in `packages/core/e2e/export.spec.ts` (Chromium and WebKit,
over `file://`) and `apps/spa/e2e/playground.spec.ts`.
