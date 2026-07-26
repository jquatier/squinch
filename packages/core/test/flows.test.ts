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

  it("reports how many hops actually render, so a viewer knows the length", async () => {
    const r = await render(SRC, { view: "shop", theme: "light" });
    expect(r.flow).toEqual({ label: "Checkout", steps: 3 });
    const none = await render(SRC.replace("  show flow checkout\n", ""), { view: "shop" });
    expect(none.flow).toBeUndefined();
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

/** Flow stories: the same declared flow, revealed one hop at a time. This is a
 *  render option, never DSL — the diagram doesn't change, only how much of the
 *  story is on screen. */
describe("flows — stepping", () => {
  const at = (step?: number) => render(SRC, { view: "shop", theme: "light", flowStep: step });
  const badges = (svg: string) => (svg.match(/data-kind="flow-step"/g) ?? []).length;

  it("reveals badges as their step comes due", async () => {
    expect(badges((await at(1)).svg!)).toBe(1);
    expect(badges((await at(2)).svg!)).toBe(2);
    expect(badges((await at(3)).svg!)).toBe(3);
    // no flowStep at all = the whole flow, exactly as before
    expect(badges((await at(undefined)).svg!)).toBe(3);
  });

  it("dims what the request has not reached, and un-dims as it advances", async () => {
    const dim = (svg: string) => (svg.match(/opacity="0\.35"/g) ?? []).length;
    const one = dim((await at(1)).svg!);
    const all = dim((await at(3)).svg!);
    expect(one).toBeGreaterThan(all);
    expect(dim((await at(undefined)).svg!)).toBe(0);
  });

  it("picks out the current hop and lets earlier ones recede", async () => {
    const two = (await at(2)).svg!;
    // the accent halo marks exactly one badge — the hop being narrated
    expect((two.match(/stroke-width="1\.5" opacity="0\.45"/g) ?? []).length).toBe(1);
    // and step 1's badge is still there, just quieter
    expect(two).toContain(`data-kind="flow-step" opacity="0.55"`);
  });

  it("stepping past the end is the finished diagram, not a broken one", async () => {
    const done = await at(99);
    expect(done.ok).toBe(true);
    expect(validateSVG(done.svg!).ok).toBe(true);
    expect(badges(done.svg!)).toBe(3);
  });

  it("counts hops visible here, not the flow's declared numbering", async () => {
    // The opening hops happen outside a scoped view — lifted away entirely.
    // Walking declared numbers would spend the first presses on frames where
    // nothing changes, so hop 1 must mean the first one actually on screen.
    const src = `pack aws
person customer "Customer"
gw = aws/api-gateway "Gateway"
system shop "Shop" {
  api = aws/lambda "API"
  db  = aws/dynamodb "Orders" datastore
  api -> db "write"
}
customer -> gw "opens"
gw -> shop.api "checkout"
flow buy "Buy" {
  customer -> gw -> shop.api
  shop.api -> shop.db
}
view inside {
  scope shop
  show flow buy
}
`;
    const whole = await render(src, { view: "inside", theme: "light" });
    // steps 1-2 are outside this scope; only 3 (gw → api, via context) and 4 draw
    expect(whole.flow!.steps).toBeLessThan(4);
    const first = await render(src, { view: "inside", theme: "light", flowStep: 1 });
    // hop 1 must show something — the bug this replaced rendered a blank frame
    expect((first.svg!.match(/data-kind="flow-step"/g) ?? []).length).toBe(1);
    const last = await render(src, {
      view: "inside", theme: "light", flowStep: whole.flow!.steps,
    });
    expect((last.svg!.match(/data-kind="flow-step"/g) ?? []).length).toBe(whole.flow!.steps);
  });

  it("step 0 shows the diagram with nothing narrated yet", async () => {
    const zero = await at(0);
    expect(validateSVG(zero.svg!).ok).toBe(true);
    expect(badges(zero.svg!)).toBe(0);
  });

  it("is deterministic per step", async () => {
    expect((await at(2)).svg).toBe((await at(2)).svg);
  });
});
