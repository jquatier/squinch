// Flows (SPEC §Flows): numbered walks over existing edges. `show flow x`
// renders step badges; steps hidden at an altitude keep their numbers.
import { describe, it, expect } from "vitest";
import { buildModel, render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";

const SRC = `pack aws
system shop "Shop" {
  api    = aws/api-gateway "API"
  create = aws/lambda "Create"
  db     = aws/dynamodb "Orders" datastore
  files  = aws/s3 "Files" datastore
  api -> create
  create -> db "write"
  create ~> files "attach"
}

flow checkout "Checkout" {
  api -> create -> db
  create ~> files
}

view shop {
  show flow checkout
  legend auto
}
`;

describe("flows — model", () => {
  it("parses chains; steps number in declaration order", () => {
    const r = buildModel(SRC);
    expect(r.ok).toBe(true);
    expect(r.model.flows[0].steps).toEqual([
      { from: "shop.api", to: "shop.create" },
      { from: "shop.create", to: "shop.db" },
      { from: "shop.create", to: "shop.files" },
    ]);
  });

  it("a step without a backing edge is an error with the fix", () => {
    const r = buildModel(SRC.replace("api -> create -> db", "api -> create -> files -> db"));
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((x) => x.message.includes("no edge"));
    expect(d?.fix).toContain("flows number existing edges");
  });

  it("unknown flow in show flow gets a did-you-mean", () => {
    const r = buildModel(SRC.replace("show flow checkout", "show flow chekout"));
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].fix).toContain("checkout");
  });
});

describe("flows — render", () => {
  it("renders numbered badges near each step's source, and a legend entry", async () => {
    const r = await render(SRC, { view: "shop", theme: "light" });
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    const badges = r.svg!.match(/data-kind="flow-step"/g) ?? [];
    expect(badges.length).toBe(3);
    for (const n of ["1", "2", "3"]) expect(r.svg).toMatch(new RegExp(`>${n}</text>`));
    expect(r.svg).toContain("flow: Checkout");
    // determinism
    const again = await render(SRC, { view: "shop", theme: "light" });
    expect(again.svg).toBe(r.svg);
  });

  it("steps lifted inside a card disappear; visible steps keep their numbers", async () => {
    const src = SRC + `
sys2 = box "Client" external
sys2 -> shop.api "calls"
flow e2e "E2E" {
  sys2 -> shop.api -> shop.create
}
view landscape {
  include *
  show flow e2e
}
`;
    const r = await render(src, { view: "landscape", theme: "light" });
    expect(r.ok).toBe(true);
    // step 1 (client → shop card) is visible; step 2 is inside the card
    const badges = r.svg!.match(/data-kind="flow-step"/g) ?? [];
    expect(badges.length).toBe(1);
    expect(r.svg).toMatch(/data-kind="flow-step"><circle[^/]*\/><text[^>]*>1</);
  });
});
