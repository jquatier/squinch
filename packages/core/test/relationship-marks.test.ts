// Relationship marks in the model: `from:` / `to:` on an edge between two
// tables (SPEC §4). Every rule and every diagnostic for a wrong spelling —
// each has to give the location, the problem and the line to write.
import { describe, it, expect } from "vitest";
import { buildModel, diffModels, render } from "../src/index.js";

const BASE = `system shop "Shop" {
  container db "DB" {
    orders = sys/table "orders" {
      fields {
        id uuid pk
        customer_id uuid fk ref customers
        coupon_id uuid fk nullable ref coupons
      }
    }
    customers = sys/table "customers"
    coupons = sys/table "coupons"
    tags = sys/table "tags"
  }
}
person u "User"
`;
const LINE = BASE.split("\n").length; // the line the statement under test lands on
const build = (stmt: string) => buildModel(BASE + stmt + "\n");
const diags = (stmt: string) => build(stmt).diagnostics;
const O = "shop.db.orders", C = "shop.db.customers", K = "shop.db.coupons", T = "shop.db.tags";

/** Exactly one diagnostic, on the statement's line, and its fix. */
const only = (stmt: string, severity: "error" | "warning" = "error") => {
  const ds = diags(stmt);
  expect(ds.map((d) => `${d.severity}: ${d.message}`), stmt).toHaveLength(1);
  expect(ds[0].severity).toBe(severity);
  expect(ds[0].loc.line).toBe(LINE);
  return ds[0];
};

describe("relationship marks: the model", () => {
  it("reads the four lines the spec shows, with no diagnostics", () => {
    const { model, diagnostics } = build([
      `${O} -> ${C} "customer_id" { from: many to: one }`,
      `${O} -> ${K} "coupon_id" { from: many to: zero-or-one }`,
      `${O} -> ${T} "tag_id" { from: one-or-many to: exactly-one }`,
      `${C} -- ${T} { from: many to: many }`,
    ].join("\n"));
    expect(diagnostics).toEqual([]);
    expect(model.edges.map((e) => e.marks)).toEqual([
      { from: "many", to: "one" },
      { from: "many", to: "zero-or-one" },
      { from: "one-or-many", to: "exactly-one" },
      { from: "many", to: "many" },
    ]);
  });

  it("accepts all six words at either end", () => {
    for (const w of ["one", "many", "exactly-one", "zero-or-one", "one-or-many", "zero-or-many"]) {
      const { model, diagnostics } = build(`${C} -- ${T} { from: ${w} to: ${w} }`);
      expect(diagnostics, w).toEqual([]);
      expect(model.edges[0].marks).toEqual({ from: w, to: w });
    }
  });

  it("leaves an edge without the attributes exactly as it was", () => {
    const { model } = build(`${O} -> ${C} "customer_id"`);
    expect("marks" in model.edges[0]).toBe(false);
  });

  it("gives every target of a fan-out the same marks", () => {
    const { model, diagnostics } = build(`${O} -> ${C}, ${K} { from: many to: one }`);
    expect(diagnostics).toEqual([]);
    expect(model.edges.map((e) => e.marks?.to)).toEqual(["one", "one"]);
  });

  it("treats `style: solid` and `animate: false` as the plain edge they are", () => {
    expect(diags(`${O} -> ${C} { from: many to: one style: solid animate: false }`)).toEqual([]);
  });
});

