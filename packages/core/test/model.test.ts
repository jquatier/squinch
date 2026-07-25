import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildModel } from "../src/model/build.js";

const canonical = readFileSync("examples/orders.squinch", "utf8");

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
