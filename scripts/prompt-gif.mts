// The README's opening animation: a description in, a diagram out.
//
// The hero GIF (scripts/hero-gif.mts) shows what you can *do* with a finished
// diagram — dive into a system, climb back out. This one shows where the
// diagram came from: somebody describes their architecture to an agent in one
// paragraph, and this is what lands. That is the whole pitch of an LLM-first
// authoring language, and it is the one thing a static screenshot cannot say.
//
// Maintainer-only, macOS/Linux: needs ffmpeg on PATH.
//
//   npx tsx scripts/prompt-gif.mts
//
// Generated, never screen-recorded. The diagram half is the real renderer's
// output — the same bytes `squinch render examples/products-api` writes, which
// CI already gates — so the clip cannot claim a picture the tool does not
// draw. Only the prompt half is chrome, and it is drawn from the theme's own
// tokens so it moves with the palette.
//
// The prompt is honest in the sense that matters: it is what a person would
// actually type, and every element of the diagram is traceable to a clause in
// it. Nothing in the picture is unaccounted for, and nothing in the sentence
// goes undrawn. If the example changes, the sentence has to change with it —
// see docs/notes/readme-artifacts.md.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderProject, themes } from "../packages/core/dist/index.js";
import { measure, wrapText } from "../packages/core/dist/metrics.js";
import { svgToPng } from "../packages/cli/src/raster.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (theme: string) => join(root, `docs/assets/prompt-${theme}.gif`);
const tmp = join(root, ".prompt-tmp");

/** The example this clip renders, and the view inside it. `products-api` is
 *  also what the README's **From source to diagram** section shows, so a
 *  reader who scrolls sees the same nine nodes twice: once as the sentence
 *  that produced them, once as the source that draws them. */
const PROJECT = "examples/products-api/products-api.squinch";
const VIEW = "products";

/** What somebody types. Every clause maps to something in the render — the
 *  actor, the CDN, the load balancer and service, the VPC around those two,
 *  the table, the index, and the stream-fed Lambda between them. Read it
 *  against examples/products-api/products-api.squinch before changing either. */
const PROMPT =
  "Diagram our products API on AWS: shoppers hit CloudFront, then an ALB and a " +
  "Fargate service inside the prod-main VPC. The service reads and writes a " +
  "DynamoDB table and searches an OpenSearch index that a Lambda keeps current " +
  "off the table's stream.";

const W = 940, H = 780;
const PAD = 30;
const FPS = 25;
/** Characters revealed per frame. 60/sec is faster than anyone types, which is
 *  the convention for this shot — the alternative is eight seconds of watching
 *  a sentence appear. Slow enough that the words are still readable as they
 *  land, which a 4-per-frame cut was not. */
const CPF = 3;

/** Supersampling, for the same reason hero-gif.mts does it: resvg rasterizes
 *  glyphs with grayscale AA and no hinting, and this clip is *mostly* type. */
const SS = 2;

/** No wordmark. This clip is a diagram arriving, and the view already draws
 *  Squinch's own mark in its footer band — a second one in the same corner was
 *  the first thing that had to go. The empty half of the shot is better left
 *  empty than signed twice. */

/** The typing card: one measured column, centred. Widened along with the type
 *  below, so the sentence still wraps to four lines rather than six. */
const CARD_W = 800, CARD_PAD_X = 28, CARD_PAD_Y = 26;
/** Type sizes for the two states the prompt lives in — full size while it is
 *  being written, smaller once it is a caption over its own result.
 *
 *  Sized for where the clip is actually watched, not for the canvas. This is a
 *  940px-wide frame, and the landing draws it about 520 wide — so 15px of
 *  prompt arrived on screen as roughly 8px, which is below reading size. The
 *  type is ~1.6x that now. The ceiling is the caption, not the card: the card
 *  can spend vertical room freely (it is alone on screen and simply wraps to a
 *  fifth line), but every line the caption gains comes straight out of the
 *  diagram's stage below it. 24/18.5 is the last step that still wraps the
 *  caption to three lines — 25 spills it to four and costs the diagram 41px,
 *  where this costs 9. */
