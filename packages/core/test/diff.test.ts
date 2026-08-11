// Semantic diff: what changed in the architecture, not in the file.
import { describe, it, expect } from "vitest";
import { buildModel, diffModels, diffProjects, formatDiff, formatDiffMarkdown } from "../src/index.js";

const diff = (a: string, b: string) => diffModels(buildModel(a).model, buildModel(b).model);

const BASE = `pack aws
system orders "Orders" {
  api = aws/lambda "API"
  db  = aws/dynamodb "Orders DB" datastore
  api -> db "writes"
}
system ship "Shipping" {
  api = aws/lambda "API"
}
orders.api -> ship.api "books"
view landscape {
  include *
  layout { rows [orders] [ship] }
}
`;

describe("diff — structure", () => {
  it("reports added systems, nodes and edges as structural", () => {
    const after = BASE.replace(
      `system ship "Shipping" {`,
      `system pay "Payments" {\n  api = aws/lambda "Pay API"\n}\nsystem ship "Shipping" {`,
    ).replace(`orders.api -> ship.api "books"`, `orders.api -> ship.api "books"\norders.api -> pay.api "charge"`);
    const d = diff(BASE, after);
    expect(d.same).toBe(false);
    expect(d.cosmetic).toBe(0);
    const kinds = d.changes.map((c) => `${c.kind} ${c.subject}`);
    expect(kinds).toContain("added system");
    expect(kinds).toContain("added node");
    expect(kinds).toContain("added edge");
  });

  it("reports removals", () => {
    const after = BASE.replace(`  api -> db "writes"\n`, "");
    const d = diff(BASE, after);
    const removed = d.changes.find((c) => c.kind === "removed" && c.subject === "edge")!;
    expect(removed.weight).toBe("structural");
    expect(removed.detail).toContain("orders.api");
  });

  it("sync → async on the same pair is one change, not a delete plus an add", () => {
    const d = diff(BASE, BASE.replace(`orders.api -> ship.api`, `orders.api ~> ship.api`));
    const edges = d.changes.filter((c) => c.subject === "edge");
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("changed");
    expect(edges[0].before).toBe("->");
    expect(edges[0].after).toBe("async");
  });

  it("separates cosmetic label changes from structural ones", () => {
    const d = diff(BASE, BASE.replace(`"Orders DB"`, `"Products"`));
    expect(d.structural).toBe(0);
    expect(d.cosmetic).toBe(1);
    expect(d.changes[0].detail).toContain("label");
  });

  it("treats tag and icon changes as structural", () => {
    const tagged = diff(BASE, BASE.replace(`db  = aws/dynamodb "Orders DB" datastore`,
      `db  = aws/dynamodb "Orders DB" datastore { tags: #pci }`));
    expect(tagged.structural).toBe(1);
    const icon = diff(BASE, BASE.replace("db  = aws/dynamodb", "db  = aws/aurora"));
    expect(icon.changes.find((c) => c.detail.includes("icon"))?.weight).toBe("structural");
  });
});

describe("diff — zones, flows, views", () => {
  const withZone = BASE + `zone vpc1 "VPC" vpc {\n  contains orders\n}\n`;

  it("tracks zone membership", () => {
    const d = diff(withZone, withZone.replace("contains orders", "contains orders, ship"));
    const z = d.changes.find((c) => c.subject === "zone")!;
    expect(z.weight).toBe("structural");
    expect(z.after).toContain("+ship");
  });

  it("tracks flow steps", () => {
    // full paths: `api` alone is ambiguous here, and the compiler says so
    const withFlow = BASE + `flow f "F" {\n  orders.api -> orders.db\n}\n`;
    const d = diff(
      withFlow,
      withFlow.replace("orders.api -> orders.db", "orders.api -> orders.db\n  orders.api -> ship.api"),
    );
    expect(d.changes.find((c) => c.subject === "flow")?.weight).toBe("structural");
  });

  it("a view that hides something is structural; restyling is cosmetic", () => {
    const hidden = diff(BASE, BASE.replace("  include *", "  include *\n  exclude ship"));
    expect(hidden.changes.find((c) => c.subject === "view")?.weight).toBe("structural");
    const styled = diff(BASE, BASE.replace("  include *", `  include *\n  title "Landscape"`));
    expect(styled.changes.find((c) => c.subject === "view")?.weight).toBe("cosmetic");
  });
});

