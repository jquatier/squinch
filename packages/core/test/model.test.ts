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
      `system s "S" {\n admin = builtin/person "Admins" person\n view = aws/lambda "View Builder"\n admin -> view\n}`,
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
    ])
      expect(() => buildModel(partial), partial).not.toThrow();
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
