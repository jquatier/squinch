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
