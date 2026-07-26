// The editor intelligence, tested without an editor.
import { describe, it, expect } from "vitest";
import {
  diagnosticsFor, allDiagnosticsFor, completionsAt, hoverAt, symbolsOf,
  blockStack, replacementIn, offsetAt,
} from "../src/features.js";

const SRC = `pack aws

person ops "Operators"

system shop "Shop" {
  api = aws/api-gateway "API"
  db  = aws/dynamodb "Orders" datastore
  api -> db "writes"
}

zone vpc1 "VPC" vpc {
  contains shop
}

flow f1 "Checkout" {
  api -> db
}

view landscape {
  include *
  layout {
    rows [shop]
  }
}
`;
const at = (text: string) => ({ src: text.replace("|", ""), offset: text.indexOf("|") });

describe("diagnostics", () => {
  it("reports unknown icons with a range and a replacement", () => {
    const src = `pack aws\nsystem s "S" {\n fn = aws/lambd "Fn"\n}`;
    const [d] = diagnosticsFor(src).filter((x) => x.message.includes("unknown icon"));
    expect(d.severity).toBe("error");
    expect(d.range.start.line).toBe(2);
    expect(d.replacement).toBe("aws/lambda");
  });

  it("is clean on a valid document", () => {
    expect(diagnosticsFor(SRC).filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("surfaces layout-time hint conflicts too", async () => {
    const src = `pack aws
system s "S" {
  a = aws/lambda "A"
  b = aws/lambda "B"
  a -> b
}
view s {
  layout { rows [b] [a] }
}
`;
    const ds = await allDiagnosticsFor(src);
    expect(ds.some((d) => d.message.includes("runs upward"))).toBe(true);
  });

  it("extracts replacements only from did-you-mean fixes", () => {
    expect(replacementIn("did you mean `aws/lambda`?")).toBe("aws/lambda");
    expect(replacementIn("run `squinch icons search x`")).toBeUndefined();
    expect(replacementIn(undefined)).toBeUndefined();
  });
});

describe("block context", () => {
  it("knows which block the cursor is in", () => {
    const inLayout = at(SRC.replace("    rows [shop]", "    |"));
    expect(blockStack(inLayout.src, inLayout.offset).pop()).toBe("layout");
    const inView = at(SRC.replace("  include *", "  |"));
    expect(blockStack(inView.src, inView.offset).pop()).toBe("view");
    const inSystem = at(SRC.replace(`  api -> db "writes"`, "  |"));
    expect(blockStack(inSystem.src, inSystem.offset).pop()).toBe("system");
    const top = at(SRC + "|");
    expect(blockStack(top.src, top.offset).pop()).toBe("file");
  });

  it("ignores braces inside strings and comments", () => {
    const src = `system s "a { b" {\n  // } not a close\n  x = box "X"\n`;
    expect(blockStack(src, src.length).pop()).toBe("system");
  });
});

describe("completion", () => {
  it("completes icon ids after a pack slash", () => {
    const { src, offset } = at(`pack aws\nsystem s "S" {\n  fn = aws/lamb|\n}`);
    const items = completionsAt(src, offset);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === "icon")).toBe(true);
    expect(items.map((i) => i.label)).toContain("aws/lambda");
    expect(items.find((i) => i.label === "aws/lambda")!.insert).toBe("da");
  });

  it("offers packs at an icon position", () => {
    const { src, offset } = at(`pack aws\nsystem s "S" {\n  fn = |\n}`);
    const labels = completionsAt(src, offset).map((i) => i.label);
    expect(labels).toContain("aws/");
    expect(labels).toContain("box");
  });

  it("completes node paths after an arrow", () => {
    const { src, offset } = at(SRC.replace(`  api -> db "writes"`, "  api -> |"));
    const labels = completionsAt(src, offset).map((i) => i.label);
    expect(labels).toContain("shop.db");
  });

  it("offers layout keywords inside a layout block, view keywords inside a view", () => {
    const inLayout = at(SRC.replace("    rows [shop]", "    ro|"));
    expect(completionsAt(inLayout.src, inLayout.offset).map((i) => i.label)).toContain("rows");
    const inView = at(SRC.replace("  include *", "  hig|"));
    expect(completionsAt(inView.src, inView.offset).map((i) => i.label)).toContain("highlight");
  });

  it("offers top-level keywords at file scope", () => {
    const { src, offset } = at(SRC + "zo|");
    expect(completionsAt(src, offset).map((i) => i.label)).toContain("zone");
  });
});

describe("hover", () => {
  it("describes an icon reference", () => {
    const off = SRC.indexOf("aws/api-gateway") + 5;
    expect(hoverAt(SRC, off)!.markdown).toContain("pack `aws`");
  });

  it("describes a node by its bare name", () => {
    const off = SRC.indexOf(`  db  =`) + 3;
    const h = hoverAt(SRC, off)!;
    expect(h.markdown).toContain("Orders");
    expect(h.markdown).toContain("shop.db");
  });

  it("returns nothing for whitespace", () => {
    expect(hoverAt(SRC, SRC.indexOf("\n\n") + 1)).toBeUndefined();
  });
});

describe("symbols", () => {
  it("outlines systems with children, plus zones, flows and views", () => {
    const syms = symbolsOf(SRC);
    const shop = syms.find((s) => s.name === "shop")!;
    expect(shop.kind).toBe("system");
    expect(shop.children!.map((c) => c.name).sort()).toEqual(["api", "db"]);
    expect(syms.find((s) => s.name === "vpc1")!.kind).toBe("zone");
    expect(syms.find((s) => s.name === "f1")!.kind).toBe("flow");
    expect(syms.find((s) => s.name === "landscape")!.kind).toBe("view");
    expect(syms.find((s) => s.name === "ops")!.kind).toBe("node");
  });
});

describe("positions", () => {
  it("round-trips offsets", () => {
    const off = SRC.indexOf("zone vpc1");
    expect(offsetAt(SRC, { line: SRC.slice(0, off).split("\n").length - 1, character: 0 })).toBe(off);
  });
});
