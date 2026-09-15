import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectNotices, compareVersions, formatNotices, refreshCache, isSkipped,
  BACKOFF_MS, FRESH_MS, REGISTRY, TIMEOUT_MS, type UpdateDeps,
} from "../src/update.js";

const PKG = { name: "squinch", version: "0.4.0" };
const NOW = 1_800_000_000_000;
const STAMP = (v: string) =>
  `---\nname: squinch\ndescription: x\n---\n\n<!-- installed by squinch ${v} — after upgrading squinch, re-run \`squinch skill\` so this guidance matches the CLI it drives -->\n\n# Squinch\n`;

let root: string;
let home: string;
let cwd: string;
let cache: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squinch-update-"));
  home = join(root, "home");
  cwd = join(root, "proj");
  cache = join(root, "cache");
  mkdirSync(home);
  mkdirSync(cwd);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Everything injected: no process.env, no real clock, no real network. */
const deps = (over: Partial<UpdateDeps> = {}): UpdateDeps => ({
  env: {},
  home,
  cwd,
  now: () => NOW,
  fetch: vi.fn(() => new Promise<Response>(() => {})), // never resolves unless a test says so
  cacheDir: cache,
  ...over,
});
const okFetch = (version: unknown) =>
  vi.fn(async () => ({ ok: true, json: async () => ({ version }) }) as unknown as Response);
const seed = (data: unknown, dir = cache) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "update.json"), typeof data === "string" ? data : JSON.stringify(data));
};
const readCache = (dir = cache) => JSON.parse(readFileSync(join(dir, "update.json"), "utf8"));
const settle = async (until: () => boolean) => {
  for (let i = 0; i < 50 && !until(); i++) await new Promise((r) => setTimeout(r, 5));
};
const skill = (dir: string, which: ".agents" | ".claude", stamp?: string) => {
  const d = join(dir, which, "skills", "squinch");
  mkdirSync(d, { recursive: true });
  const file = join(d, "SKILL.md");
  writeFileSync(file, stamp === undefined ? "---\nname: squinch\n---\n# unstamped\n" : STAMP(stamp));
  return file;
};

describe("compareVersions", () => {
  it.each([
    ["0.4.0", "0.5.0", -1],
    ["0.4.9", "0.4.10", -1],
    ["0.10.0", "0.9.0", 1],
    ["0.5.0-beta.1", "0.5.0", -1],
    ["0.5.0", "0.5.0-beta.1", 1],
    ["0.5.0-a", "0.5.0-b", 0],
    ["1.2.3", "1.2.3", 0],
    ["latest", "0.4.0", 0],
    ["0.4.0", "", 0],
  ])("%s vs %s → %i", (a, b, want) => {
    expect(compareVersions(a, b)).toBe(want);
  });
});