describe("relationship marks: where they are legal", () => {
  it("one end alone is an error that writes both", () => {
    const a = only(`${O} -> ${C} { from: many }`);
    expect(a.message).toContain("`from:` without `to:`");
    expect(a.fix).toContain(`\`${O} -> ${C} { from: many to: one }\``);
    const b = only(`${O} -> ${C} "customer_id" { to: one }`);
    expect(b.message).toContain("`to:` without `from:`");
    expect(b.fix).toContain(`\`${O} -> ${C} "customer_id" { from: many to: one }\``);
    expect(build(`${O} -> ${C} { from: many }`).model.edges[0].marks).toBeUndefined();
  });

  it.each(["~>", "<->"])("refuses %s and writes the line with ->", (arrow) => {
    const d = only(`${O} ${arrow} ${C} { from: many to: one }`);
    expect(d.message).toContain("replace the arrowhead");
    expect(d.fix).toContain(`\`${O} -> ${C} { from: many to: one }\``);
  });

  it.each(["style: dotted", "animate: pulse"])("refuses %s on a marked edge", (attr) => {
    const d = only(`${O} -> ${C} { from: many to: one ${attr} }`);
    expect(d.message).toContain(`\`${attr}\``);
    expect(d.fix).toContain(`\`${O} -> ${C} { from: many to: one }\``);
    expect(build(`${O} -> ${C} { from: many to: one ${attr} }`).model.edges[0].marks).toBeUndefined();
  });

  it("refuses a container end and a person end", () => {
    const c = only(`${O} -> shop { from: many to: one }`);
    expect(c.message).toContain("`shop` is a system");
    expect(c.fix).toContain(`\`${O} -> shop\``);
    const p = only(`u -> ${C} { from: many to: one }`);
    expect(p.message).toContain("`u` is a person");
    expect(p.fix).toContain(`\`u -> ${C}\``);
    expect(build(`u -> ${C} { from: many to: one }`).model.edges[0].marks).toBeUndefined();
  });

  it("duplicates with different marks are an error, not a merge", () => {
    const ds = diags(`${O} -> ${C} "x" { from: many to: one }\n${O} -> ${C} "x" { from: many to: zero-or-one }`);
    expect(ds).toHaveLength(1);
    expect(ds[0].severity).toBe("error");
    expect(ds[0].loc.line).toBe(LINE + 1);
    expect(ds[0].message).toContain("declared twice with different relationship marks");
    expect(ds[0].message).toContain(`line ${LINE}`);
    // marked against unmarked is a difference too
    expect(diags(`${O} -> ${C} "x"\n${O} -> ${C} "x" { from: many to: one }`)[0].severity).toBe("error");
    // the same marks twice is the ordinary merge
    const same = diags(`${O} -> ${C} "x" { from: many to: one }\n${O} -> ${C} "x" { from: many to: one }`);
    expect(same.map((d) => d.severity)).toEqual(["warning"]);
    expect(same[0].message).toContain("merged");
  });
});

describe("relationship marks: against the column", () => {
  it("warns when the ends look swapped", () => {
    const d = only(`${O} -> ${C} "customer_id" { from: one to: many }`, "warning");
    expect(d.message).toContain("reads backwards");
    expect(d.fix).toContain("`{ from: many to: one }`");
    only(`${O} -> ${C} "customer_id" { from: zero-or-one to: one-or-many }`, "warning");
  });

  it("warns when a nullable key is marked as required", () => {
    const d = only(`${O} -> ${K} "coupon_id" { from: many to: exactly-one }`, "warning");
    expect(d.message).toContain("`nullable`");
    expect(d.fix).toContain("`to: zero-or-one`");
    expect(only(`${O} -> ${K} "coupon_id" { from: many to: one-or-many }`, "warning").fix).toContain("`to: zero-or-many`");
  });

  it("plain `one` never contradicts, and a column without `nullable` proves nothing", () => {
    expect(diags(`${O} -> ${K} "coupon_id" { from: many to: one }`)).toEqual([]);
    expect(diags(`${O} -> ${C} "customer_id" { from: many to: zero-or-one }`)).toEqual([]);
    expect(diags(`${O} -> ${C} "customer_id" { from: many to: exactly-one }`)).toEqual([]);
    expect(diags(`${O} -> ${C} "customer_id" { from: one to: one }`)).toEqual([]);
  });

  it("says nothing when the label is not that column", () => {
    expect(diags(`${O} -> ${C} "placed by" { from: one to: many }`)).toEqual([]);
    // the column exists but points somewhere else
    expect(diags(`${O} -> ${T} "customer_id" { from: one to: many }`)).toEqual([]);
  });
});