const BIG = 24, SMALL = 18.5;
const BIG_LH = 36, SMALL_LH = 28;
/** The chevron's column, and the text's, inside either box. */
const CHEV_W = 30;
/** How far under the last baseline the status row sits — clear of the sentence,
 *  so it reads as the tool talking rather than more of the prompt. */
const ROW_DROP = 34;
/** The box grows by this much, downward, when the prompt is sent — the room the
 *  status row needs. Reserving it from the start instead would leave the typing
 *  state, which is on screen far longer, visibly bottom-heavy for a beat that
 *  has not happened yet. Growing from a fixed top edge is also what a composer
 *  does when a reply starts: no text moves, only the floor. */
const GROW = 36;

let T = themes.light;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** cubic-bezier(.32,.72,0,1) — the same easing the app's dive uses, so the two
 *  README clips move with one hand. Front-loaded: most of the distance early,
 *  a soft landing. */
function ease(t: number): number {
  const [x1, y1, x2, y2] = [0.32, 0.72, 0, 1];
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (u: number) => ((ax * u + bx) * u + cx) * u;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const err = fx(u) - t;
    if (Math.abs(err) < 1e-6) break;
    const d = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(d) < 1e-6) break;
    u -= err / d;
  }
  return ((ay * u + by) * u + cy) * u;
}

/** The renderer animates async edges with a CSS keyframe, and resvg would
 *  freeze every dash mid-stride. Advance the phase per frame, same period and
 *  direction as the stylesheet — `db ~> indexer` is on screen for the whole
 *  hold, and a stopped stream reads as a broken picture. */
const FLOW_PERIOD = 0.9, FLOW_DASH = 10;
const flowAt = (i: number, svg: string) =>
  svg.replace(
    /class="sq-flow"/g,
    `class="sq-flow" stroke-dashoffset="${(-FLOW_DASH * (((i / FPS) / FLOW_PERIOD) % 1)).toFixed(3)}"`,
  );

interface Art { svg: string; w: number; h: number }

async function art(theme: string): Promise<Art> {
  const r = await renderProject(
    [{ name: "products-api.squinch", src: readFileSync(join(root, PROJECT), "utf8") }],
    { view: VIEW, theme },
  );
  if (!r.ok) throw new Error(`render failed: ${r.diagnostics.map((d) => d.message).join("; ")}`);
  const m = r.svg!.match(/<svg[^>]*width="(\d+)" height="(\d+)"/)!;
  return { svg: r.svg!, w: +m[1], h: +m[2] };
}

/** The diagram, placed in the space left under the caption: contained,
 *  centred, never upscaled past 1:1 so it keeps its designed weight. */
function fitOf(a: Art, top: number, bottom: number) {
  const h = bottom - top;
  const s = Math.min((W - PAD * 2) / a.w, h / a.h, 1);
  return { s, x: (W - a.w * s) / 2, y: top + (h - a.h * s) / 2 };
}

/** One board, placed and scaled about its own centre.
 *
 *  The `<svg>` wrapper is stripped and its children inlined: a nested viewport
 *  inside a scaled group makes resvg's bbox maths degenerate (hero-gif.mts hit
 *  the same panic). The viewBox is `0 0 w h` with matching width/height, so the
 *  wrapper implies no transform and dropping it is lossless. */
function board(a: Art, top: number, bottom: number, scale: number, opacity: number): string {
  if (opacity <= 0.005) return "";
  const f = fitOf(a, top, bottom);
  const cx = f.x + (a.w * f.s) / 2, cy = f.y + (a.h * f.s) / 2;
  const guts = a.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return (
    `<g opacity="${opacity.toFixed(3)}">` +
    `<g transform="translate(${(cx * (1 - scale)).toFixed(3)} ${(cy * (1 - scale)).toFixed(3)}) scale(${scale.toFixed(5)})">` +
    `<g transform="translate(${f.x.toFixed(3)} ${f.y.toFixed(3)}) scale(${f.s.toFixed(5)})"><g>${guts}</g></g>` +
    `</g></g>`
  );
}

/** The prompt's container in either state. `surface` over `canvas` with the
 *  theme's own hairline — the same two tokens a card uses, so the chrome reads
 *  as part of the same design language rather than a screenshot of some app. */
