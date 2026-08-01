import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { buildModel } from "../src/model/build.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const canonical = readFileSync(join(pkg, "examples/orders.squinch"), "utf8");

describe("grammar + model builder", () => {
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

  it("layout block inside a system: diagnostics, not a crash", () => {
    // the exact shape two independent agents crashed on (null .from in phase B)
    const r = buildModel(
      `pack aws\nsystem pipeline "P" {\n bucket = aws/s3 "B"\n handler = aws/lambda "H"\n bucket ~> handler "created"\n\n layout {\n  rows [bucket] [handler]\n }\n}\n`,
    );
    expect(r.ok).toBe(false);
    const hint = r.diagnostics.find((d) => d.message.includes("layout hints live in views"));
    expect(hint?.fix).toContain("view pipeline { layout");
    // cascading syntax errors collapse to one per line
    const lines = r.diagnostics.filter((d) => d.message.startsWith("syntax error")).map((d) => d.loc.line);
    expect(new Set(lines).size).toBe(lines.length);
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
