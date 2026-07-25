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