const boxRect = (x: number, y: number, w: number, h: number, alpha: number) =>
  `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" ` +
  `rx="10" fill="${T.surface}" stroke="${T.border}" stroke-width="1" opacity="${alpha.toFixed(3)}"/>`;

/** The `›` that marks this as something typed *at* a tool. Accent-coloured, so
 *  the eye starts at the sentence rather than at the box. */
const chevron = (x: number, y: number, size: number, alpha: number) =>
  `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Inter" font-size="${size}" ` +
  `font-weight="600" fill="${T.accent}" opacity="${alpha.toFixed(3)}">›</text>`;

const lineText = (x: number, y: number, size: number, s: string, fill: string, alpha: number) =>
  `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Inter" font-size="${size}" ` +
  `font-weight="400" fill="${fill}" opacity="${alpha.toFixed(3)}">${esc(s)}</text>`;

/** A text caret. Solid while characters are landing, blinking while idle —
 *  nobody's cursor blinks mid-word, and the difference is what makes the
 *  typing read as typing. */
const caret = (x: number, y: number, size: number, on: boolean) =>
  on
    ? `<rect x="${x.toFixed(2)}" y="${(y - size * 0.82).toFixed(2)}" width="1.8" height="${(size * 1.05).toFixed(2)}" ` +
      `rx="0.9" fill="${T.accent}"/>`
    : "";

/** The beat between the sentence ending and the diagram arriving: a status row
 *  that says what is happening, and changes as it changes. An agent tool has a
 *  running commentary — that is most of what makes one feel alive rather than
 *  frozen — and a bare spinner would have said only "wait".
 *
 *  Naming the skill is also the honest claim. "An AI made a picture" is not
 *  what happens here; an agent reaches for a documented skill (`packages/skill`,
 *  whose frontmatter names it `squinch`) and a CLI, both of which a reader can
 *  go and install. */
const STATUSES = [
  { text: "Thinking", n: 24 },
  { text: "Using squinch skill", n: 30 },
  { text: "Finalizing diagram", n: 24 },
];
const STATUS_FS = 19;
/** Frames per shimmer sweep, and per pulse of the leading dot. Both count in
 *  whole cycles rather than as a fraction of the beat: pace is a property of
 *  the animation, and normalizing it to the beat meant every change to how long
 *  the pause runs silently retimed the motion inside it. */
const SWEEP = 34, PULSE = 26;

/** The light travelling through the status text. A band of `ink` slides across
 *  a line of `muted` — the shimmer every agent tool uses to mean "this line is
 *  live". Baked per frame as a moved gradient rather than declared as an
 *  animation, because these frames are rasterized one at a time and resvg would
 *  render a CSS or SMIL animation at t=0 forever. */