describe("diff — trustworthiness", () => {
  it("ignores edits that only move source offsets", () => {
    // hints carry loc offsets; inserting text above a view must not invent a
    // "presentation change" — a false positive here teaches people to ignore it
    expect(diff(BASE, `// a new comment\n${BASE}`).same).toBe(true);
    expect(diff(BASE, BASE.replace("pack aws", "pack aws\n\n")).same).toBe(true);
  });

  it("identical input is identical output", () => {
    const d = diff(BASE, BASE);
    expect(d.same).toBe(true);
    expect(formatDiff(d)).toBe("no semantic changes");
  });

  it("hints at a likely rename instead of guessing", () => {
    const renamed = BASE.replace("db  = aws/dynamodb", "store = aws/dynamodb")
      .replace("api -> db ", "api -> store ");
    const d = diff(BASE, renamed);
    const added = d.changes.find((c) => c.kind === "added" && c.subject === "node")!;
    expect(added.note).toContain("possible rename of orders.db");
    // still reported as add + remove — a wrong rename guess is worse than verbose
    expect(d.changes.some((c) => c.kind === "removed" && c.id === "orders.db")).toBe(true);
  });

  it("orders deterministically, structural first", () => {
    const after = BASE.replace(`"Orders DB"`, `"Products"`)
      .replace(`orders.api -> ship.api "books"`, `orders.api ~> ship.api "books"`);
    const d = diff(BASE, after);
    expect(d.changes[0].weight).toBe("structural");
    expect(d.changes.at(-1)!.weight).toBe("cosmetic");
    expect(diff(BASE, after)).toEqual(d); // stable across runs
  });
});

describe("diff — every view axis is fingerprinted", () => {
  // `only` and `detail` shipped and the diff never learned about them, so
  // narrowing a view to `#pci` — the most visibility-changing edit the language
  // has — reported "no change". A fingerprint over half the axes answers the
  // wrong question, silently. One case per field so the next verb cannot be
  // added without this list failing.
  const V = `pack aws
system s "S" {
  a = aws/lambda "A" { tags: #pci }
  b = aws/lambda "B"
  c = aws/dynamodb "C" datastore
  a -> c
  b -> c
}
system other "Other" { x = aws/lambda "X" }
s.a -> other.x
view v {
  scope s
LAYOUT}
`;
  const withStmt = (stmt: string) => V.replace("LAYOUT", stmt ? `  ${stmt}\n` : "");

  for (const [field, stmt] of [
    ["only", "only #pci"],
    ["detail", "detail other.x"],
    ["include", "include other.x"],
    ["exclude", "exclude b"],
    ["expand", "expand other"],
    ["expand *", "expand *"],
  ] as const)
    it(`sees a change in \`${field}\``, () => {
      const d = diff(withStmt(""), withStmt(stmt));
      expect(d.same, `adding \`${stmt}\` reported no change`).toBe(false);
      // and classified as structural, not cosmetic — it changes what a reader sees
      expect(d.changes.some((c) => c.detail.includes("changes what is visible"))).toBe(true);
    });

  for (const [field, stmt] of [
    ["cols", "layout { cols [a] [b] }"],
    ["channels", "layout { channel a, b -> c }"],
    ["rows", "layout { rows [a] [b] }"],
  ] as const)
    it(`sees a change in \`${field}\``, () => {
      const d = diff(withStmt(""), withStmt(stmt));
      expect(d.same, `adding \`${stmt}\` reported no change`).toBe(false);
    });
});

describe("diff — formatting", () => {
  it("renders text and markdown reports", () => {
    const d = diff(BASE, BASE.replace(`orders.api -> ship.api`, `orders.api ~> ship.api`));
    const text = formatDiff(d);
    expect(text).toContain("structural");
    expect(text).toContain("1 structural, 0 cosmetic");
    const md = formatDiffMarkdown(d);
    expect(md).toContain("**Squinch**");
    expect(md).toContain("### structural");
  });
});

describe("styling attrs are visible to diff", () => {
  it("an animate change reads as a cosmetic edge change", () => {
    const before = `a = box "A"\nb = box "B"\na ~> b "ev"\n`;
    const after = `a = box "A"\nb = box "B"\na ~> b "ev" { animate: packets }\n`;
    const d = diffProjects(
      [{ name: "x", src: before }],
      [{ name: "x", src: after }],
    );
    const hit = d.changes.find((c) => c.detail?.includes("animate"));
    expect(hit, JSON.stringify(d.changes)).toBeTruthy();
    expect(hit!.weight).toBe("cosmetic");
    expect(hit!.before).toBe("(default)");
    expect(hit!.after).toBe("packets");
  });
});
