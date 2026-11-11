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

  it("is byte-identical to the leaf without fields in every view that opens no container holding it", async () => {
    // the restated invariant: writing fields never changes a view that does
    // not open the table's container (scoped or expanded) or preview it
    const plain = model(`{ }`);
    for (const view of ["landscape", "shop"])
      expect(await draw(model(), view)).toBe(await draw(plain, view));
  });

  it("a member of an expanded frame draws the compact list with no verb", async () => {
    const g = leafOf(await draw(model(), "opened"), "shop.db.orders");
    expect(rowsIn(g)).toBe(7); // six fields and the "+N more" row
    expect(g).toContain(">+2 more fields<");
    expect(g).not.toContain(">created_at<");
    expect(g).toMatch(/height="232"/); // 64 + 7 × 24
    // and `expand *` is the same frame
    const star = leafOf(await draw(model(undefined, "view star { include *\n expand * }"), "star"), "shop.db.orders");
    expect(rowsIn(star)).toBe(7);
  });

  it("never folds a single field: one over the automatic six shows them all", async () => {
    const seven = Array.from({ length: 7 }, (_, i) => `f${i} int`).join("\n      ");
    const g = leafOf(await draw(model(`{\n    fields {\n      ${seven}\n    }\n  }`), "opened"), "shop.db.orders");
    expect(rowsIn(g)).toBe(7);
    expect(g).not.toContain("more field");
  });

  it("`preview:` on the leaf picks the rows, in its order and as many as it lists; `none` keeps rows to the scoped view", async () => {
    const picked = model(`{\n    preview: [status id]\n    ${FIELDS}\n  }`);
    const g = leafOf(await draw(picked, "opened"), "shop.db.orders");
    expect(g.indexOf(">status<")).toBeLessThan(g.indexOf(">id<"));
    expect(g).toContain(">+6 more fields<");
    // a seven-name list of eight keeps its "+1": the count is the author's
    const seven = model(`{\n    preview: [id customer_id status total_cents currency notes created_at]\n    ${FIELDS}\n  }`);
    expect(leafOf(await draw(seven, "opened"), "shop.db.orders")).toContain(">+1 more field<");
    const none = model(`{\n    preview: none\n    ${FIELDS}\n  }`);
    expect(rowsIn(leafOf(await draw(none, "opened"), "shop.db.orders"))).toBe(0);
    expect(rowsIn(leafOf(await draw(none, "db"), "shop.db.orders"))).toBe(8);
  });

  it("`preview` reaches a top-level leaf and a `detail`ed one, and nothing else needs it", async () => {
    const top = `pack aws\nt = sys/table "t" { fields { id uuid pk\n n text } }\nx = aws/lambda "X"\nx -> t\n`;
    expect(rowsIn(leafOf(await draw(top + "view v { include * }", "v"), "t"))).toBe(0);
    expect(rowsIn(leafOf(await draw(top + "view v { include *\n preview t }", "v"), "t"))).toBe(2);
    expect(rowsIn(leafOf(await draw(top + "view v { include *\n preview * }", "v"), "t"))).toBe(2);
    // brought in at its own depth by `detail`, an explicit preview shows its rows
    const det = model(undefined, "view d { include *\n detail shop.db.orders\n preview shop.db.orders }");
    expect(rowsIn(leafOf(await draw(det, "d"), "shop.db.orders"))).toBe(7);
  });

  it("`preview <table>` beside `expand *` is not a conflict — only a container can be both", async () => {
    const r = await render(model(undefined, "view p { include *\n expand *\n preview shop.db.orders }"), { view: "p", theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.diagnostics?.map((d) => d.message)).toContain(
      "preview `shop.db.orders` is redundant — its container is open here, where its fields already draw");
    const c = await render(model(undefined, "view p { include *\n expand *\n preview shop }"), { view: "p", theme: "light" });
    expect(c.diagnostics?.find((d) => d.severity === "error")?.message)
      .toBe("preview `shop` and `expand *` in one view — a card is collapsed or open, not both");
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

  it("draws a caption on its row when it fits, and keeps it in a <title> when it does not", async () => {
    const src = model(`{\n    fields {\n      notes text nullable "free text"\n      shape "a very long type name that cannot possibly fit on one row of a leaf" "why"\n    }\n  }`);
    const g = leafOf(await draw(src, "db"), "shop.db.orders");
    expect(g).toContain(">free text<");
    expect(g).not.toContain("<title>text");
    // the long type is cut, so its row's caption gives way and both go to the tooltip
    expect(g).toContain("<title>a very long type name that cannot possibly fit on one row of a leaf\nwhy</title>");
    expect(g).toContain("…");
  });

  it("never lets a row leave the card: type, then extra markers, then the name give way", async () => {
    const src = model(`{\n    fields {\n      a_really_long_field_name_that_goes_on_and_on_forever string pk nullable unique index\n    }\n  }`);
    const svg = await draw(src, "db");
    const g = leafOf(svg, "shop.db.orders");
    // a row's hairline runs to one pixel inside the card's right edge
    const rightEdge = Number(/<line x1="\d+" y1="\d+" x2="(\d+)"/.exec(g)![1]) + 1;
    // every chip rect ends inside the card
    for (const r of g.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="1[34]"/g))
      expect(Number(r[1]) + Number(r[2])).toBeLessThanOrEqual(rightEdge - 12);
    expect(g).toContain(">+4<"); // the four markers folded
    expect(g).toContain("…"); // and the name cut
    expect(g).toContain("<title>a_really_long_field_name_that_goes_on_and_on_forever\npk nullable unique index\nstring</title>");
  });

  it("draws every marker alike — no word list", async () => {
    const g = leafOf(await draw(model(`{\n    fields {\n      id uuid pk\n      gate text nullable\n    }\n  }`), "db"), "shop.db.orders");
    expect((g.match(/height="14" rx="3"/g) ?? []).length).toBe(2);
    expect(g).not.toMatch(/rx="2.5"/);
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
      warns("view p { scope shop.db\n preview * }").then((m) =>
        expect(m).toContain("`preview *` detailed nothing — no cards are visible here")),
      warns("view p { scope shop.db\n preview orders }").then((m) =>
        expect(m).toContain("preview `shop.db.orders` is redundant — this view stands in its container, where every field already draws")),
      warns("view p { scope shop\n preview api }").then((m) =>
        expect(m).toContain("preview `shop.api` targets a leaf with no fields — only a container or a leaf with `fields` has rows to preview")),
    ]);
  });
});