describe("relationship marks: what agents write instead", () => {
  it("`zero-or-more` names the word", () => {
    const d = only(`${O} -> ${C} { from: zero-or-more to: one }`);
    expect(d.message).toBe("unknown relationship mark `from: zero-or-more`");
    expect(d.fix).toContain(`\`${O} -> ${C} { from: zero-or-many to: one }\``);
    expect(only(`${O} -> ${C} { from: many to: on }`).fix).toContain("{ from: many to: one }");
  });

  it.each([
    ["from: 0..* to: 1", "from: zero-or-many to: one", "`0..*` is a UML range"],
    ["from: 1..n to: 0..1", "from: one-or-many to: zero-or-one", "`1..n` is a UML range"],
    ["from: many to: 0..1", "from: many to: zero-or-one", "`0..1` is a UML range"],
    ["from: * to: one", "from: many to: one", "`*` is not a relationship mark"],
  ])("`%s` is one error with the corrected line", (wrote, fixed, says) => {
    const d = only(`${O} -> ${C} "customer_id" { ${wrote} }`);
    expect(d.message).toContain(says);
    expect(d.fix).toContain(`\`${O} -> ${C} "customer_id" { ${fixed} }\``);
  });

  it("`cardinality: many-to-one` is an error that writes both ends", () => {
    const d = only(`${O} -> ${C} { cardinality: many-to-one }`);
    expect(d.message).toContain("`cardinality:` is not an edge attribute");
    expect(d.fix).toContain(`\`${O} -> ${C} { from: many to: one }\``);
    expect(only(`${O} -> ${C} { cardinality: one-to-many }`).fix).toContain("{ from: one to: many }");
  });

  it("marks outside the braces", () => {
    const d = only(`${O} -> ${C} "customer_id" from many to one`);
    expect(d.message).toContain("go in the edge's braces");
    expect(d.fix).toBe(`write \`${O} -> ${C} "customer_id" { from: many to: one }\``);
  });

  it("`from: east` points at `route`", () => {
    const d = only(`${O} -> ${C} { from: east to: one }`);
    expect(d.message).toContain("`east` is a side");
    expect(d.fix).toContain(`\`route ${O} -> ${C} from east\``);
  });

  it("`route … from: north` drops the colon", () => {
    const ds = diags(`${O} -> ${C}\nview v { layout { route ${O} -> ${C} from: north to: south } }`);
    expect(ds.map((d) => d.message)).toHaveLength(1);
    expect(ds[0].loc.line).toBe(LINE + 1);
    expect(ds[0].message).toContain("`route` names its sides without a colon");
    expect(ds[0].fix).toBe(`write \`route ${O} -> ${C} from north to south\``);
  });

  it("Mermaid operators become a squinch edge, many side first", () => {
    const d = only(`${O} }o--|| ${C}`);
    expect(d.message).toContain("`}o--||` is Mermaid");
    expect(d.fix).toBe(`write \`${O} -> ${C} { from: zero-or-many to: exactly-one }\``);
    const r = only(`${C} ||--o{ ${O} : places`);
    expect(r.fix).toBe(`write \`${O} -> ${C} "places" { from: zero-or-many to: exactly-one }\``);
    expect(only(`${C} }|..|{ ${T}`).fix).toBe(`write \`${C} -- ${T} { from: one-or-many to: one-or-many }\``);
  });

  it("a Mermaid line does not bury the lines after it", () => {
    const ds = diags(`${C} ||--o{ ${O} : places\n${O} -> ${K} "coupon_id" { from: many to: one }`);
    expect(ds.map((d) => d.message)).toHaveLength(1);
  });
});

describe("relationship marks: the semantic diff", () => {
  const model = (stmt: string) => build(stmt).model;
  it("a changed mark is structural", () => {
    const d = diffModels(model(`${O} -> ${C} { from: many to: one }`), model(`${O} -> ${C} { from: many to: zero-or-one }`));
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]).toMatchObject({
      kind: "changed", weight: "structural", subject: "edge",
      before: "many to one", after: "many to zero-or-one",
    });
  });
  it("adding or removing marks is structural; the same marks are no change", () => {
    const plain = model(`${O} -> ${C}`), marked = model(`${O} -> ${C} { from: many to: one }`);
    expect(diffModels(plain, marked).changes[0]).toMatchObject({ weight: "structural", before: "(none)", after: "many to one" });
    expect(diffModels(marked, plain).changes[0]).toMatchObject({ weight: "structural", after: "(none)" });
    expect(diffModels(marked, model(`${O} -> ${C} { from: many to: one }`)).changes).toEqual([]);
  });
});

describe("relationship marks: nothing is drawn yet", () => {
  it("a marked edge renders byte-identically to the plain one", async () => {
    const a = await render(BASE + `${O} -> ${C} "customer_id"\nview v { scope shop.db }\n`, { theme: "light", view: "v" });
    const b = await render(BASE + `${O} -> ${C} "customer_id" { from: many to: one }\nview v { scope shop.db }\n`, { theme: "light", view: "v" });
    expect(a.ok && b.ok).toBe(true);
    expect(b.svg).toBe(a.svg);
  });
});