const shimmer = (id: string, x: number, w: number, phase: number) => {
  const band = 130;
  const gx = x - band + (phase % 1) * (w + band * 2);
  return (
    `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `x1="${gx.toFixed(2)}" y1="0" x2="${(gx + band).toFixed(2)}" y2="0">` +
    `<stop offset="0" stop-color="${T.muted}"/>` +
    `<stop offset="0.5" stop-color="${T.ink}"/>` +
    `<stop offset="1" stop-color="${T.muted}"/>` +
    `</linearGradient></defs>`
  );
};

/** The dot that stays put while the words change — one continuous "working"
 *  signal, so the row reads as one thing updating rather than three things
 *  arriving. */
const pulse = (x: number, cy: number, phase: number) =>
  `<circle cx="${x.toFixed(2)}" cy="${cy.toFixed(2)}" r="3" fill="${T.accent}" ` +
  `opacity="${(0.4 + 0.45 * (0.5 + 0.5 * Math.sin(Math.PI * 2 * phase))).toFixed(3)}"/>`;

/** One status line. `dy` lifts it as it arrives and again as it leaves, so a
 *  change of text reads as the line being replaced.
 *
 *  `id` exists because a swap draws two of these at once. Fading one out and
 *  the next in over the *same* frames is the whole trick — an out-then-in with
 *  no overlap left two frames of empty row, which reads as a flicker rather
 *  than a change. Two lines on screen at once means two gradients, and one
 *  shared id would have pointed both at whichever was written last. */
const statusText = (
  id: string, x: number, cy: number, text: string, alpha: number, dy: number, phase: number,
) => {
  if (alpha <= 0.005) return "";
  const w = Math.ceil(measure(text, STATUS_FS, "400", "inter"));
  return (
    shimmer(id, x, w, phase) +
    `<g opacity="${alpha.toFixed(3)}" transform="translate(0 ${dy.toFixed(2)})">` +
    `<text x="${x.toFixed(2)}" y="${(cy + STATUS_FS * 0.36).toFixed(2)}" font-family="Inter" ` +
    `font-size="${STATUS_FS}" font-weight="400" fill="url(#${id})">${esc(text)}</text></g>`
  );
};

const build = async (theme: string) => {
  T = (themes as Record<string, typeof themes.light>)[theme];

  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  const diagram = await art(theme);

  // --- Geometry of the two states the prompt occupies ------------------------
  // Wrapped twice, at both sizes, because the caption is a different shape from
  // the card and the morph interpolates between the two boxes.
  const bigLines = wrapText(PROMPT, CARD_W - CARD_PAD_X * 2 - CHEV_W, BIG, "inter", 20);
  const capW = W - PAD * 2;
  const capLines = wrapText(PROMPT, capW - CARD_PAD_X * 2 - CHEV_W, SMALL, "inter", 20);

  const cardH = bigLines.length * BIG_LH + CARD_PAD_Y * 2;
  const capH = capLines.length * SMALL_LH + 14 * 2;
  const CARD = { x: (W - CARD_W) / 2, y: 0, w: CARD_W, h: cardH };
  // Centred: while the sentence is being written it is the only thing on the
  // canvas, and anchoring it to the top would leave the shot bottom-heavy the
  // whole time. Measured against the typing height, not the grown one — the
  // extra row is a later beat and should not shift the composition before it.
  CARD.y = (H - cardH) / 2;
  const CAP = { x: PAD, y: 26, w: capW, h: capH };
  /** Where the diagram lives once the caption is out of its way. */
  const stage = { top: CAP.y + capH + 18, bottom: H - 26 };

  /** The prompt at full size, `n` characters revealed. Returns the markup plus
   *  the caret's resting place — exactly where the next character would have
   *  gone, which is the only spot a caret can honestly sit. */
  const typed = (n: number, alpha = 1) => {
    let seen = 0, s = "";
    let tip = { x: CARD.x + CARD_PAD_X + CHEV_W, y: CARD.y + CARD_PAD_Y + BIG * 0.85 };
    bigLines.forEach((ln, i) => {
      const y = CARD.y + CARD_PAD_Y + BIG * 0.85 + i * BIG_LH;
      // +1 for the space wrapText consumed at the break: without it the reveal
      // stalls for a frame at the end of every line.
      const take = clamp(n - seen, 0, ln.length);
      if (take > 0) {
        const shown = ln.slice(0, take);
        s += lineText(CARD.x + CARD_PAD_X + CHEV_W, y, BIG, shown, T.ink, alpha);
        tip = { x: CARD.x + CARD_PAD_X + CHEV_W + measure(shown, BIG, "400", "inter"), y };
      }
      seen += ln.length + 1;
    });
    return { markup: s, tip };
  };

  const frames: string[] = [];
  const push = (body: string) =>
    frames.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<rect width="${W}" height="${H}" fill="${T.canvas}"/>${body}</svg>`,
    );

  const chars = PROMPT.length;

  // 1. An empty box with a blinking caret: the shot starts before the sentence
  //    does, so the first thing the reader understands is "someone is about to
  //    type here".
  for (let i = 0; i < 8; i++) {
    const { tip } = typed(0);
    push(
      boxRect(CARD.x, CARD.y, CARD.w, CARD.h, 1) +
      chevron(CARD.x + CARD_PAD_X, tip.y, BIG, 1) +
      caret(tip.x, tip.y, BIG, i % 10 < 6),
    );
  }

  // 2. The sentence lands.
  for (let n = CPF; n <= chars; n += CPF) {
    const { markup, tip } = typed(n);
    push(
      boxRect(CARD.x, CARD.y, CARD.w, CARD.h, 1) +
      chevron(CARD.x + CARD_PAD_X, CARD.y + CARD_PAD_Y + BIG * 0.85, BIG, 1) +
      markup + caret(tip.x, tip.y, BIG, true),
    );
  }

  // 3. A held beat on the finished sentence — long enough to read it, which is
  //    the only chance the reader gets at full size.
  const done = typed(chars);
  for (let i = 0; i < 12; i++)
    push(
      boxRect(CARD.x, CARD.y, CARD.w, CARD.h, 1) +
      chevron(CARD.x + CARD_PAD_X, CARD.y + CARD_PAD_Y + BIG * 0.85, BIG, 1) +
      done.markup + caret(done.tip.x, done.tip.y, BIG, i % 10 < 6),
    );

  // 4. Sent: the caret goes out, the box opens a row downward, and a status
  //    line runs the work — thinking, then the skill it reached for, then the
  //    last step before the picture. The pulsing dot is drawn outside the
  //    swap so it never blinks out: one thing updating, not three arriving.
  const rowX = CARD.x + CARD_PAD_X + CHEV_W;
  /** The status row's offset inside the box, so the morph can carry it. */
  const ROW_DY = CARD_PAD_Y + BIG * 0.85 + (bigLines.length - 1) * BIG_LH + ROW_DROP;
  const rowY = CARD.y + ROW_DY;
  const THINK = STATUSES.reduce((n, s) => n + s.n, 0);
  /** Frames a swap takes. The outgoing line keeps rising as the incoming one
   *  comes up under it, both at partial opacity. */
  const XF = 4, RISE = 6;
  let f = 0;
  STATUSES.forEach((st, k) => {
    for (let j = 0; j < st.n; j++, f++) {
      // the floor drops over the first five frames of the whole beat
      const open = ease(clamp(f / 5, 0, 1));
      // and the row as a whole arrives just behind it
      const rowA = clamp((f - 2) / 5, 0, 1);
      const inA = clamp(j / XF, 0, 1);
      push(
        boxRect(CARD.x, CARD.y, CARD.w, CARD.h + GROW * open, 1) +
        chevron(CARD.x + CARD_PAD_X, CARD.y + CARD_PAD_Y + BIG * 0.85, BIG, 1) +
        done.markup +
        `<g opacity="${rowA.toFixed(3)}">${pulse(rowX + 4, rowY, f / PULSE)}</g>` +
        (k > 0 && inA < 1
          ? statusText("pg-out", rowX + 16, rowY, STATUSES[k - 1].text,
              (1 - inA) * rowA, -inA * RISE, f / SWEEP)
          : "") +
        statusText("pg-in", rowX + 16, rowY, st.text, inA * rowA, (1 - inA) * RISE, f / SWEEP),
      );
    }
  });

  // 5. The answer. The box travels to the top and shrinks into a caption while
  //    the diagram rises under it — one motion, not a cut, so the sentence and
  //    the picture are visibly the same object at two moments. The two text
  //    sizes cross-fade rather than interpolate: re-wrapping a paragraph
  //    mid-flight looks like a glitch, and nobody reads a sentence in motion.
  const MORPH = 18;
  for (let i = 1; i <= MORPH; i++) {
    const e = ease(i / MORPH);
    const x = lerp(CARD.x, CAP.x, e), y = lerp(CARD.y, CAP.y, e);
    // from the *open* height, the one the working row left on screen — starting
    // from CARD.h would snap the floor back up 24px on the first frame
    const w = lerp(CARD.w, CAP.w, e), h = lerp(CARD.h + GROW, CAP.h, e);
    const outA = clamp(1 - e / 0.45, 0, 1);
    const inA = clamp((e - 0.45) / 0.5, 0, 1);
    const capBody = capLines
      .map((ln, k) => lineText(x + CARD_PAD_X + CHEV_W, y + 14 + SMALL * 0.85 + k * SMALL_LH, SMALL, ln, T.muted, inA))
      .join("");
    push(
      boxRect(x, y, w, h, 1) +
      chevron(x + CARD_PAD_X, y + (outA > inA ? CARD_PAD_Y + BIG * 0.85 : 14 + SMALL * 0.85), outA > inA ? BIG : SMALL, 1) +
      (outA > 0.005
        ? bigLines
            .map((ln, k) => lineText(x + CARD_PAD_X + CHEV_W, y + CARD_PAD_Y + BIG * 0.85 + k * BIG_LH, BIG, ln, T.ink, outA))
            .join("")
        : "") +
      // the status row leaves with the sentence it belongs to, rather than
      // being cut on the morph's first frame
      (outA > 0.005
        ? `<g opacity="${outA.toFixed(3)}">${pulse(x + CARD_PAD_X + CHEV_W + 4, y + ROW_DY, (THINK + i) / PULSE)}</g>` +
          statusText("pg-in", x + CARD_PAD_X + CHEV_W + 16, y + ROW_DY,
            STATUSES[STATUSES.length - 1].text, outA, 0, (THINK + i) / SWEEP)
        : "") +
      capBody +
      board(diagram, stage.top, stage.bottom, lerp(0.965, 1, e), clamp((e - 0.3) / 0.55, 0, 1)),
      1 - clamp((e - 0.2) / 0.4, 0, 1),
    );
  }

  // 6. Hold on the result. The stream keeps moving, so these frames are all
  //    distinct and the encoder cannot collapse them — which is most of what
  //    the hold costs.
  const capBody = capLines
    .map((ln, k) => lineText(CAP.x + CARD_PAD_X + CHEV_W, CAP.y + 14 + SMALL * 0.85 + k * SMALL_LH, SMALL, ln, T.muted, 1))
    .join("");
  const finalFrame =
    boxRect(CAP.x, CAP.y, CAP.w, CAP.h, 1) +
    chevron(CAP.x + CARD_PAD_X, CAP.y + 14 + SMALL * 0.85, SMALL, 1) +
    capBody +
    board(diagram, stage.top, stage.bottom, 1, 1);
  for (let i = 0; i < 75; i++) push(finalFrame);

  // --- Raster and encode -----------------------------------------------------
  frames.forEach((rawSvg, i) => {
    const svg = flowAt(i, rawSvg);
    if (process.env.DUMP_SVG) { writeFileSync(join(tmp, `f${String(i).padStart(4, "0")}.svg`), svg); return; }
    writeFileSync(join(tmp, `f${String(i).padStart(4, "0")}.png`), svgToPng(svg, { width: W * SS }));
    if (i % 25 === 0) console.log(`  frame ${i + 1}/${frames.length}`);
  });
  if (process.env.DUMP_SVG) { console.log("dumped SVGs to", tmp); return; }

  // Two passes, no dither — flat vector art from a small palette has nothing
  // for a dither to approximate, and an ordered one puts a regular speckle
  // across every card gradient.
  //
  // 128 colours, not 256. Measured on this clip: 256→128 is 12.8% off the file
  // for a worst-case channel error of 60 on a handful of antialiasing pixels,
  // indistinguishable at 3x on the most-damaged region. The curve has a knee
  // there — 192 saves 0.4% (i.e. nothing) while still quantising, and 64 doubles
  // the error for another 11%. Frame cropping is *not* a lever here: ffmpeg
  // already stores 272 of 273 frames as changed-rectangles only, a median of
  // 0.1% of canvas each, so there is nothing for a gifsicle -O3 pass to reclaim.
  const OUT = out(theme);
  const pal = join(tmp, "palette.png");
  const ff = (a: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...a]);
  const down = `scale=${W}:${H}:flags=lanczos`;
  ff(["-framerate", String(FPS), "-i", join(tmp, "f%04d.png"),
      "-vf", `${down},palettegen=max_colors=128:stats_mode=full`, pal]);
  mkdirSync(dirname(OUT), { recursive: true });
  ff(["-framerate", String(FPS), "-i", join(tmp, "f%04d.png"), "-i", pal,
      "-lavfi", `[0:v]${down}[c];[c][1:v]paletteuse=dither=none`, "-loop", "0", OUT]);
  if (!process.env.KEEP_FRAMES) rmSync(tmp, { recursive: true, force: true });

  console.log(
    `wrote ${OUT} — ${frames.length} frames, ${(frames.length / FPS).toFixed(1)}s, ` +
    `${Math.round(statSync(OUT).size / 1024)} KB`,
  );
};

for (const theme of ["light", "dark"]) await build(theme);
