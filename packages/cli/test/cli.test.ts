import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/index.js";
import { BOOLEAN_FLAGS } from "../src/args.js";

let dir: string;
let out: string[];
let err: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "squinch-cli-"));
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const GOOD = `pack aws
system app "App" {
  api = aws/api-gateway "API"
  fn  = aws/lambda "Handler"
  api -> fn
}
view app {}
`;

describe("squinch cli", () => {
  it("init scaffolds a project that immediately checks clean", async () => {
    expect(await main(["init", dir])).toBe(0);
    expect(existsSync(join(dir, "diagram.squinch"))).toBe(true);
    expect(await main(["check", join(dir, "diagram.squinch")])).toBe(0);
  });

  it("init refuses to overwrite", async () => {
    await main(["init", dir]);
    expect(await main(["init", dir])).toBe(1);
    expect(err.join()).toContain("not overwriting");
  });

  it("check reports errors with fixes and exits 1", async () => {
    const f = join(dir, "bad.squinch");
    writeFileSync(f, `system s "S" {\n fn = aws/lambd "F"\n}`);
    expect(await main(["check", f])).toBe(1);
    expect(err.join("\n")).toContain("did you mean `aws/lambda`?");
  });

  it("check --format json emits a machine-readable payload", async () => {
    const f = join(dir, "bad.squinch");
    writeFileSync(f, `system s "S" {\n a = aws/lambda "A"\n a -> ghost\n}`);
    expect(await main(["check", f, "--format", "json"])).toBe(1);
    const payload = JSON.parse(out.join("\n"));
    expect(payload.ok).toBe(false);
    expect(payload.errors).toBe(1);
    expect(payload.diagnostics[0]).toMatchObject({
      severity: "error",
      file: "bad.squinch",
    });
    expect(payload.diagnostics[0].loc.line).toBe(3);
  });

  it("render writes a file with -o", async () => {
    const f = join(dir, "d.squinch");
    writeFileSync(f, GOOD);
    const target = join(dir, "d.svg");
    expect(await main(["render", f, "-o", target])).toBe(0);
    expect(readFileSync(target, "utf8")).toContain("<svg");
  });

  it("--sync writes both themes, a lockfile, and a picture snippet", async () => {
    const f = join(dir, "d.squinch");
    writeFileSync(f, GOOD);
    expect(await main(["render", f, "--sync"])).toBe(0);
    const files = readdirSync(dir).sort();
    expect(files).toContain("d.app.light.svg");
    expect(files).toContain("d.app.dark.svg");
    expect(files).toContain("squinch.lock");
    expect(out.join("\n")).toContain("prefers-color-scheme: dark");
    const lock = JSON.parse(readFileSync(join(dir, "squinch.lock"), "utf8"));
    expect(Object.keys(lock.files)).toHaveLength(2);
    expect(lock.version).toBeDefined(); // determinism is per tool version
  });

  it("--check passes when in sync and fails when stale", async () => {
    const f = join(dir, "d.squinch");
    writeFileSync(f, GOOD);
    await main(["render", f, "--sync"]);
    expect(await main(["render", f, "--check"])).toBe(0);

    writeFileSync(f, GOOD.replace("api -> fn", "api -> fn\n  fn -> api"));
    err = [];
    expect(await main(["render", f, "--check"])).toBe(1);
    expect(err.join("\n")).toContain("--sync");
  });

  it("--check fails when the committed SVG is missing entirely", async () => {
    const f = join(dir, "d.squinch");
    writeFileSync(f, GOOD);
    expect(await main(["render", f, "--check"])).toBe(1);
    expect(err.join("\n")).toContain("stale or missing");
  });

  it("renders a directory as one merged project", async () => {
    writeFileSync(join(dir, "a.squinch"), `system a "A" {\n x = aws/lambda "X"\n}`);
    writeFileSync(join(dir, "b.squinch"), `system b "B" {\n y = aws/dynamodb "Y"\n}\na.x -> b.y`);
    writeFileSync(join(dir, "views.squinch"), `view all {\n include *\n}`);
    expect(await main(["check", dir])).toBe(0);
    expect(await main(["render", dir, "--view", "all", "-o", join(dir, "o.svg")])).toBe(0);
    expect(readFileSync(join(dir, "o.svg"), "utf8")).toContain("<svg");
  });

  it("icons search finds ids and reports misses", async () => {
    expect(await main(["icons", "search", "lambda"])).toBe(0);
    expect(out.join()).toContain("aws/lambda");
    out = [];
    expect(await main(["icons", "search", "zzzz"])).toBe(1);
  });

  it("unknown command and missing path are usage errors", async () => {
    expect(await main(["frobnicate"])).toBe(2);
    expect(await main(["check"])).toBe(2);
    expect(await main(["render", join(dir, "missing.squinch")])).toBe(2);
  });
});

