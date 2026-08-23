// legend auto — a key of only what the render actually uses; titleblock — the
// drafting-style corner block. Both are earned, never boilerplate.
import { describe, it, expect } from "vitest";
import { render, buildModel } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";

const BASE = `pack aws
system s "S" {
  a = aws/lambda "API"
  q = aws/sqs "Queue" datastore
  w = aws/lambda "Worker"
  a ~> q "enqueue"
  a -> w "health"
}`;

describe("legend + titleblock", () => {
  it("parses legend auto/off and titleblock attrs", () => {
    const r = buildModel(
      `${BASE}\nview s {\n legend auto\n titleblock {\n  version: "2026-07"\n  owner: team-payments\n }\n}`,
    );
    expect(r.ok).toBe(true);
    const v = r.model.views.find((x) => x.name === "s")!;
    expect(v.legend).toBe(true);
    expect(v.titleblock).toEqual({ version: "2026-07", owner: "team-payments" });
    const off = buildModel(`${BASE}\nview s {\n legend off\n}`);
    expect(off.model.views.find((x) => x.name === "s")!.legend).toBe(false);
  });

  it("a restyled sync edge earns no entry, and async samples its own pattern", async () => {
    const base = `pack aws\nsystem s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n c = aws/lambda "C"\n`;
    const dotted = await render(`${base} a -> b { style: dotted }\n b ~> c { style: dotted }\n}\nview s { legend auto }`, { theme: "light" });
    expect(dotted.svg).toContain(">sync</text>");
    expect(dotted.svg).toContain(">async</text>");
    expect(dotted.svg).not.toContain(">dotted</text>");
    expect(dotted.svg).not.toContain(">dashed</text>");
    // the async sample: dotted, because every async edge here is
    expect(dotted.svg).toMatch(/stroke-dasharray="2 3"\/>(?:(?!<line)[\s\S])*?>async<\/text>/);
  });

  it("legend shows only earned entries", async () => {
    const r = await render(`${BASE}\nview s {\n legend auto\n}`, { theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.svg).toContain(">sync</text>");
    expect(r.svg).toContain(">async</text>");
    expect(r.svg).not.toContain(">aggregated</text>"); // no ×N edges here
    expect(r.svg).not.toContain(">context</text>"); // no context cards here
    expect(validateSVG(r.svg!).ok).toBe(true);

    const noAsync = await render(
      `pack aws\nsystem s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n a -> b\n}\nview s { legend auto }`,
      { theme: "light" },
    );
    expect(noAsync.svg).not.toContain(">async</text>");
  });

  it("draws the title, with or without a titleblock beside it", async () => {
    // `title` used to render only *inside* the bottom-right titleblock, so a
    // view that named itself and nothing else drew nothing at all — a
    // documented gotcha rather than a feature. The header owns the title now,
    // and a titleblock only adds the meta chip under it.
    const src = `${BASE}\nview s {\n title "Payments — settlement path"\n titleblock {\n  version: "2026-07"\n  status: "draft"\n }\n}`;
    const withTb = await render(src, { theme: "light" });
    const without = await render(`${BASE}\nview s { title "Payments — settlement path" }`, { theme: "light" });
    expect(withTb.ok).toBe(true);
    expect(withTb.svg).toContain("Payments — settlement path");
    expect(without.svg).toContain("Payments — settlement path");
    const h = (s: string) => +s.match(/height="(\d+)"/)![1];
    expect(h(withTb.svg!)).toBeGreaterThan(h(without.svg!));
    expect(validateSVG(withTb.svg!).ok).toBe(true);
  });

  it("keeps an arbitrary key with its value, and lets a reserved one speak alone", async () => {
    // `2026-07` reads as a version unaided; `draft` alone says nothing, so the
    // key rides with it. Dropping either would drop the fact.
    const src = `${BASE}\nview s {\n title "T"\n titleblock {\n  version: "2026-07"\n  status: "draft"\n }\n}`;
    const r = await render(src, { theme: "light" });
    expect(r.svg).toContain(">2026-07</text>");
    expect(r.svg).toContain(">status</text>");
    expect(r.svg).toContain(">draft</text>");
    expect(r.svg).not.toContain(">version</text>"); // the value is self-describing
    expect(validateSVG(r.svg!).ok).toBe(true);
  });
});
