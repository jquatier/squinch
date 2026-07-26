import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/index.js";

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