/** PNG dimensions live in the IHDR chunk, bytes 16..24 of a well-formed file. */
function pngSize(buf: Buffer): { w: number; h: number } {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("png export", () => {
  const write = () => {
    const f = join(dir, "d.squinch");
    writeFileSync(f, GOOD);
    return f;
  };
  /** the same diagram as SVG, for comparing against its rasterization */
  const refSvg = async (f: string) => {
    await main(["render", f, "-o", join(dir, "ref.svg")]);
    return readFileSync(join(dir, "ref.svg"), "utf8");
  };

  it("infers png from the output extension, at the diagram's natural size", async () => {
    const f = write();
    const svg = await refSvg(f);
    const target = join(dir, "d.png");
    expect(await main(["render", f, "-o", target])).toBe(0);
    const { w } = pngSize(readFileSync(target));
    expect(w).toBe(Number(svg.match(/<svg[^>]*\swidth="(\d+)"/)![1]));
  });

  it("--scale and --width resize, keeping the aspect ratio", async () => {
    const f = write();
    await main(["render", f, "-o", join(dir, "1x.png")]);
    const base = pngSize(readFileSync(join(dir, "1x.png")));

    await main(["render", f, "--scale", "2", "-o", join(dir, "2x.png")]);
    expect(pngSize(readFileSync(join(dir, "2x.png")))).toEqual({ w: base.w * 2, h: base.h * 2 });

    await main(["render", f, "--width", "400", "-o", join(dir, "w.png")]);
    const wide = pngSize(readFileSync(join(dir, "w.png")));
    expect(wide.w).toBe(400);
    expect(wide.h / wide.w).toBeCloseTo(base.h / base.w, 1);
  });

  it("is deterministic, and never reads fonts from the machine", async () => {
    // The whole risk of rasterizing: resvg ignores the @font-face our SVGs
    // embed, so if the sfnt faces weren't wired up it would quietly substitute
    // an installed font — or drop the text — and still exit 0. Two renders
    // matching byte-for-byte only proves repeatability, so also assert the
    // text is actually *there*: a diagram with no glyphs drawn compresses far
    // smaller than one with them.
    const f = write();
    const svg = await refSvg(f);
    await main(["render", f, "-o", join(dir, "a.png")]);
    await main(["render", f, "-o", join(dir, "b.png")]);
    const a = readFileSync(join(dir, "a.png"));
    expect(a.equals(readFileSync(join(dir, "b.png")))).toBe(true);

    // Rasterizing the same SVG with an empty font set is what "resvg couldn't
    // find our faces" would look like. It must not match what we ship.
    const { Resvg } = await import("@resvg/resvg-js");
    const fontless = new Resvg(svg, {
      font: { loadSystemFonts: false, fontFiles: [], defaultFontFamily: "Inter" },
    }).render().asPng();
    expect(a.length).toBeGreaterThan(fontless.length);
  });

  it("rejects png to stdout, unknown formats, and conflicting sizes", async () => {
    const f = write();
    expect(await main(["render", f, "--format", "png"])).toBe(2);
    expect(err.join()).toContain("give it a destination");
    expect(await main(["render", f, "--format", "webp", "-o", join(dir, "x")])).toBe(2);
    expect(err.join()).toContain("use svg | png");
    expect(await main(["render", f, "--scale", "2", "--width", "400", "-o", join(dir, "x.png")])).toBe(2);
    expect(err.join()).toContain("pick one");
    expect(await main(["render", f, "--scale", "-1", "-o", join(dir, "x.png")])).toBe(2);
    expect(err.join()).toContain("positive number");
  });
});

describe("diff", () => {
  const BASE = `pack aws
system s "S" {
  api = aws/lambda "API"
  db  = aws/dynamodb "DB" datastore
  api -> db "writes"
}
`;
  const write = (name: string, src: string) => {
    const p = join(dir, name);
    writeFileSync(p, src);
    return p;
  };

  it("compares two paths and separates the weights", async () => {
    const before = write("before.squinch", BASE);
    const after = write("after.squinch", BASE.replace("api -> db", "api ~> db").replace(`"DB"`, `"Orders"`));
    expect(await main(["diff", before, after])).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("structural");
    expect(text).toContain("1 structural, 1 cosmetic");
  });

  it("--format json is machine-readable", async () => {
    const before = write("before.squinch", BASE);
    const after = write("after.squinch", BASE.replace("api -> db", "api ~> db"));
    expect(await main(["diff", before, after, "--format", "json"])).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.structural).toBe(1);
    expect(parsed.changes[0].weight).toBe("structural");
  });

  it("--fail-on gates CI by weight", async () => {
    const before = write("before.squinch", BASE);
    const structural = write("structural.squinch", BASE.replace("api -> db", "api ~> db"));
    const cosmetic = write("cosmetic.squinch", BASE.replace(`"DB"`, `"Orders"`));
    expect(await main(["diff", before, structural, "--fail-on", "structural"])).toBe(1);
    expect(await main(["diff", before, before, "--fail-on", "structural"])).toBe(0);
    // a label edit must not trip the structural gate — that is the whole point
    expect(await main(["diff", before, cosmetic, "--fail-on", "structural"])).toBe(0);
    expect(await main(["diff", before, cosmetic, "--fail-on", "any"])).toBe(1);
  });

  it("rejects an unknown format with a usable message", async () => {
    const before = write("before.squinch", BASE);
    expect(await main(["diff", before, before, "--format", "xml"])).toBe(2);
    expect(err.join("\n")).toContain("text | json | markdown");
  });
});

