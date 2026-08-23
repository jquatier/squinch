// The editor intelligence, tested without an editor.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  diagnosticsFor, allDiagnosticsFor, completionsAt, hoverAt, symbolsOf,
  blockStack, replacementIn, offsetAt, esc,
} from "../src/features.js";
import { render, viewIndex } from "@squinch/core";

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

  it("completes the nine hues after `color:` and after `color #tag`", () => {
    const attr = at(SRC.replace("  include *", "  include *\n  color #pci r|"));
    expect(completionsAt(attr.src, attr.offset).map((i) => i.label)).toEqual(["red"]);
    const all = at(SRC.replace("  include *", "  include *\n  color #pci |"));
    expect(completionsAt(all.src, all.offset).map((i) => i.label)).toEqual([
      "red", "amber", "green", "teal", "blue", "violet", "pink", "gray", "accent",
    ]);
    const onNode = at(SRC + "x = box \"X\" { color: vi|");
    expect(completionsAt(onNode.src, onNode.offset).map((i) => i.label)).toEqual(["violet"]);
    const verb = at(SRC.replace("  include *", "  col|"));
    expect(completionsAt(verb.src, verb.offset).map((i) => i.label)).toContain("color");
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

describe("preview webview safety", () => {
  // The panel runs with `enableScripts: true` and inlines both the rendered SVG
  // and user-authored view names. `errorHtml` escaped from the start and
  // `html` did not; the asymmetry is the kind that becomes live the day the
  // grammar loosens. These pin the properties the panel actually relies on.
  it("escapes every character that could break out of an attribute or a tag", () => {
    expect(esc(`<img src=x onerror="alert(1)">`))
      .toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(esc("a & b")).toBe("a &amp; b");
    expect(esc("it's")).toBe("it&#39;s");
  });

  it("leaves ordinary view names untouched, so escaping costs nothing", () => {
    for (const name of ["landscape", "orders-pci", "web_app", "a.b"]) expect(esc(name)).toBe(name);
  });

  it("view names cannot contain markup in the first place", () => {
    // The grammar's Ident is the reason this is belt-and-braces rather than a
    // live hole. If this ever fails, the escaping above became load-bearing.
    const names = viewIndex(`system s "S" { a = aws/lambda "A" }\nview v { scope s }\n`)
      .map((v) => v.name);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toMatch(/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/);
  });

  it("the SVG inlined into the panel never carries a script", async () => {
    const r = await render(`system s "S" { a = aws/lambda "A" }\n`, { theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.svg).not.toContain("<script");
    expect(r.svg).not.toMatch(/\son\w+=/); // no inline event handlers either
  });
});

describe("the Marketplace manifest", () => {
  // The listing is a surface like any other, and its failures are invisible
  // from here: a declared-but-missing icon ships a broken card, and vsce
  // packages whatever the manifest names without checking it exists.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  it("surfaces the preview everywhere a reader right-clicks", () => {
    // The command existed for months reachable only from the palette and the
    // title-bar icon — "why can't I right-click a .squinch file?" was the bug.
    // Every menu entry must name the preview command and gate on squinch, or
    // the entry appears on every file in the workspace.
    const menus = pkg.contributes.menus as Record<string, { command: string; when: string }[]>;
    for (const place of ["editor/title", "editor/context", "editor/title/context", "explorer/context"]) {
      const entry = menus[place]?.find((m) => m.command === "squinch.preview");
      expect(entry, `no preview entry in ${place}`).toBeTruthy();
      expect(entry!.when, `${place} entry is unguarded`).toMatch(/squinch/);
    }
  });

  it("declares an icon that is actually there, at Marketplace size", () => {
    expect(pkg.icon, "no icon — the listing gets a grey placeholder").toBeTruthy();
    const icon = join(root, pkg.icon);
    expect(existsSync(icon), `${pkg.icon} is declared but missing`).toBe(true);
    // PNG header: width and height are big-endian u32 at bytes 16 and 20.
    const buf = readFileSync(icon);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    // 128 is the Marketplace minimum; 256 is its retina recommendation and
    // what ships (re-derived from the 1440px logo source, 2026-08)
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)], "the Marketplace wants ≥128, ships 256")
      .toEqual([256, 256]);
  });

  it("is not excluded from the package", () => {
    // .vscodeignore drops src/test/scripts; the icon must survive.
    const ignore = readFileSync(join(root, ".vscodeignore"), "utf8");
    expect(ignore.split("\n").map((l) => l.trim())).not.toContain(pkg.icon);
  });

  it("carries the fields a listing is judged on", () => {
    for (const field of ["displayName", "description", "publisher", "categories", "keywords", "repository", "license"])
      expect(pkg[field], `manifest is missing ${field}`).toBeTruthy();
  });
});
