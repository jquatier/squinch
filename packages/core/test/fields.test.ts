// A leaf's schema rows (docs/notes/fields.md): where they draw, how many, and
// the guarantee that writing them changes no other picture.
import { describe, it, expect } from "vitest";
import { render } from "../src/index.js";
import { buildModel } from "../src/model/build.js";
import { validateSVG } from "../src/render/validate.js";

const FIELDS = `fields {
      id          uuid     pk
      customer_id uuid     fk ref customers
      status      enum(pending, paid, shipped)
      total_cents bigint
      currency    char(3)
      notes       varchar(500) nullable "free text"
      created_at  timestamptz
      updated_at  timestamptz
    }`;
const model = (orders = `{\n    ${FIELDS}\n  }`, views = "") => `pack aws
system shop "Shop" {
  api = aws/lambda "API"
  container db "Database" {
    customers = sys/table "customers" datastore
    orders = sys/table "orders" datastore ${orders}
  }
  api -> db.orders "writes"
}
caller = aws/lambda "Caller"
caller -> shop.api "calls"
view landscape { include * }
view db { scope shop.db }
view shop { scope shop }
view opened { scope shop\n expand db }
${views}`;
const draw = async (src: string, view: string, theme = "light") => {
  const r = await render(src, { view, theme });
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  expect(validateSVG(r.svg!).ok).toBe(true);
  return r.svg!;
};
/** The leaf's own group: from its data-path to the group after it. */
const leafOf = (svg: string, path: string) => {
  const at = svg.indexOf(`data-path="${path}"`);
  const end = svg.indexOf("<g data-path=", at + 1);
  return svg.slice(at, end === -1 ? undefined : end);
};
const rowsIn = (g: string) => (g.match(/<line [^>]*stroke-width="1"\/>/g) ?? []).length;

describe("fields: where a leaf's schema draws", () => {
  it("draws every field at home altitude — the view scoped to the leaf's container", async () => {
    const g = leafOf(await draw(model(), "db"), "shop.db.orders");
    expect(rowsIn(g)).toBe(8);
    expect(g).toContain(">customer_id<");
    expect(g).toContain(">updated_at<");
    expect(g).not.toContain("more field");
    // 64 head + 8 × 24 rows
    expect(g).toMatch(/height="256"/);
  });

  it("is byte-identical to the leaf without fields in every view that neither stands beside nor previews it", async () => {
    const plain = model(`{ }`);
    for (const view of ["landscape", "shop"])
      expect(await draw(model(), view)).toBe(await draw(plain, view));
    // and a frame member (its container opened, not stood in) is not home
    expect(await draw(model(), "opened")).toBe(await draw(plain, "opened"));
  });

  it("`preview` draws the first six declared, and counts the rest on a last row", async () => {
    const svg = await draw(model(undefined, "view p { scope shop\n expand db\n preview db.orders }"), "p");
    const g = leafOf(svg, "shop.db.orders");
    expect(rowsIn(g)).toBe(7); // six fields and the "+N more" row
    expect(g).toContain(">+2 more fields<");
    expect(g).not.toContain(">created_at<");
    expect(g).toMatch(/height="232"/); // 64 + 7 × 24
  });

  it("`preview:` on the leaf picks the rows, in its order; `none` keeps the leaf plain", async () => {
    const picked = model(`{\n    preview: [status id]\n    ${FIELDS}\n  }`, "view p { scope shop\n expand db\n preview db.orders }");
    const g = leafOf(await draw(picked, "p"), "shop.db.orders");
    expect(g.indexOf(">status<")).toBeLessThan(g.indexOf(">id<"));
    expect(g).toContain(">+6 more fields<");
    const none = model(`{\n    preview: none\n    ${FIELDS}\n  }`, "view p { scope shop\n expand db\n preview db.orders }");
    expect(rowsIn(leafOf(await draw(none, "p"), "shop.db.orders"))).toBe(0);
  });

  it("never draws rows on a context leaf", async () => {
    // `caller` is outside `shop`; from inside, it is scenery
    const src = model().replace(`caller = aws/lambda "Caller"`,
      `caller = sys/table "Caller" { fields { a int } }`);
    const g = leafOf(await draw(src, "shop"), "caller");
    expect(g).toContain(`data-kind="context-leaf"`);
    expect(rowsIn(g)).toBe(0);
  });

  it("draws a ref as an arrow path and text, never as a wire", async () => {
    const svg = await draw(model(), "db");
    const g = leafOf(svg, "shop.db.orders");
    expect(g).toMatch(/<path d="M\d+ \d+h7m-3-3l3 3l-3 3"/);
    expect(g).toContain(">customers<");
    // the one edge in this view is api -> orders, landing on the leaf's border
    expect((svg.match(/data-edge=/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("keeps the caption in a <title> on its row, and a cut type's full text with it", async () => {
    const src = model(`{\n    fields {\n      notes text nullable "free text"\n      shape "a very long type name that cannot possibly fit on one row of a leaf"\n    }\n  }`);
    const g = leafOf(await draw(src, "db"), "shop.db.orders");
    expect(g).toContain("<title>text\nfree text</title>");
    expect(g).toContain("<title>a very long type name that cannot possibly fit on one row of a leaf</title>");
    expect(g).toContain("…");
  });

  it("sits on the 8px grid at every row count", async () => {
    for (const n of [1, 2, 3, 5, 9]) {
      const lines = Array.from({ length: n }, (_, i) => `f${i} int`).join("\n      ");
      const svg = await draw(model(`{\n    fields {\n      ${lines}\n    }\n  }`), "db");
      const m = /data-path="shop\.db\.orders"[^>]*>\s*<rect [^>]*width="(\d+)" height="(\d+)"/.exec(svg)!;
      expect(Number(m[1]) % 8).toBe(0);
      expect(Number(m[2]) % 8).toBe(0);
    }
  });

  it("embeds the mono face only when a field row draws", async () => {
    expect(await draw(model(), "db")).toContain("font-family:SquinchMono");
    expect(await draw(model(), "landscape")).not.toContain("font-family:SquinchMono");
  });

  it("warns when `preview` names a leaf it cannot draw rows for, or one already at home", () => {
    const at = (v: string) => buildModel(model(undefined, v));
    const warns = async (v: string) => {
      const r = await render(model(undefined, v), { view: "p", theme: "light" });
      return (r.diagnostics ?? []).map((d) => d.message);
    };
    expect(at("").ok).toBe(true);
    return Promise.all([
      warns("view p { include *\n preview shop.db.orders }").then((m) =>
        expect(m).toContain("preview `shop.db.orders` is not among the leaves this view draws — no rows to show")),
      warns("view p { scope shop.db\n preview orders }").then((m) =>
        expect(m).toContain("preview `shop.db.orders` is redundant — this view stands in its container, where every field already draws")),
      warns("view p { scope shop\n preview api }").then((m) =>
        expect(m).toContain("preview `shop.api` targets a leaf with no fields — only a container or a leaf with `fields` has rows to preview")),
    ]);
  });
});