describe("round-3 gauntlet findings", () => {
  const write = () => {
    const f = join(dir, "d.squinch");
    writeFileSync(f, `${GOOD}\nview other { scope app }\n`);
    return f;
  };

  it("a view name that doesn't exist is an error, not a different diagram", async () => {
    // It used to fall through to the implicit default: exit 0, an SVG written,
    // and none of the named view's settings applied. In a loop driven by exit
    // codes a typo bought you a plausible, wrong picture and said nothing.
    const f = write();
    expect(await main(["render", f, "--view", "ap", "-o", join(dir, "x.svg")])).toBe(2);
    expect(err.join()).toContain("unknown view `ap`");
    expect(err.join()).toContain("did you mean");
    expect(existsSync(join(dir, "x.svg"))).toBe(false);
  });

  it("check reports the views, so `render every view` is actionable", async () => {
    const f = write();
    expect(await main(["check", f, "--format", "json"])).toBe(0);
    const payload = JSON.parse(out.join("\n"));
    expect(payload.views.map((v: { name: string }) => v.name)).toContain("other");
    out = [];
    err = [];
    await main(["check", f]);
    expect(err.join("\n")).toContain("views:");
  });

  it("a project with no views at all checks clean — no phantom `default`", async () => {
    // The round-3 fix above turned an unknown `--view` into a hard error, which
    // armed a sentinel the CLI had been handing itself: with nothing declared,
    // the view list ended in a literal "default" that every caller then asked
    // the renderer for. A valid top-level diagram failed with "unknown view
    // `default`, this project declares no views" — the tool contradicting
    // itself in one sentence. Five of twenty round-4 agents hit it.
    const f = join(dir, "flat.squinch");
    writeFileSync(f, `person u "U"\nweb = aws/ec2 "Web"\nu -> web\n`);
    expect(await main(["check", f, "--format", "json"])).toBe(0);
    const payload = JSON.parse(out.join("\n"));
    expect(payload.ok).toBe(true);
    expect(payload.diagnostics).toEqual([]);
  });

  it("…and still syncs under the `default` label", async () => {
    // `default` remains the filename for that case — it is a label, not a view.
    const f = join(dir, "flat2.squinch");
    writeFileSync(f, `person u "U"\nweb = aws/ec2 "Web"\nu -> web\n`);
    expect(await main(["render", f, "--sync"])).toBe(0);
    expect(existsSync(join(dir, "flat2.default.light.svg"))).toBe(true);
    expect(existsSync(join(dir, "flat2.default.dark.svg"))).toBe(true);
    expect(await main(["render", f, "--check"])).toBe(0);
  });

  it("icon search names the short forms it found the icon under", async () => {
    expect(await main(["icons", "search", "--pack", "azure", "key vault"])).toBe(0);
    const line = out.join("\n");
    expect(line).toContain("azure/key-vaults");
    expect(line).toContain("azure/key-vault"); // the alias SKILL.md teaches
  });

  // ── render flags that had no coverage ────────────────────────────────────

  it("--adaptive emits one file carrying both palettes", async () => {
    // `prefers-color-scheme` in one SVG, merged positionally off a single
    // layout (src/render/adaptive.ts) — so it must be one file, not two, and
    // it must carry the media query that switches them.
    const f = join(dir, "adapt.squinch");
    writeFileSync(f, `a = box "A"\nb = box "B"\na -> b\n`);
    const o = join(dir, "adapt.svg");
    expect(await main(["render", f, "--adaptive", "-o", o])).toBe(0);
    const svg = readFileSync(o, "utf8");
    expect(svg).toContain("prefers-color-scheme");
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("--theme overrides the theme declared in the file", async () => {
    // the precedence `--theme dark` depends on: a file-level `theme` is the
    // default, the flag is the override
    const f = join(dir, "themed.squinch");
    writeFileSync(f, `theme dark\na = box "A"\nb = box "B"\na -> b\n`);
    // the declared theme is the default; --theme is the override
    const asDeclared = join(dir, "declared.svg");
    const overridden = join(dir, "over.svg");
    expect(await main(["render", f, "-o", asDeclared])).toBe(0);
    expect(await main(["render", f, "--theme", "light", "-o", overridden])).toBe(0);
    expect(readFileSync(asDeclared, "utf8")).not.toBe(readFileSync(overridden, "utf8"));
  });

  it("--background is accepted and produces a valid PNG", async () => {
    // Deliberately not asserting the bytes differ: every theme paints its own
    // canvas rect, so a PNG of a Squinch diagram is already opaque and the
    // flag has nothing to show through. The help text used to promise
    // "default: transparent", which was never true; it now says so.
    const f = join(dir, "bg.squinch");
    writeFileSync(f, `a = box "A"\nb = box "B"\na -> b\n`);
    const p1 = join(dir, "clear.png");
    const p2 = join(dir, "white.png");
    expect(await main(["render", f, "-o", p1])).toBe(0);
    expect(await main(["render", f, "-o", p2, "--background", "#ff0000"])).toBe(0);
    for (const p of [p1, p2]) expect(readFileSync(p).subarray(1, 4).toString()).toBe("PNG");
  });

  it("rejects an unknown --theme by name, before rendering anything", async () => {
    const f = join(dir, "badtheme.squinch");
    writeFileSync(f, `a = box "A"\nb = box "B"\na -> b\n`);
    expect(await main(["render", f, "--theme", "drak", "-o", join(dir, "x.svg")])).not.toBe(0);
    expect(existsSync(join(dir, "x.svg"))).toBe(false);
  });
  it("-o *.html builds the interactive export, format inferred", async () => {
    const f = join(dir, "zoom.squinch");
    writeFileSync(f, `system s "S" {\n  a = box "A"\n  b = box "B"\n  a -> b\n}\nview top { include * }\nview inner { scope s }\n`);
    const out = join(dir, "zoom.html");
    expect(await main(["render", f, "-o", out])).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // both views in one file, and the viewer beside them
    expect(html).toContain('data-key="inner|light"');
    expect(html).toContain('id="sq-data"');
    expect(html.match(/<script/g)).toHaveLength(2);
  });

  it("refuses --adaptive for html, and says why", async () => {
    // an interactive export carries real palettes and a real switch; folding
    // two into one SVG makes its sq-t* class names collide across views
    const f = join(dir, "ad.squinch");
    writeFileSync(f, `a = box "A"\nb = box "B"\na -> b\nview v { include * }\n`);
    expect(await main(["render", f, "-o", join(dir, "ad.html"), "--adaptive"])).not.toBe(0);
    expect(existsSync(join(dir, "ad.html"))).toBe(false);
    expect(err.join("\n")).toContain("--adaptive has no meaning for html");
  });

  it("html needs a destination — it is a document, not a stream", async () => {
    const f = join(dir, "nodest.squinch");
    writeFileSync(f, `a = box "A"\nb = box "B"\na -> b\nview v { include * }\n`);
    expect(await main(["render", f, "--format", "html"])).not.toBe(0);
  });
});

describe("flags never swallow the work", () => {
  // A gate that exits 0 without gating is worse than one that crashes. Both
  // bugs here shipped: every boolean flag consumed the token after it, so
  // `render --check <path>` lost its path, and `-v` matched the version flag
  // and returned 0 having validated nothing.
  const BAD = `a = box "A"\na -> nope\nview v { include * }\n`;

  it("a boolean flag before the path leaves the path alone", async () => {
    const f = join(dir, "ok.squinch");
    writeFileSync(f, GOOD);
    expect(await main(["render", "--sync", f])).toBe(0);
    expect(readdirSync(dir).some((n) => n.endsWith(".svg"))).toBe(true);
  });

  it("`check -v <path>` checks, and fails on a broken project", async () => {
    const f = join(dir, "bad.squinch");
    writeFileSync(f, BAD);
    expect(await main(["check", "-v", f])).not.toBe(0);
    expect(out.join("\n")).not.toBe("0.0.0"); // not the version, silently
  });

  it("bare --version prints just the version", async () => {
    expect(await main(["--version"])).toBe(0);
    expect(out.join("\n").split("\n")).toHaveLength(1);
    expect(out.join("\n")).not.toContain("Usage");
  });

  it("BOOLEAN_FLAGS agrees with what USAGE documents", async () => {
    // USAGE writes a value-taking flag as `--theme <name>` and a boolean as a
    // bare `--check`. Any documented bare flag missing from the set would eat
    // the next token again, so the two must not drift.
    const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const documented = [...src.matchAll(/^ {2}(--?[a-z][a-z-]*)( <[^>]+>)?/gm)];
    expect(documented.length, "parsed no flags out of USAGE — the regex is stale").toBeGreaterThan(8);
    const missing = documented
      .filter(([, , arg]) => !arg)
      .map(([, flag]) => flag.replace(/^--?/, ""))
      .filter((f) => !BOOLEAN_FLAGS.has(f));
    expect(missing, `documented as taking no argument but absent from BOOLEAN_FLAGS: ${missing.join(", ")}`).toEqual([]);
  });
});
