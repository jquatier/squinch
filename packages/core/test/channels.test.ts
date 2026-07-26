// `channel` (SPEC §6 Tier 2): several edges into one target share a trunk,
// so a fan-in reads as a bus instead of N converging lines.
import { describe, it, expect } from "vitest";
import { buildModel, layoutView, render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";

const SRC = `pack aws
system s "Orders" {
  api    = aws/api-gateway "API"
  create = aws/lambda "Create"
  get    = aws/lambda "Get"
  search = aws/lambda "Search"
  db     = aws/dynamodb "Orders Table" datastore
  api -> create, get, search
  create -> db "put"
  get -> db "read"
  search -> db "scan"
}
view s {
  layout {
    rows [api] [create get search] [db]
    channel create, get, search -> db
  }
}
`;

const layout = async (src: string) => {
  const built = buildModel(src);
  const view = built.model.views.find((v) => v.name === "s")!;
  return layoutView(built.model, view);
};

describe("channel", () => {
  it("merges its members into one trunk with a single entry", async () => {
    const { positioned, diagnostics } = await layout(SRC);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    const members = positioned.edges.filter((e) => e.to === "s.db" && e.from !== "s.api");
    expect(members).toHaveLength(3);
    // every member ends at the same point: one arrow into the target
    const tips = new Set(members.map((e) => `${e.points.at(-1)!.x},${e.points.at(-1)!.y}`));
    expect(tips.size).toBe(1);
    // and they share the trunk's y
    const trunkYs = new Set(members.map((e) => e.points[1].y));
    expect(trunkYs.size).toBe(1);
    // the trunk sits between the sources and the target
    const db = positioned.nodes.find((n) => n.path === "s.db")!;
    const create = positioned.nodes.find((n) => n.path === "s.create")!;
    const trunkY = members[0].points[1].y;
    expect(trunkY).toBeGreaterThan(create.y + create.h);
    expect(trunkY).toBeLessThan(db.y);
  });

  it("moves the ports with the geometry so labels follow the wire", async () => {
    const { positioned } = await layout(SRC);
    const edge = positioned.edges.find((e) => e.from === "s.create" && e.to === "s.db")!;
    const port = positioned.ports.find((p) => p.edge === edge.id && p.node === "s.db")!;
    expect(port.x).toBe(edge.points.at(-1)!.x);
    expect(port.side).toBe("north");
  });

  it("renders valid, deterministic SVG", async () => {
    const a = await render(SRC, { view: "s", theme: "light" });
    const b = await render(SRC, { view: "s", theme: "light" });
    expect(a.ok).toBe(true);
    expect(validateSVG(a.svg!).ok).toBe(true);
    expect(b.svg).toBe(a.svg);
  });

  it("one source is not a channel — it is just an edge", () => {
    const r = buildModel(SRC.replace("channel create, get, search -> db", "channel create -> db"));
    expect(r.diagnostics.some((d) => d.message.includes("needs at least two sources"))).toBe(true);
  });

  it("warns rather than mangling the picture when members are not visible", async () => {
    // at landscape altitude the members lift into the system card and vanish
    const src = SRC.replace("view s {", "view top {\n  include *\n}\nview s {");
    const built = buildModel(src.replace("view s {\n  layout", "view s {\n  scope s\n  layout"));
    const top = built.model.views.find((v) => v.name === "top")!;
    top.layout.channels = [{ sources: ["s.create", "s.get"], target: "s.db", loc: top.loc }];
    const { diagnostics } = await layoutView(built.model, top);
    expect(diagnostics.some((d) => d.message.includes("channel into"))).toBe(true);
  });
});