// What the independent review of this gate found: the wrong spellings were
// only tested as the last line of a file, where nothing follows to cascade
// into. Every one is tested here in the middle of a file, inside a container
// body, and with the fix pasted back.
describe("relationship marks: one mistake, one diagnostic, wherever it sits", () => {
  const WRONG: [string, string][] = [
    [`orders -> customers "customer_id" from many to one`, `orders -> customers "customer_id" { from: many to: one }`],
    [`orders -> customers "customer_id" from many to one  // n:1`, `orders -> customers "customer_id" { from: many to: one }`],
    [`orders -> customers, coupons from many to one`, `orders -> customers, coupons { from: many to: one }`],
    [`orders -> customers #pci from many to one`, `orders -> customers { from: many to: one } #pci`],
    [`orders }o--|| customers`, `orders -> customers { from: zero-or-many to: exactly-one }`],
    [`customers ||--o{ orders : places`, `orders -> customers "places" { from: zero-or-many to: exactly-one }`],
    [`customers ||--|{ orders : "places"`, `orders -> customers "places" { from: one-or-many to: exactly-one }`],
    [`orders -> customers { from: 0..* to: 1 }`, `orders -> customers { from: zero-or-many to: one }`],
    [`orders -> customers { from: 1 to: n }`, `orders -> customers { from: one to: many }`],
    [`orders -> customers { from: zero-or-more to: 1 }`, `orders -> customers { from: zero-or-many to: one }`],
    [`orders -> customers { from: Many to: ONE }`, `orders -> customers { from: many to: one }`],
    [`orders -> customers { cardinality: 1:n }`, `orders -> customers { from: one to: many }`],
    [`orders -> customers { cardinality: 1-to-n style: dotted }`, `orders -> customers { from: one to: many }`],
    [`orders -> customers { multiplicity: "N:1" }`, `orders -> customers { from: many to: one }`],
    [`orders -> customers { relationship: many-to-many }`, `orders -> customers { from: many to: many }`],
    [`orders ~> customers { from: many }`, `orders -> customers { from: many to: one }`],
    [`orders <-> customers { from: 0..* to: 1 }`, `orders -> customers { from: zero-or-many to: one }`],
    [`orders -> customers { from: 1..* to: one style: dashed }`, `orders -> customers { from: one-or-many to: one }`],
    [`orders -> customers { from: many to: one color: red animate: pulse }`, `orders -> customers { from: many to: one color: red }`],
  ];
  const inBody = (stmt: string) => `system shop "Shop" {
  container db "DB" {
    orders = sys/table "orders"
    customers = sys/table "customers"
    ${stmt}
    coupons = sys/table "coupons"
    orders -> coupons "coupon_id"
  }
  api = sys/server "API"
  api -> db.orders "writes"
}
view v {
  scope shop.db
}
`;
  it.each(WRONG)("%s", (wrote, fixed) => {
    const ds = buildModel(inBody(wrote)).diagnostics;
    expect(ds.map((d) => `${d.loc.line}: ${d.message}`), wrote).toHaveLength(1);
    expect(ds[0].severity).toBe("error");
    expect(ds[0].loc.line).toBe(5);
    expect(ds[0].fix).toContain(`\`${fixed}\``);
    // the line it writes checks clean where the mistake stood
    expect(buildModel(inBody(fixed)).diagnostics, fixed).toEqual([]);
  });

  it("a multi-line attribute block with ranges is one error", () => {
    const ds = buildModel(inBody(`orders -> customers {\n      from: 0..*\n      to: 1\n    }`)).diagnostics;
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toContain("`0..*` is a UML range");
    expect(ds[0].fix).toContain("`orders -> customers { from: zero-or-many to: one }`");
  });

  it("hyphenated ids", () => {
    const src = (stmt: string) => `order-items = sys/table "order_items"\nline-items = sys/table "line_items"\n${stmt}\norder-items -> line-items "after"\n`;
    for (const [wrote, fixed] of [
      ["order-items -> line-items { from: 1..* to: 1 }", "order-items -> line-items { from: one-or-many to: one }"],
      ["order-items -> line-items from many to one", "order-items -> line-items { from: many to: one }"],
      ["order-items }o--|| line-items", "order-items -> line-items { from: zero-or-many to: exactly-one }"],
    ]) {
      const ds = buildModel(src(wrote)).diagnostics;
      expect(ds.map((d) => d.message), wrote).toHaveLength(1);
      expect(ds[0].fix).toContain(`\`${fixed}\``);
    }
  });

  it("two sides are one error with one route line", () => {
    const ds = diags(`${O} -> ${C} { from: east to: west }`);
    expect(ds).toHaveLength(1);
    expect(ds[0].fix).toContain(`\`route ${O} -> ${C} from east to west\``);
  });

  it("a value with no translation lists the words instead of guessing", () => {
    const d = only(`${O} -> ${C} { from: 0..many to: 2..5 }`);
    expect(d.message).toContain("`0..many` is a UML range");
    expect(d.fix).toBe("each end is one of: one, many, exactly-one, zero-or-one, one-or-many, zero-or-many");
  });

  it("a refused line followed by the right one is one error, not a duplicate too", () => {
    const ds = diags(`${O} -> ${C} "x" { from: many }\n${O} -> ${C} "x" { from: many to: one }`);
    expect(ds.map((d) => d.message)).toHaveLength(1);
    expect(ds[0].loc.line).toBe(LINE);
  });

  it("a fan-out from a person says it once", () => {
    expect(diags(`u -> ${C}, ${K} { from: one to: many }`)).toHaveLength(1);
  });

  it("`--` written both ways round with different marks is caught; mirrored is the same", () => {
    const ds = diags(`${C} -- ${T} { from: many to: one }\n${T} -- ${C} { from: many to: one }`);
    expect(ds.map((d) => d.severity)).toEqual(["error"]);
    expect(ds[0].message).toContain("declared twice with different relationship marks");
    expect(diags(`${C} -- ${T} { from: many to: one }\n${T} -- ${C} { from: one to: many }`)).toEqual([]);
    // unmarked edges both ways are untouched
    expect(diags(`${C} -- ${T}\n${T} -- ${C}`)).toEqual([]);
  });
});