describe("the update notice", () => {
  it("comes from the cache alone: no cache means no notice, and a refresh starts", () => {
    const d = deps();
    expect(collectNotices(PKG, d)).toEqual({});
    refreshCache(PKG, d);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect((d.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(`${REGISTRY}/squinch/latest`);
  });

  it("is silent when latest is not newer — equal, or a dev checkout ahead of npm", () => {
    for (const latest of ["0.4.0", "0.3.9", "0.4.0-rc.1"]) {
      seed({ checkedAt: NOW, latest });
      const d = deps();
      expect(collectNotices(PKG, d)).toEqual({});
      refreshCache(PKG, d);
      expect(d.fetch).not.toHaveBeenCalled(); // fresh cache, nothing to do
    }
  });

  it("names the newer version and the global upgrade command", () => {
    seed({ checkedAt: NOW, latest: "0.5.0" });
    expect(collectNotices(PKG, deps()).update).toEqual({
      name: "squinch",
      current: "0.4.0",
      latest: "0.5.0",
      command: "npm i -g squinch@latest, then squinch skill",
    });
  });

  it("tells an npx user to pin @latest instead", () => {
    seed({ checkedAt: NOW, latest: "0.5.0" });
    const argv1 = "/Users/x/.npm/_npx/abc123/node_modules/squinch/bin/squinch.js";
    expect(collectNotices(PKG, deps({ argv1 })).update?.command).toBe("npx squinch@latest skill");
  });

  it.each(["SQUINCH_NO_UPDATE_CHECK", "CI", "GITHUB_ACTIONS"])("is off entirely under %s", (k) => {
    seed({ checkedAt: NOW - 2 * FRESH_MS, latest: "9.9.9" });
    skill(cwd, ".agents", "0.1.0");
    const d = deps({ env: { [k]: "true" } });
    expect(isSkipped(d.env)).toBe(true);
    expect(collectNotices(PKG, d)).toEqual({}); // neither the update nor the skill scan
    refreshCache(PKG, d);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("treats CI=false as not CI", () => {
    seed({ checkedAt: NOW, latest: "9.9.9" });
    expect(collectNotices(PKG, deps({ env: { CI: "false" } })).update).toBeDefined();
  });

  it("treats a garbage cache as missing", () => {
    seed("{not json");
    const d = deps();
    expect(collectNotices(PKG, d)).toEqual({});
    refreshCache(PKG, d);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    seed({ checkedAt: "yesterday", latest: "9.9.9" });
    expect(collectNotices(PKG, deps())).toEqual({});
  });

  it("refreshes a stale cache atomically and stamps the attempt time", async () => {
    seed({ checkedAt: NOW - FRESH_MS - 1, latest: "0.4.0" });
    const d = deps({ fetch: okFetch("0.6.0") });
    refreshCache(PKG, d);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    await settle(() => readCache().latest === "0.6.0");
    expect(readCache()).toEqual({ checkedAt: NOW, latest: "0.6.0" });
    expect(readdirSync(cache)).toEqual(["update.json"]); // no *.tmp left behind
    // and now it is fresh: a second call does nothing
    refreshCache(PKG, d);
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it("a failed fetch records the attempt, keeps yesterday's fact, and backs off briefly", async () => {
    const failing = vi.fn(async () => { throw new Error("ENOTFOUND"); });
    const d = deps({ fetch: failing });
    refreshCache(PKG, d);
    expect(failing).toHaveBeenCalledTimes(1);
    await settle(() => existsSync(join(cache, "update.json")));
    await new Promise((r) => setTimeout(r, 20)); // let the rejection land — the run would fail if unhandled
    expect(readCache()).toEqual({ checkedAt: NOW });
    // one minute later: still backing off; ten minutes later: retry
    refreshCache(PKG, deps({ fetch: failing, now: () => NOW + 60_000 }));
    expect(failing).toHaveBeenCalledTimes(1);
    refreshCache(PKG, deps({ fetch: failing, now: () => NOW + BACKOFF_MS }));
    expect(failing).toHaveBeenCalledTimes(2);
    // a known latest survives a failed attempt, so the notice keeps showing
    seed({ checkedAt: NOW - FRESH_MS, latest: "0.5.0" });
    refreshCache(PKG, deps({ fetch: failing }));
    expect(readCache()).toEqual({ checkedAt: NOW, latest: "0.5.0" });
  });

  it("aborts a hung registry and swallows it", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const hung = vi.fn((_url: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((_, reject) =>
          init.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); })));
      refreshCache(PKG, deps({ fetch: hung as unknown as typeof fetch }));
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not trust a registry answer that is not a version", async () => {
    for (const bad of ["latest", 5, undefined, "1.2"]) {
      rmSync(cache, { recursive: true, force: true });
      const d = deps({ fetch: okFetch(bad) });
      refreshCache(PKG, d);
      await settle(() => existsSync(join(cache, "update.json")));
      await new Promise((r) => setTimeout(r, 20));
      expect(readCache()).toEqual({ checkedAt: NOW });
    }
  });

  it("gives up silently when the cache dir cannot be made, and treats a future stamp as stale", () => {
    writeFileSync(cache, "a file where the dir should be");
    const d = deps({ fetch: okFetch("9.9.9") });
    expect(collectNotices(PKG, d)).toEqual({});
    refreshCache(PKG, d); // no throw
    rmSync(cache);
    seed({ checkedAt: NOW + 60_000, latest: "0.4.0" });
    const d2 = deps();
    refreshCache(PKG, d2);
    expect(d2.fetch).toHaveBeenCalledTimes(1);
  });

  it("locates the cache by SQUINCH_CACHE_DIR, then XDG_CACHE_HOME, then ~/.cache", () => {
    const explicit = join(root, "explicit");
    const xdg = join(root, "xdg");
    seed({ checkedAt: NOW, latest: "1.0.0" }, explicit);
    seed({ checkedAt: NOW, latest: "2.0.0" }, join(xdg, "squinch"));
    seed({ checkedAt: NOW, latest: "3.0.0" }, join(home, ".cache", "squinch"));
    const env = { SQUINCH_CACHE_DIR: explicit, XDG_CACHE_HOME: xdg };
    expect(collectNotices(PKG, deps({ cacheDir: undefined, env })).update?.latest).toBe("1.0.0");
    expect(collectNotices(PKG, deps({ cacheDir: undefined, env: { XDG_CACHE_HOME: xdg } })).update?.latest).toBe("2.0.0");
    expect(collectNotices(PKG, deps({ cacheDir: undefined, env: {} })).update?.latest).toBe("3.0.0");
  });
});

describe("the skill-drift notice", () => {
  it("reports each installed copy whose stamp differs from the running version", () => {
    const a = skill(cwd, ".agents", "0.3.0");
    expect(collectNotices(PKG, deps()).skill).toEqual([{ file: a, installed: "0.3.0", current: "0.4.0" }]);
    const c = skill(cwd, ".claude", "0.3.0");
    expect(collectNotices(PKG, deps()).skill?.map((s) => s.file)).toEqual([a, c]);
    const h = skill(home, ".agents", "0.2.0");
    expect(collectNotices(PKG, deps()).skill?.map((s) => s.file)).toEqual([a, c, h]);
  });

  it("is silent for a matching stamp and for an unstamped copy", () => {
    skill(cwd, ".agents", "0.4.0");
    skill(cwd, ".claude");
    skill(home, ".claude");
    expect(collectNotices(PKG, deps())).toEqual({});
  });

  it("walks up from cwd to the project root and stops there", () => {
    const a = skill(cwd, ".agents", "0.3.0");
    skill(root, ".agents", "0.1.0"); // an outer install must not be reported past the nearer one
    const deep = join(cwd, "diagrams", "sub");
    mkdirSync(deep, { recursive: true });
    expect(collectNotices(PKG, deps({ cwd: deep })).skill?.map((s) => s.file)).toEqual([a]);
  });

  it("does not report the home copy twice when cwd is under home", () => {
    const h = skill(home, ".agents", "0.3.0");
    expect(collectNotices(PKG, deps({ cwd: join(home, "work") })).skill?.map((s) => s.file)).toEqual([h]);
  });
});

describe("formatNotices", () => {
  it("writes the exact lines, with a prefix that is neither error: nor a diagnostic", () => {
    expect(
      formatNotices({
        update: { name: "squinch", current: "0.4.0", latest: "0.5.0", command: "npm i -g squinch@latest, then squinch skill" },
        skill: [
          { file: "/p/.agents/skills/squinch/SKILL.md", installed: "0.3.0", current: "0.4.0" },
          { file: "/p/.claude/skills/squinch/SKILL.md", installed: "0.6.0", current: "0.4.0" },
        ],
      }),
    ).toEqual([
      "update: squinch 0.5.0 is available (running 0.4.0) — npm i -g squinch@latest, then squinch skill",
      "skill: /p/.agents/skills/squinch/SKILL.md was installed by squinch 0.3.0, this is 0.4.0 — re-run squinch skill",
      "skill: /p/.claude/skills/squinch/SKILL.md was installed by squinch 0.6.0, this is 0.4.0 — upgrade squinch",
    ]);
    expect(formatNotices({})).toEqual([]);
  });
});
