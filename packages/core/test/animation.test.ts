// Async (~>) edges animate by default: CSS stroke-dashoffset at constant px/s,
// gated behind prefers-reduced-motion, opt-out per edge with `animate: false`.
// Never JS (non-negotiable: exported SVG contains no scripts).
import { describe, it, expect } from "vitest";
import { render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";

const SRC = `pack aws
system s "S" {
  db   = aws/dynamodb "DB"
  sync = aws/lambda "Sync"
  idx  = aws/opensearch "Index"
  db ~> sync "stream"
  sync -> idx "index"
}`;

describe("async edge animation", () => {
  it("animates ~> edges by default, behind prefers-reduced-motion", async () => {
    const r = await render(SRC, { theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.svg).toContain(`class="sq-flow"`);
    expect(r.svg).toContain("prefers-reduced-motion: no-preference");
    expect(r.svg).toContain("@keyframes sq-flow");
    expect(r.svg).not.toContain("<script");
    expect(validateSVG(r.svg!).ok).toBe(true);
    // sync edges never animate: exactly one animated path (the one ~> edge)
    expect(r.svg!.match(/class="sq-flow"/g)!.length).toBe(1);
  });

  it("animate: false opts an edge out, and the keyframes disappear with it", async () => {
    const src = SRC.replace(`db ~> sync "stream"`, `db ~> sync "stream" { animate: false }`);
    const r = await render(src, { theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.svg).not.toContain("sq-flow");
    expect(r.svg).toContain(`stroke-dasharray`); // still dashed, just still
  });
});

// The vocabulary beyond `flow`, and the styles that make sync edges eligible.
// Everything stays a passive keyframe inside the one reduced-motion gate.
describe("animate vocabulary + edge styles", () => {
  const CLASSES = {
    reverse: "sq-flow-r", slow: "sq-flow-s", fast: "sq-flow-f",
    packets: "sq-pk", pulse: "sq-pulse",
  } as const;

  for (const [value, cls] of Object.entries(CLASSES))
    it(`animate: ${value} → class ${cls}`, async () => {
      const src = SRC.replace(`db ~> sync "stream"`, `db ~> sync "stream" { animate: ${value} }`);
      const r = await render(src, { theme: "light" });
      expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
      expect(r.svg).toContain(`class="${cls}"`);
      expect(r.svg).not.toContain(`class="sq-flow"`); // replaced, not stacked
      expect(validateSVG(r.svg!).ok).toBe(true);
    });

  it("emits only the rules a diagram uses", async () => {
    const src = SRC.replace(`db ~> sync "stream"`, `db ~> sync "stream" { animate: pulse }`);
    const r = await render(src, { theme: "light" });
    expect(r.svg).toContain("@keyframes sq-pulse");
    expect(r.svg).not.toContain("@keyframes sq-flow"); // no drift keyframe without a drifter
  });

  it("slow and fast share the flow keyframe at their own durations", async () => {
    const src = SRC.replace(`db ~> sync "stream"`, `db ~> sync "stream" { animate: slow }`);
    const r = await render(src, { theme: "light" });
    // one keyframe, several durations — that is what makes px/s constant
    expect(r.svg).toContain(".sq-flow-s{animation:sq-flow 14.29s");
    expect(r.svg!.match(/@keyframes sq-flow\{/g)!.length).toBe(1);
  });

  it("drifts a whole number of dash periods, so the loop never jumps", async () => {
    // The offset serves every pattern one class can carry: dashed 6+5=11 and
    // dotted 2+3=5, so it is their LCM. Shifting five dashed periods looks
    // exactly like shifting one; what it buys is a seamless loop for both.
    const r = await render(SRC, { theme: "light" });
    expect(r.svg).toContain(
      "<style>@media (prefers-reduced-motion: no-preference){" +
        ".sq-flow{animation:sq-flow 4.95s linear infinite}" +
        "@keyframes sq-flow{to{stroke-dashoffset:-55}}}</style>",
    );
    for (const period of [11, 5]) expect(55 % period).toBe(0);
    // and the speed the vocabulary promises is unchanged: 55px / 4.95s is the
    // same 11.1 px/s the old 10px / 0.9s keyframe drifted at
    expect(55 / 4.95).toBeCloseTo(10 / 0.9, 1);
  });

  it("style: dotted changes the pattern; style: dashed + animate makes sync edges travel", async () => {
    const src = SRC
      .replace(`db ~> sync "stream"`, `db ~> sync "stream" { style: dotted }`)
      .replace(`sync -> idx "index"`, `sync -> idx "index" {\n    style: dashed\n    animate: flow\n  }`);
    const r = await render(src, { theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.svg).toContain(`stroke-dasharray="2 3"`); // dotted async
    expect(r.svg!.match(/class="sq-flow"/g)!.length).toBe(2); // async + the styled sync edge
  });

  it("pulse reaches the arrowhead, travel does not", async () => {
    const src = SRC.replace(`sync -> idx "index"`, `sync -> idx "index" { animate: pulse }`);
    const r = await render(src, { theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    // the filled sync head carries the class so the whole edge breathes
    expect(r.svg).toMatch(/<path class="sq-pulse" d="M \d+ \d+ L [^"]*Z" fill="/);
    // the async flow head does not drift
    expect(r.svg).not.toMatch(/<path class="sq-flow" d="M [^"]*" fill="none" stroke="[^"]*" stroke-width="1.5" stroke-linecap="round" stroke-linejoin/);
  });

  it("aggregates keep styling only on full agreement", async () => {
    const two = `pack aws
system a "A" { x = aws/lambda "X"
  y = aws/lambda "Y" }
system b "B" { z = aws/lambda "Z" }
a.x ~> b.z "one"
a.y ~> b.z "two" { animate: packets }
view v { include * }`;
    const r = await render(two, { theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    // disagreement → the trunk claims no animation at all
    expect(r.svg).not.toContain("sq-pk");
    expect(r.svg).not.toContain(`class="sq-flow"`);
  });
});

describe("edge attr diagnostics", () => {
  const buildErrs = async (edge: string) => {
    const src = SRC.replace(`db ~> sync "stream"`, edge);
    const r = await render(src, { theme: "light" });
    return r.diagnostics.map((d) => `${d.severity}: ${d.message}${d.fix ? ` | ${d.fix}` : ""}`).join("\n");
  };

  it("unknown animate value errors with did-you-mean", async () => {
    const out = await buildErrs(`db ~> sync "stream" { animate: revrse }`);
    expect(out).toContain("unknown animate value `revrse`");
    expect(out).toContain("did you mean `reverse`?");
  });

  it("unknown style value errors with did-you-mean", async () => {
    const out = await buildErrs(`db ~> sync "stream" { style: doted }`);
    expect(out).toContain("unknown edge style `doted`");
    expect(out).toContain("did you mean `dotted`?");
  });

  it("style: solid on an async edge is refused", async () => {
    const out = await buildErrs(`db ~> sync "stream" { style: solid }`);
    expect(out).toContain("async edges are dashed by design");
  });

  it("travel on a solid sync edge is refused, pointing at both fixes", async () => {
    const out2 = await (async () => {
      const src = SRC.replace(`sync -> idx "index"`, `sync -> idx "index" { animate: flow }`);
      const r = await render(src, { theme: "light" });
      return r.diagnostics.map((d) => `${d.message} | ${d.fix ?? ""}`).join("\n");
    })();
    expect(out2).toContain("needs a visible pattern");
    expect(out2).toContain("animate: pulse");
  });

  it("packets rejects a style, which it would override anyway", async () => {
    const out = await buildErrs(`db ~> sync "stream" {\n    animate: packets\n    style: dotted\n  }`);
    expect(out).toContain("draws its own sparse pattern");
  });

  it("a typo'd attribute key warns instead of vanishing", async () => {
    const out = await buildErrs(`db ~> sync "stream" { animte: false }`);
    expect(out).toContain("warning: unknown edge attribute `animte`");
    expect(out).toContain("did you mean `animate`?");
  });
});