describe("relationship marks: the repair leaves valid text alone", () => {
  const BROKEN = `${T} -> ${K} "x" "y"`; // an unrelated syntax error, so the old heuristics would run
  it.each([
    `route = sys/server "Router"\nroute -> ${C} "forwards to: the customers table"\n${O} -> route "reads from: replica" { style: dotted }`,
    `// route a -> b from: north\n${O} -> ${C}`,
    `${O} -> ${C} { style: dotted } // from: 0..* to: 1`,
    `${O} -> ${C} "from: 0..* to: 1..n"`,
    `// ${O} }o--|| ${C}\n// a -> b from many to one\n${O} -> ${C}`,
    `from = sys/table "from"\nto = sys/table "to"\nfrom -> to { from: many to: one }`,
    `${O} -> ${C} { description: "from: 0..* to: *" }`,
  ])("%s", (valid) => {
    expect(buildModel(BASE + valid + "\n").diagnostics).toEqual([]);
    // and with a real error elsewhere, that error is still the only one
    const ds = buildModel(BASE + valid + "\n" + BROKEN + "\n").diagnostics;
    expect(ds.map((d) => d.message)).toHaveLength(1);
    expect(ds[0].message).toContain("syntax error");
  });

  it("a valid route with sides, and one with colons, in a view", () => {
    const view = (r: string) => `${O} -> ${C}\nview v {\n  scope shop.db\n  layout {\n    ${r}\n  }\n}`;
    expect(diags(view(`route ${O} -> ${C} from south to north`)).filter((d) => d.severity === "error")).toEqual([]);
    const ds = diags(view(`route ${O} -> ${C} from: south to: north`)).filter((d) => d.severity === "error");
    expect(ds).toHaveLength(1);
    expect(ds[0].fix).toBe(`write \`route ${O} -> ${C} from south to north\``);
  });

  it("a Mermaid line does not hide a real error after it", () => {
    const ds = diags(`${C} ||--o{ ${O} : places\n${O} -> ${K}\n${BROKEN}`);
    expect(ds.map((d) => d.loc.line)).toEqual([LINE, LINE + 2]);
  });

  it("short unknown keys are not told they meant `to`", () => {
    for (const key of ["tls", "on", "ttl", "ip"]) {
      const d = only(`${O} -> ${C} { ${key}: x }`, "warning");
      expect(d.fix, key).not.toContain("did you mean `to`");
    }
    expect(only(`${O} -> ${C} { form: many }`, "warning").fix).toContain("did you mean `from`");
  });
});

