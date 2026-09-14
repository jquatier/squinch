import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { buildModel } from "../src/model/build.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const canonical = readFileSync(join(pkg, "examples/orders.squinch"), "utf8");

describe("grammar + model builder", () => {
  it("warns when a dashed sync edge wears the async convention", () => {
    const src = `pack aws\nsystem s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n c = aws/lambda "C"\n a -> b { style: dashed }\n b ~> c\n}`;
    const msgs = buildModel(src).diagnostics.map((d) => d.message);
    expect(msgs).toContainEqual(expect.stringContaining("indistinguishable from an async one"));
    // dotted is the sanctioned alternative; and without async edges there is nothing to collide with
    expect(buildModel(src.replace("dashed", "dotted")).diagnostics.map((d) => d.message))
      .not.toContainEqual(expect.stringContaining("indistinguishable"));
    expect(buildModel(src.replace(" b ~> c\n", "")).diagnostics.map((d) => d.message))
      .not.toContainEqual(expect.stringContaining("indistinguishable"));
  });

  describe("`subtitle:` — a leaf's short second line (2026-09)", () => {
    const leaf = (attrs: string) =>
      buildModel(`pack aws\nsystem s "S" {\n a = aws/lambda "A" ${attrs}\n}`);

    it("is the node's own field, not a bag entry", () => {
      const r = leaf(`{ subtitle: "Lambda · Node 20" }`);
      expect(r.diagnostics).toEqual([]);
      expect(r.model.nodes.get("s.a")!.subtitle).toBe("Lambda · Node 20");
      expect(r.model.nodes.get("s.a")!.attrs).toEqual({});
    });

    it("an unknown node attribute warns, keeps the key, and the C4 names point at subtitle", () => {
      for (const key of ["tech", "technology", "caption"]) {
        const r = leaf(`{ ${key}: "Lambda" }`);
        expect(r.ok).toBe(true);
        const w = r.diagnostics.find((d) => d.message.includes("unknown node attribute"))!;
        expect(w.severity).toBe("warning");
        expect(w.message).toBe(`unknown node attribute \`${key}\``);
        expect(w.fix).toBe("did you mean `subtitle`?");
        expect(r.model.nodes.get("s.a")!.attrs[key]).toBe("Lambda"); // kept for hover cards
      }
      expect(leaf(`{ subtitel: "x" }`).diagnostics[0].fix).toBe("did you mean `subtitle`?");
      expect(leaf(`{ owner: team }`).diagnostics[0].fix).toContain("one of: description, subtitle");
    });

    it("is refused on a container and on a person, naming the field that does that job", () => {
      const c = buildModel(`pack aws\nsystem s "S" {\n subtitle: "x"\n a = aws/lambda "A"\n}`);
      expect(c.ok).toBe(true);
      const cw = c.diagnostics.find((d) => d.message.includes("leaf attribute"))!;
      expect(cw.fix).toContain("description:");
      const p = buildModel(`pack aws\nu = person "User" { subtitle: "x" }\n`);
      const pw = p.diagnostics.find((d) => d.message.includes("leaf attribute"))!;
      expect(pw.message).toBe("`subtitle` is a leaf attribute");
      expect(p.model.nodes.get("u")!.subtitle).toBeUndefined();
    });

    it("warns past 24 characters — it is one line, and it widens the card", () => {
      const of = (s: string) => leaf(`{ subtitle: "${s}" }`).diagnostics.filter((d) => d.message.includes("cut off"));
      expect(of("x".repeat(24))).toEqual([]);
      const long = of("x".repeat(25));
      expect(long.length).toBe(1);
      expect(long[0].severity).toBe("warning");
      expect(long[0].message).toBe("subtitle is 25 characters — it will be cut off");
      expect(long[0].fix).toContain("description:");
    });
  });

  describe("attribute keys are checked on every block (2026-09)", () => {
    const warnings = (src: string) => {
      const r = buildModel(src);
      expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true); // never an error
      return r.diagnostics.filter((d) => d.severity === "warning");
    };

    it("container: unknown keys warn, and the ownership words point at domain:", () => {
      const of = (attr: string) => warnings(`pack aws\nsystem s "S" {\n ${attr}\n a = aws/lambda "A"\n}`);
      expect(of(`domain: "orders"`)).toEqual([]);
      const owner = of(`owner: team-orders`)[0];
      expect(owner.message).toBe("unknown container attribute `owner`");
      expect(owner.fix).toBe("did you mean `domain`?");
      expect(of(`glyp: sys/code`)[0].fix).toBe("did you mean `glyph`?");
      expect(of(`status: live`)[0].fix).toContain("one of: description, icon, glyph, domain");
    });

    it("zone: unknown keys warn, and a description is named as one", () => {
      const of = (attr: string) =>
        warnings(`pack aws\na = aws/lambda "A"\nzone v "VPC" vpc {\n contains a\n ${attr}\n}`);
      expect(of(`detail: "10.0.0.0/16"`)).toEqual([]);
      expect(of(`lable: bottom-right`)[0].fix).toBe("did you mean `label`?");
      const desc = of(`description: "prod network"`)[0];
      expect(desc.message).toBe("unknown zone attribute `description`");
      expect(desc.fix).toContain("detail:");
    });

    it("note: the one attr and its one value", () => {
      const of = (attrs: string) =>
        warnings(`pack aws\na = aws/lambda "A"\nview v {\n note top-right "Q3" { ${attrs} }\n}`);
      expect(of(`style: warning`)).toEqual([]);
      expect(of(`style: warn`)[0].message).toBe("unknown note style `warn`");
      expect(of(`style: warn`)[0].fix).toBe("did you mean `warning`?");
      expect(of(`colour: red`)[0].message).toBe("unknown note attribute `colour`");
    });
  });

  it("builds the canonical example", () => {
    const r = buildModel(canonical);
    expect(r.ok).toBe(true);
    expect(r.model.nodes.size).toBe(8);
    expect(r.model.containers.size).toBe(1);
    expect(r.model.edges.length).toBe(9); // fan-outs expanded
    expect(r.model.views[0].scope).toBe("orders");
    expect(r.model.views[0].layout.rows?.length).toBe(3);
  });

  it("parses unspaced arrows (a->b)", () => {
    const r = buildModel(`system s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n a->b\n}`);
    expect(r.ok).toBe(true);
    expect(r.model.edges.length).toBe(1);
  });

  it("did-you-mean on unknown icon", () => {
    const r = buildModel(`pack aws\nsystem s "S" {\n fn = aws/lambd "Fn"\n}`);
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((d) => d.message.includes("unknown icon"));
    expect(d?.fix).toContain("aws/lambda");
  });

  it("did-you-mean on unknown edge target", () => {
    const r = buildModel(
      `system s "S" {\n db = aws/dynamodb "DB"\n fn = aws/lambda "Fn"\n fn -> dbb\n}`,
    );
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((d) => d.message.includes("unknown id"));
    expect(d?.fix).toContain("db");
  });

  it("suggests the full path when only a nested id matches", () => {
    const r = buildModel(
      `system a "A" {\n container inner "In" {\n  create = aws/lambda "C"\n }\n x = aws/lambda "X"\n x -> create\n}`,
    );
    expect(r.ok).toBe(false);
    // a bare `create` suggestion would read as a no-op fix
    expect(r.diagnostics[0].fix).toContain("a.inner.create");
  });

  it("errors on duplicate ids", () => {
    const r = buildModel(`system s "S" {\n a = aws/lambda "A"\n a = aws/s3 "A2"\n}`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].message).toContain("duplicate id");
  });

  it("errors on a node listed twice in rows", () => {
    const r = buildModel(
      `system s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n}\nview s {\n layout { rows [a b] [a] }\n}`,
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].message).toContain("twice");
  });

  describe("`place` against a band: a second opinion is only a conflict when it disagrees", () => {
    // This guard has been wrong twice, in opposite directions, and both were
    // found by cold agents. It first listed only `right-of`/`left-of`, so
    // `above`/`below` — the directions that collide with `rows` on the axis
    // `rows` actually pins — passed with one hint silently dropped. Widening it
    // to "in a band at all" then rejected `rows [db bus]` + `place bus right-of
    // db`, which say the same thing: four of twenty round-5 agents wrote that
    // and were refused, at an unchanged rate across two rounds of doc fixes.
    const src = (rank: string, place: string) =>
      `system s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n c = aws/lambda "C"\n}\n` +
      `view s {\n layout {\n  ${rank}\n  place ${place}\n }\n}`;
    const err = (r: ReturnType<typeof buildModel>) =>
      r.diagnostics.find((d) => d.severity === "error");

    describe("accepts a `place` that restates the band", () => {
      const ok = (rank: string, place: string) => {
        const r = buildModel(src(rank, place));
        expect(err(r)?.message ?? "", `${rank} + place ${place}`).toBe("");
        expect(r.ok).toBe(true);
      };
      // rows: bands top to bottom, members left to right
      it("`right-of`, where the row already reads left to right", () => ok("rows [a] [b c]", "c right-of b"));
      it("`left-of`, the same statement from the other end", () => ok("rows [a] [b c]", "b left-of c"));
      it("`above`, where the node's band is already the one above", () => ok("rows [a] [b c]", "a above b"));
      it("`below`, likewise", () => ok("rows [a] [b] [c]", "c below b"));
      // cols is the transpose: bands left to right, members top to bottom
      it("`below` in `cols`, where the column already reads downward", () => ok("cols [a] [b c]", "c below b"));
      it("`right-of` in `cols`, meaning the next column along", () => ok("cols [a] [b] [c]", "c right-of b"));
    });

    describe("still refuses one that contradicts the band", () => {
      const rejects = (rank: string, place: string, wants: string) => {
        const r = buildModel(src(rank, place));
        expect(r.ok, `${rank} + place ${place}`).toBe(false);
        expect(err(r)?.message).toContain(wants);
      };
      it("reversed within a row", () => rejects("rows [a] [b c]", "b right-of c", "somewhere else"));
      it("reversed within a column", () => rejects("cols [a] [b c]", "b below c", "somewhere else"));
      it("naming a band that isn't adjacent", () => rejects("rows [a] [b] [c]", "c above a", "somewhere else"));
      it("beside a node the row puts two along", () =>
        rejects("rows [a b c]", "c right-of a", "somewhere else"));
      it("relative to a target no band mentions", () =>
        rejects("rows [a] [c]", "c right-of b", "which is not"));
    });

    it("says which of the two to change, either way", () => {
      const wrongWay = err(buildModel(src("rows [a] [b c]", "b right-of c")));
      expect(wrongWay?.fix).toContain("make them agree");
      const unbanded = err(buildModel(src("rows [a] [c]", "c right-of b")));
      expect(unbanded?.fix).toContain("add `s.b` to rows");
    });

    it("leaves the side-car idiom alone — the placed node is in no band", () => {
      const r = buildModel(src("rows [a] [b]", "c right-of b"));
      expect(err(r)).toBeUndefined();
    });
  });

  it("errors on contradictory place hints", () => {
    const r = buildModel(
      `system s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n}\nview s {\n layout { place a right-of b\n place b right-of a }\n}`,
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes("contradictory"))).toBe(true);
  });

  it("merges duplicate edges with a warning", () => {
    const r = buildModel(
      `system s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n a -> b\n a -> b\n}`,
    );
    expect(r.ok).toBe(true);
    expect(r.model.edges.length).toBe(1);
    expect(r.diagnostics.some((d) => d.severity === "warning")).toBe(true);
  });
});

  it("keywords are contextual, not reserved (builtin/person, node named view)", () => {
    const r = buildModel(
      `system s "S" {\n admin = builtin/person "Admins"\n view = aws/lambda "View Builder"\n admin -> view\n}`,
    );
    expect(r.ok).toBe(true);
    expect(r.model.nodes.get("s.admin")?.icon).toEqual({ pack: "builtin", id: "person" });
    expect(r.model.nodes.get("s.view")?.icon).toEqual({ pack: "aws", id: "lambda" });
  });

  it("box nodes get the builtin box icon", () => {
    const r = buildModel(`system s "S" {\n a = box "Legacy" external\n}`);
    expect(r.model.nodes.get("s.a")?.icon).toEqual({ pack: "builtin", id: "box" });
  });

  it("half-typed input never throws — the editor builds on every keystroke", () => {
    for (const partial of [
      `system s "S" {\n a = aws/lambda "A"\n a -> \n}`,
      `system s "S" {\n a = \n}`,
      `system s "S" {\n a -> b,\n}`,
      `view v {\n layout {\n rows [\n`,
      `zone z "Z" vpc {\n contains \n}`,
      `flow f "F" {\n a ->\n}`,
      `system `,
      `person `,
      // view statements mid-keystroke: each of these took its operand with a
      // `!` and threw a raw null deref — exit 2, no location. `scope *` is the
      // shape a cold agent wrote reaching for "show everything".
      `view v {\n scope\n}`,
      `view v {\n scope *\n}`,
      `view v {\n title\n}`,
      `view v {\n theme\n}`,
    ])
      expect(() => buildModel(partial), partial).not.toThrow();
  });

  it("`scope *` is refused by name, and points at the thing that does widen", () => {
    const r = buildModel(`system s "S" {\n a = aws/lambda "A"\n}\nview v {\n scope *\n}`);
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((x) => x.message.includes("`scope` needs"));
    expect(d?.fix).toContain("include *");
  });

  it("layout block inside a system: the container's own interior layout", () => {
    // The exact shape two independent agents crashed on (null .from in phase
    // B), then the most common authoring mistake for a year — refused with
    // "layout hints live in views, not systems". Cold agents kept writing it
    // because it is where the fact belongs (SPEC §3): the block resolves from
    // inside the container and becomes its interior layout.
    const r = buildModel(
      `pack aws\nsystem pipeline "P" {\n bucket = aws/s3 "B"\n handler = aws/lambda "H"\n bucket ~> handler "created"\n\n layout {\n  rows [bucket] [handler]\n }\n}\n`,
    );
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(r.model.containers.get("pipeline")?.layout?.rows).toEqual([["pipeline.bucket"], ["pipeline.handler"]]);
  });

  it("a container's layout block refuses what describes a view, and paths that are not its direct members", () => {
    const of = (block: string) =>
      buildModel(
        `a = box "A"\nsystem s "S" {\n x = box "X"\n container inner "I" { y = box "Y" }\n x -> inner.y\n layout { ${block} }\n}\nview v { include * }\n`,
      ).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
    expect(of("rows [x] [inner]")).toEqual([]);
    expect(of("rows [a] [x]")[0]).toContain("`a` is outside `s`");
    expect(of("place inner.y below x")[0]).toContain("`inner.y` is inside `inner`, not a direct member of `s`");
    expect(of("direction right")).toEqual([]); // the interior's own flow (SPEC §3)
    expect(of("lines curved")[0]).toContain("`lines` describes a view");
    expect(of("density compact")[0]).toContain("`density` describes a view");
    expect(of("rows [x] [inner]\n  rows [inner] [x]")[0]).toContain("`rows` appears twice in this block");
    expect(of("rows [x inner]\n  place x below inner")[0]).toContain("is placed `below s.inner`, but `rows` puts it somewhere else");
    // two blocks in one container
    const two = buildModel(`system s "S" {\n x = box "X"\n layout { rows [x] }\n layout { rows [x] }\n}\n`);
    expect(two.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining("`s` already has a `layout` block"));
    // `layout` stays a legal id (kw<> is @extend): a node named layout parses
    const named = buildModel(`system s "S" {\n layout = box "L"\n x = box "X"\n layout -> x\n}\n`);
    expect(named.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(named.model.nodes.has("s.layout")).toBe(true);
  });

  it("expand inside a container's own view says so, and how to get the landscape instead", async () => {
    const { resolveView } = await import("../src/view/resolve.js");
    const r = buildModel(`system platform "P" {\n a = box "A"\n}\nview platform { expand platform }\n`);
    const v = r.model.views.find((x) => x.name === "platform")!;
    const w = resolveView(r.model, v).diagnostics.find((d) => d.message.includes("inside `platform`'s own view"))!;
    expect(w.severity).toBe("warning");
    expect(w.fix).toContain("view overview { expand platform }");
  });

  it("a container's block that runs against its own edges is a check error, whether or not a view opens it", () => {
    // Round 22: the block's rows contradicted the container's own edges, the
    // one declared view kept the container collapsed (block dormant), check
    // passed, and the HTML export failed through the auto view. The claim is
    // about the interior's edges, so it is checked here, once, with every
    // edge resolved.
    const src = `system platform "P" {\n api = box "API"\n db = box "DB"\n monitor = box "Mon"\n api -> db\n monitor -> api\n layout { rows [api] [db] [monitor] }\n}\nuser = box "U"\nuser -> platform.api\nview main { include * }\n`;
    const r = buildModel(src);
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    expect(errs.map((e) => e.message)).toContainEqual(expect.stringContaining("`platform.monitor` → `platform.api` runs upward inside `platform` — row 2 to row 0"));
    expect(errs[0].loc.line).toBe(7);
    // the same block with the bands the edges allow is clean
    expect(buildModel(src.replace("rows [api] [db] [monitor]", "rows [monitor] [api] [db]")).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("rows bands continued on the next line get one error naming the fix, not syntax debris", () => {
    // round 23: three of thirty-three agents wrapped a long rows line
    const r = buildModel(`a = box "A"\nb = box "B"\nc = box "C"\na -> b\nb -> c\nview v { include *\n  layout {\n    rows [a] [b]\n         [c]\n  }\n}\n`);
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    expect(errs.map((e) => e.message)).toContainEqual(expect.stringContaining("`rows` bands must sit on one line"));
    expect(errs.find((e) => e.message.includes("bands must sit"))!.loc.line).toBe(9);
    expect(errs.filter((e) => e.message.startsWith("syntax error near")).length).toBe(0);
  });

  it("a second rows, cols or direction line in a view's layout block is an error, not a silent drop", () => {
    const r = buildModel(`a = box "A"\nb = box "B"\na -> b\nview v { include *\n layout {\n  rows [a] [b]\n  rows [b] [a]\n  direction down\n  direction right\n } }\n`);
    const msgs = r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.loc.line}: ${d.message}`);
    expect(msgs).toContainEqual(expect.stringContaining("7: `rows` appears twice in this block"));
    expect(msgs).toContainEqual(expect.stringContaining("9: `direction` appears twice in this block"));
  });

  describe("glyph: is a real icon reference", () => {
    // It was the one icon reference nobody validated. `view/resolve.ts` splits it
    // on `/` and shrugs, so a typo drew a `?` plate and exited 0 — the silent
    // class, where check passes and only a reader notices.
    const src = (glyph: string) =>
      `pack aws\nsystem s "S" {\n  glyph: ${glyph}\n  a = aws/lambda "A"\n}\n`;

    it("accepts one that resolves", () => {
      expect(buildModel(src("sys/code")).ok).toBe(true);
    });

    it("rejects a near-miss id with the id it probably meant", () => {
      const r = buildModel(src("sys/serve"));
      expect(r.ok).toBe(false);
      const d = r.diagnostics.find((x) => x.message.includes("in glyph"));
      expect(d?.message).toContain("unknown icon `sys/serve`");
      expect(d?.fix).toContain("did you mean `sys/server`?");
    });

    it("falls back to the search command when nothing is close", () => {
      const r = buildModel(src("sys/zzzzzz"));
      expect(r.ok).toBe(false);
      expect(r.diagnostics.find((x) => x.message.includes("in glyph"))?.fix).toContain(
        "squinch icons search zzzzzz",
      );
    });

    it("rejects an unknown pack, and suggests a real one", () => {
      const r = buildModel(src("sysx/api"));
      expect(r.ok).toBe(false);
      const d = r.diagnostics.find((x) => x.message.includes("in glyph"));
      expect(d?.message).toContain("unknown pack `sysx`");
      expect(d?.fix).toContain("did you mean `sys/");
    });

    it("rejects a value that is not a pack/id pair at all", () => {
      const r = buildModel(src("notapath"));
      expect(r.ok).toBe(false);
      expect(r.diagnostics.find((x) => x.message.includes("in glyph"))?.fix).toContain(
        "glyph: <pack>/<id>",
      );
    });
  });

describe("badge: is a real icon reference", () => {
  // Task #45's glyph treatment, applied to the node badge: an unchecked ref
  // would draw a bare plate, exit 0, and leave the typo to be noticed by eye.
  const src = (badge: string) =>
    `pack aws\nsystem s "S" {\n  a = aws/lambda "A" { badge: ${badge} }\n}\n`;
  const badgeDiag = (r: ReturnType<typeof buildModel>) =>
    r.diagnostics.find((x) => x.message.includes("in badge"));

  it("accepts a valid ref", () => {
    const r = buildModel(src("logos/databricks"));
    expect(badgeDiag(r)).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it("suggests the icon on a typo", () => {
    const r = buildModel(src("logos/databrics"));
    expect(badgeDiag(r)!.message).toContain("unknown icon `logos/databrics`");
    expect(badgeDiag(r)!.fix).toContain("did you mean `logos/databricks`?");
  });

  it("points at icon search when nothing is close", () => {
    const r = buildModel(src("logos/zzzzzz"));
    expect(badgeDiag(r)!.fix).toContain("squinch icons search zzzzzz");
  });

  it("suggests the pack on a pack typo", () => {
    const r = buildModel(src("logoz/databricks"));
    expect(badgeDiag(r)!.message).toContain("unknown pack `logoz`");
    expect(badgeDiag(r)!.fix).toContain("did you mean `logos/");
  });

  it("names the shape on a bare value", () => {
    const r = buildModel(src("databricks"));
    expect(badgeDiag(r)!.fix).toContain("badge: <pack>/<id>");
  });
});

describe("commas as optional separators", () => {
  // Round 4 lost two iterations to `rows [gw] [create, get, search]`, and I
  // wrote `{ style: dashed, animate: slow }` three times in one session. Both
  // are now legal: a comma is never required where whitespace works, and never
  // an error where a list is being written. SPEC §1 promised this from v0.
  const view = (group: string) =>
    `pack aws\nsystem s "S" {\n  gw = aws/api-gateway "GW"\n  a = aws/lambda "A"\n  b = aws/lambda "B"\n  gw -> a\n  gw -> b\n}\nview v {\n  scope s\n  layout {\n    rows [gw] ${group}\n  }\n}\n`;

  it("accepts commas in a rank group, and means the same thing", () => {
    const withCommas = buildModel(view("[a, b]"));
    const withSpaces = buildModel(view("[a b]"));
    expect(withCommas.ok, JSON.stringify(withCommas.diagnostics)).toBe(true);
    expect(withSpaces.ok).toBe(true);
    const ranks = (r: typeof withCommas) =>
      JSON.stringify(r.model.views[0].layout.rows);
    expect(ranks(withCommas)).toBe(ranks(withSpaces));
  });

  it("accepts commas between attrs, including a trailing one", () => {
    const src = (attrs: string) =>
      `pack aws\nsystem t "T" {\n  x = aws/lambda "X" ${attrs}\n  y = aws/lambda "Y"\n  x -> y\n}\n`;
    for (const form of [
      `{ description: "d", owner: team }`,
      `{ description: "d", owner: team, }`,
      `{\n    description: "d"\n    owner: team\n  }`,
    ]) {
      const r = buildModel(src(form));
      expect(r.ok, `${form} → ${JSON.stringify(r.diagnostics)}`).toBe(true);
      expect(r.model.nodes.get("t.x")!.description).toBe("d");
      expect(r.model.nodes.get("t.x")!.attrs["owner"]).toBe("team");
    }
  });

  it("accepts commas in align and highlight", () => {
    const r = buildModel(
      `pack aws\nsystem s "S" {\n  a = aws/lambda "A" #pci\n  b = aws/lambda "B" #pci\n  a -> b\n}\nview v {\n  scope s\n  highlight #pci, #core\n  layout { align a, b }\n}\n`,
    );
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  });

  it("still names the fix for a comma inside a tag value", () => {
    // The one place a comma stays illegal: after it, an LR(1) parser cannot
    // tell another tag from the next attribute key.
    const r = buildModel(
      `pack aws\nsystem t "T" {\n  x = aws/lambda "X" { tags: #pci, #core }\n  y = aws/lambda "Y"\n  x -> y\n}\n`,
    );
    const d = r.diagnostics.find((x) => x.message.includes("comma splits the tag list"))!;
    expect(d).toBeDefined();
    expect(d.fix).toContain("tags: #pci #core");
    // and it replaces the bare syntax error rather than piling on
    expect(r.diagnostics.some((x) => x.message.startsWith("syntax error near"))).toBe(false);
  });

  it("never fires on a label that happens to contain one", () => {
    // "Orders [US, EU]" is legal text; suppressing a real syntax error because
    // of it would be strictly worse than saying nothing.
    const r = buildModel(`pack aws\nsystem s "S" {\n  a = aws/lambda "Orders [US, EU]"\n  a ->\n}\n`);
    expect(r.diagnostics.some((x) => x.message.includes("comma splits"))).toBe(false);
    expect(r.diagnostics.some((x) => x.message.startsWith("syntax error near"))).toBe(true);
  });
});

describe("a chained edge (round 24)", () => {
  // Two agents wrote a pipeline as `extract -> validate -> dedupe`, the way a
  // flow chains, and got a bare syntax error.
  it("names the hops to write, and drops the syntax debris", () => {
    const r = buildModel(`pack aws\na = aws/lambda "A"\nb = aws/lambda "B"\nc = aws/lambda "C"\na -> b ~> c\n`);
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toBe("edges do not chain — `a -> b ~> c` is one statement per hop");
    expect(errs[0].fix).toBe("write `a -> b`, `b ~> c` on their own lines; a `flow` is where hops chain");
  });

  it("leaves a flow's chain alone", () => {
    const r = buildModel(`pack aws\na = aws/lambda "A"\nb = aws/lambda "B"\nc = aws/lambda "C"\na -> b\nb -> c\nflow f "F" {\n  a -> b -> c\n}\n`);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("an unquoted attribute value with a space", () => {
  // Round 15: `owner: team-orders` parses, so a cold agent wrote
  // `owner: payments team` and got a bare syntax error pointing at the brace.
  const src = (attr: string) =>
    `pack aws\nsystem s "S" {\n  a = aws/lambda "A" { ${attr} }\n  b = aws/lambda "B"\n  a -> b\n}\n`;

  it("names the key and writes the quoted form", () => {
    const r = buildModel(src("owner: payments team"));
    const d = r.diagnostics.find((x) => x.message.includes("needs quotes"))!;
    expect(d).toBeDefined();
    expect(d.message).toContain("`owner`");
    expect(d.fix).toBe('write `owner: "payments team"`');
    expect(r.diagnostics.some((x) => x.message.startsWith("syntax error near"))).toBe(false);
  });

  it("leaves a single-word value alone", () => {
    expect(buildModel(src("owner: team-orders")).ok).toBe(true);
  });

  it("never fires on a tag list, the one legal multi-token value", () => {
    const r = buildModel(src("tags: #pci #core"));
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.model.nodes.get("s.a")!.tags.sort()).toEqual(["core", "pci"]);
  });
});

describe("tags written in kind position", () => {
  // Five of five cold agents shown one example wrote `db = aws/dynamodb "L"
  // datastore #pci` — nobody reached for `tags: #pci` unprompted.
  it("lands on the node, and composes with a block tags:", () => {
    const r = buildModel(
      `pack aws\nsystem s "S" {\n  a = aws/dynamodb "A" datastore #pci\n  b = aws/lambda "B" #pci { tags: #core }\n  a -> b\n}\n`,
    );
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.model.nodes.get("s.a")!.tags).toEqual(["pci"]);
    expect(r.model.nodes.get("s.a")!.kinds).toContain("datastore");
    expect(r.model.nodes.get("s.b")!.tags.sort()).toEqual(["core", "pci"]);
  });

  it("de-dupes when both spellings say the same thing", () => {
    const r = buildModel(
      `pack aws\nsystem s "S" {\n  a = aws/lambda "A" #pci { tags: #pci }\n  b = aws/lambda "B"\n  a -> b\n}\n`,
    );
    expect(r.model.nodes.get("s.a")!.tags).toEqual(["pci"]);
  });

  it("works on a container head and inherits like a body tag", () => {
    const r = buildModel(
      `pack aws\nsystem s "S" #core {\n  a = aws/lambda "A"\n  b = aws/lambda "B"\n  a -> b\n}\n`,
    );
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.model.containers.get("s")!.tags).toEqual(["core"]);
  });
});

describe("unknown ids that all want the same prefix", () => {
  // Round 16: an agent declared its nodes inside `system warehouse` and then
  // referenced them unqualified from a zone and a layout. `check` answered
  // with twenty-eight `unknown id`s — each correct, each naming its own fix,
  // and together burying the fact that it is one misunderstanding about scope.
  const src = (n: number) => {
    const ids = Array.from({ length: n }, (_, i) => `n${i}`);
    return `pack aws\nsystem w "W" {\n${ids
      .map((i) => `  ${i} = aws/lambda "${i}"`)
      .join("\n")}\n  ${ids[0]} -> ${ids[1]}\n}\nzone z "Z" {\n  contains ${ids.join(", ")}\n}\n`;
  };

  it("folds three or more into one message naming the prefix", () => {
    const r = buildModel(src(5));
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toBe(
      "5 ids are missing their `w` prefix — `n0`, `n1`, `n2`, and 2 more",
    );
    expect(errs[0].fix).toBe("ids declared inside `w` are written `w.<id>` from outside it");
  });

  it("leaves two alone — two is not yet a pattern", () => {
    const errs = buildModel(src(2)).diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBe(2);
    expect(errs.every((d) => d.message.startsWith("unknown id"))).toBe(true);
  });

  it("never folds typos, only genuinely missing prefixes", () => {
    // Three misspelled ids inside one system all get a `s.<something>`
    // suggestion, so they agree on a prefix by accident — but the suggestion
    // is a *correction*, not the same id qualified, and folding them would
    // claim a scope problem that isn't there. The guard is that the
    // suggestion must end in `.<the id as written>`.
    // These three suggest the *system* `s`, not `s.<id>`. Without the
    // endsWith guard their computed prefix is the empty string and all three
    // fold into "3 ids are missing their `` prefix" — nonsense, and it hides
    // three real typos.
    const r = buildModel(
      `pack aws\nsystem s "S" {\n  ax = aws/lambda "A"\n  bx = aws/lambda "B"\n  cx = aws/lambda "C"\n  ax -> bx\n}\nzone z "Z" {\n  contains aa, bb, cc\n}\n`,
    );
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    expect(errs.some((d) => d.message.includes("missing their"))).toBe(false);
    expect(errs.filter((d) => d.message.startsWith("unknown id")).length).toBe(3);
  });
});

describe("the two person forms, crossed", () => {
  // Round 16: `analyst = person analyst "Analyst"` — the inline form and the
  // top-level form written at once — produced a bare syntax error.
  it("names the doubling and offers both ways out", () => {
    const r = buildModel(
      `pack aws\nsystem s "S" {\n  a = aws/lambda "A"\n}\nanalyst = person analyst "Analyst"\nanalyst -> s.a\n`,
    );
    const d = r.diagnostics.find((x) => x.message.includes("names the person twice"))!;
    expect(d).toBeDefined();
    expect(d.message).toBe("`analyst = person analyst` names the person twice");
    expect(d.fix).toContain("`analyst = person`");
    expect(r.diagnostics.some((x) => x.message.startsWith("syntax error near"))).toBe(false);
  });

  it("leaves each correct form alone", () => {
    const r = buildModel(
      `pack aws\nperson a "A"\nb = person "B"\nsystem s "S" { x = aws/lambda "X" }\na -> s.x\nb -> s.x\n`,
    );
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  });
});

describe("soundness: silent corners closed", () => {
  it("duplicate view names are an error, not a silent pick", () => {
    const r = buildModel(
      `pack aws\nsystem s "S" {\n  a = aws/lambda "A"\n  b = aws/lambda "B"\n  a -> b\n}\nview main { scope s }\nview main { scope s }\n`,
    );
    const d = r.diagnostics.find((x) => x.message === "duplicate view `main`")!;
    expect(d).toBeDefined();
    expect(d.fix).toContain("would pick one of them silently");
  });

  it("a zone sharing a node's id is an error", () => {
    const r = buildModel(
      `pack aws\ngw = aws/api-gateway "GW"\nvpc = aws/lambda "Node"\ngw -> vpc\nzone vpc "Zone" vpc { contains gw }\n`,
    );
    expect(r.diagnostics.some((x) => x.message === "zone `vpc` has the same id as a node")).toBe(true);
  });

  it("a top-level person takes a positional tag, like every other declaration", () => {
    const r = buildModel(
      `pack aws\nperson vip "V" #gold\nsystem s "S" {\n  a = aws/lambda "A"\n}\nvip -> s.a\n`,
    );
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.model.nodes.get("vip")!.tags).toEqual(["gold"]);
  });

  it("tags collect from `tags:` only — a tag under another key is an error", () => {
    const r = buildModel(
      `pack aws\nsystem s "S" {\n  a = aws/lambda "A" { owner: #team }\n  b = aws/lambda "B"\n  a -> b\n}\n`,
    );
    const d = r.diagnostics.find((x) => x.message.includes("has a tag value"))!;
    expect(d.message).toBe("`owner` has a tag value — tags live in `tags:`");
    expect(d.fix).toContain("write `tags: #team`");
    expect(r.model.nodes.get("s.a")!.tags).toEqual([]);
  });

  it("a duplicated attr key warns instead of silently last-winning", () => {
    const r = buildModel(
      `pack aws\nsystem s "S" {\n  a = aws/lambda "A" {\n    description: "x"\n    description: "y"\n  }\n  b = aws/lambda "B"\n  a -> b\n}\n`,
    );
    const d = r.diagnostics.find((x) => x.message.includes("appears twice"))!;
    expect(d.severity).toBe("warning");
    expect(r.model.nodes.get("s.a")!.description).toBe("y");
  });

  it("an Allman brace names the rule and writes the joined line", () => {
    const r = buildModel(`pack aws\nsystem s "S"\n{\n  a = aws/lambda "A"\n  b = aws/lambda "B"\n  a -> b\n}\n`);
    const d = r.diagnostics.find((x) => x.message.includes("must sit on the declaration's own line"))!;
    expect(d).toBeDefined();
    expect(d.fix).toBe('write `system s "S" {`');
    expect(r.diagnostics.some((x) => x.message.startsWith("syntax error near"))).toBe(false);
  });

  it("fan-in gets one error naming the rule, with no unknown-id debris", () => {
    const r = buildModel(
      `pack aws\nsystem s "S" {\n  x = aws/lambda "X"\n  y = aws/lambda "Y"\n  z = aws/sqs "Z"\n  x, y -> z\n}\n`,
    );
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toBe("an edge has one source — `x, y` cannot fan in");
    expect(errs[0].fix).toContain("channel x, y -> z");
  });
});