// The second review: the value repair rewrote anything that was not a word,
// which broke valid field lines and `;`-separated attributes.
describe("relationship marks: the repair only touches another notation", () => {
  it("returns valid text untouched, byte for byte", async () => {
    const { repairMarks } = await import("../src/model/marks.js");
    for (const valid of [
      `t = sys/table "t" {\n  fields {\n    to: numeric(10,2)\n    from: timestamp(6); to: timestamp(6)\n    valid-to: numeric(10,2) nullable\n    range struct<from: decimal(10,2), to: date>\n    to : map<string,int>\n  }\n}`,
      `a -> b { from: many; to: one }`,
      `a -> b {\n  from: many;\n  to: one;\n}`,
      `n = box "N" { to: abc; color: red }`,
      `n = box "N" { relation: [a b] }`,
      `titleblock { version: 1.2.3  date: 2026-11-17  to: "x" }`,
      `route from -> to from north to south`,
      `n = box "N" { link: "https://example.com/?from=1..n" }`,
    ]) {
      const r = repairMarks(valid);
      expect(r.src, valid).toBe(valid);
      expect(r.notes).toEqual([]);
    }
  });

  it("always returns the length it was given", async () => {
    const { repairMarks } = await import("../src/model/marks.js");
    for (const s of [
      `a }o--|| b : has "x" {`, `a -> b from many to one #pci`, `a -> b { from: 0..* to: * }`,
      `route a -> b "l" from: north to: south`, `a -> b { cardinality: 1:n }  // to: 0..1`, `x\r\ny }|..|{ z\r\n`,
    ])
      expect(repairMarks(s).src.length, s).toBe(s.length);
  });

  it("`;` between the two marks is the separator it always was", () => {
    const { model, diagnostics } = build(`${O} -> ${C} { from: many; to: one }`);
    expect(diagnostics).toEqual([]);
    expect(model.edges[0].marks).toEqual({ from: "many", to: "one" });
  });

  it("a field named `to` with a bracketed type still checks clean", () => {
    const { diagnostics } = buildModel(`t = sys/table "t" {\n  fields {\n    id uuid pk\n    to: numeric(10,2)\n  }\n}\nview v { preview t }\n`);
    expect(diagnostics.filter((d) => d.message.includes("field line"))).toEqual([]);
  });

  it("letter-led ranges are one error", () => {
    expect(only(`${O} -> ${C} { from: n..m to: 1 }`).message).toContain("unknown relationship mark `from: n..m`");
  });

  it("a tag after unbraced marks, and the right line after the wrong one", () => {
    expect(only(`${O} -> ${C} from many to one #pci`).fix).toBe(`write \`${O} -> ${C} { from: many to: one } #pci\``);
    const ds = diags(`${O} -> ${C} from many to one\n${O} -> ${C} { from: many to: one }`);
    expect(ds.map((d) => d.message)).toHaveLength(1);
  });

  it("one attribute in other casings; an untranslatable one writes no guess", () => {
    for (const v of ["one_to_many", "OneToMany", `"one to many"`])
      expect(only(`${O} -> ${C} { cardinality: ${v} }`).fix, v).toContain("{ from: one to: many }");
    const d = only(`${O} -> ${C} { cardinality: sometimes }`);
    expect(d.fix).not.toContain("from: many to: one");
    expect(d.fix).toContain("write `from:` and `to:` instead");
  });

  it("the route line for a side names full paths, so it resolves in a view", () => {
    const src = `system shop "Shop" {\n  container db "DB" {\n    orders = sys/table "o"\n    customers = sys/table "c"\n    orders -> customers { from: east }\n  }\n}\n`;
    expect(buildModel(src).diagnostics[0].fix).toContain("`route shop.db.orders -> shop.db.customers from east`");
  });

  it("a Mermaid label with quotes or a trailing brace still writes a line that parses", () => {
    const fix = only(`${O} }o--|| ${C} : has "quoted" thing {`).fix!;
    expect(fix).toBe(`write \`${O} -> ${C} "has quoted thing" { from: zero-or-many to: exactly-one }\``);
    expect(diags(fix.slice(7, -1))).toEqual([]);
  });

  it("a route with a label and colons", () => {
    const ds = diags(`${O} -> ${C} "reads"\nview v {\n  scope shop.db\n  layout {\n    route ${O} -> ${C} "reads" from: north\n  }\n}`).filter((d) => d.severity === "error");
    expect(ds.map((d) => d.message)).toEqual(["`route` names its sides without a colon — `from:` and `to:` are an edge's relationship marks"]);
  });
});
