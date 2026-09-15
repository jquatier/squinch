// Update notices — "a newer squinch is on npm" and "this skill was installed
// by a different squinch". CLI-only: core never imports this, because it reads
// the clock, the environment and the network, all three banned in the render
// path (and guarded against in core's test/guardrails.test.ts).
//
// The reader is usually a coding agent, not a person at a terminal, which is
// why nothing here looks at whether stderr is a TTY: npm's convention of going
// quiet off-terminal would make the feature invisible to its audience. The
// notice is computed synchronously from a cache alone; the registry lookup
// that refreshes that cache runs in the background and is never awaited — the
// process exits when the command is done, a slow fetch dies with it, and the
// *next* run reads what a completed one wrote. docs/notes/update-check.md has
// the reasoning and the rejected alternatives.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export interface UpdateDeps {
  env: Record<string, string | undefined>;
  home: string;
  cwd: string;
  now: () => number;
  fetch?: typeof fetch;
  /** `process.argv[1]` — how the binary was reached, which decides the upgrade command. */
  argv1?: string;
  /** Overrides every env/home rule for where `update.json` lives. */
  cacheDir?: string;
}

export interface Notices {
  update?: { name: string; current: string; latest: string; command: string };
  skill?: { file: string; installed: string; current: string }[];
}

export interface Pkg {
  name: string;
  version: string;
}

interface Cache {
  checkedAt: number;
  latest?: string;
}

export const REGISTRY = "https://registry.npmjs.org";
/** A cache that knows a `latest` is trusted this long. */
export const FRESH_MS = 24 * 60 * 60 * 1000;
/** A cache without one — an attempt in flight, or one that failed — is retried
 *  after this. Short, because a fast command (`--version`, `icons`) exits
 *  before the registry answers, and a day-long throttle on that would blank
 *  every notice until tomorrow. */
export const BACKOFF_MS = 10 * 60 * 1000;
export const TIMEOUT_MS = 3000;

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const STAMP_RE = /<!-- installed by squinch ([0-9A-Za-z.+-]+) /;
const SKILL_FILES = [
  join(".agents", "skills", "squinch", "SKILL.md"),
  join(".claude", "skills", "squinch", "SKILL.md"),
];

export function defaultDeps(): UpdateDeps {
  return {
    env: process.env,
    home: homedir(),
    cwd: process.cwd(),
    now: Date.now,
    fetch:
      typeof globalThis.fetch === "function" ? globalThis.fetch : undefined,
    argv1: process.argv[1],
  };
}

const truthy = (v: string | undefined): boolean =>
  v !== undefined && v !== "" && v !== "0" && v !== "false";

/** CI never reads a notice and must never touch the network for one; the
 *  explicit opt-out covers everyone else (the test suites and the gauntlet
 *  set it, so no test process reaches the registry). */
export function isSkipped(env: UpdateDeps["env"]): boolean {
  return (
    truthy(env.SQUINCH_NO_UPDATE_CHECK) ||
    truthy(env.CI) ||
    truthy(env.GITHUB_ACTIONS)
  );
}

function cacheDirOf(deps: UpdateDeps): string {
  const dir =
    deps.cacheDir ??
    deps.env.SQUINCH_CACHE_DIR ??
    (deps.env.XDG_CACHE_HOME
      ? join(deps.env.XDG_CACHE_HOME, "squinch")
      : join(deps.home, ".cache", "squinch"));
  return resolve(deps.cwd, dir);
}

/** Anything unreadable or malformed is "no cache": the next refresh rewrites it. */
function readCache(dir: string): Cache | undefined {
  try {
    const j = JSON.parse(
      readFileSync(join(dir, "update.json"), "utf8"),
    ) as Partial<Cache>;
    if (typeof j?.checkedAt !== "number" || !Number.isFinite(j.checkedAt))
      return undefined;
    const latest =
      typeof j.latest === "string" && VERSION_RE.test(j.latest)
        ? j.latest
        : undefined;
    return latest
      ? { checkedAt: j.checkedAt, latest }
      : { checkedAt: j.checkedAt };
  } catch {
    return undefined;
  }
}

/** Write via a per-process temp file and rename, because an agent runs several
 *  `squinch` processes at once and a reader must never see half a file. Every
 *  failure is swallowed — a read-only home means no cache and no notice, not
 *  a broken `check`. */
function writeCache(dir: string, data: Cache): void {
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `update.json.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(data) + "\n");
    try {
      renameSync(tmp, join(dir, "update.json"));
    } catch {
      // Windows refuses to replace a file another process has open (EPERM /
      // EBUSY); the other writer's payload is equivalent, so drop ours.
      rmSync(tmp, { force: true });
    }
  } catch {
    /* unwritable cache dir */
  }
}

function isStale(cache: Cache | undefined, now: number): boolean {
  if (!cache) return true;
  const age = now - cache.checkedAt;
  if (age < 0) return true; // clock went backwards; a future stamp must not be fresh forever
  return age >= (cache.latest ? FRESH_MS : BACKOFF_MS);
}

/** Numeric x.y.z, a release beating its own prereleases. Two prereleases of one
 *  triple compare equal (no identifier ordering — nothing here needs it), and
 *  anything unparseable compares equal to everything, so garbage from a cache
 *  or a registry can never read as "newer". */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = VERSION_RE.exec(a);
  const pb = VERSION_RE.exec(b);
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  const preA = pa[4] !== undefined;
  const preB = pb[4] !== undefined;
  if (preA === preB) return 0;
  return preA ? -1 : 1;
}

/** The first 2 KB is plenty: the stamp sits right under the frontmatter, and
 *  the file behind it is 40 KB of skill. An unstamped copy is silent — a hand
 *  copy or a pre-stamp install is a file the user may own, and a false
 *  positive tells an agent to overwrite it. */
function readStamp(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(2048);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return STAMP_RE.exec(buf.toString("utf8", 0, n))?.[1];
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Skills live at a project root or under $HOME, never beside the diagram the
 *  command names, so this walks up from cwd and stops at the first directory
 *  holding either copy — the rule the agents themselves discover skills by —
 *  then adds the home copies. No git: `repoRoot` throws outside a repository
 *  and costs a spawn on a startup-bound CLI. */
function skillFiles(cwd: string, home: string): string[] {
  const found: string[] = [];
  let dir = resolve(cwd);
  for (;;) {
    const hits = SKILL_FILES.map((r) => join(dir, r)).filter((f) =>
      existsSync(f),
    );
    if (hits.length) {
      found.push(...hits);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const r of SKILL_FILES) {
    const f = join(resolve(home), r);
    if (existsSync(f)) found.push(f);
  }
  return [...new Set(found)];
}

/** Synchronous and side-effect free: cache + a few file reads, no network. */
export function collectNotices(pkg: Pkg, deps: UpdateDeps): Notices {
  if (isSkipped(deps.env)) return {};
  const notices: Notices = {};
  try {
    const cache = readCache(cacheDirOf(deps));
    if (cache?.latest && compareVersions(cache.latest, pkg.version) > 0) {
      const npx = (deps.argv1 ?? "").includes("_npx");
      notices.update = {
        name: pkg.name,
        current: pkg.version,
        latest: cache.latest,
        command: npx
          ? `npx ${pkg.name}@latest skill`
          : `npm i -g ${pkg.name}@latest, then ${pkg.name} skill`,
      };
    }
    const drifted = skillFiles(deps.cwd, deps.home)
      .map((file) => ({ file, installed: readStamp(file) }))
      .filter(
        (s): s is { file: string; installed: string } =>
          !!s.installed && s.installed !== pkg.version,
      )
      .map((s) => ({ ...s, current: pkg.version }));
    if (drifted.length) notices.skill = drifted;
  } catch {
    /* a notice is never worth a failed command */
  }
  return notices;
}

/** Fire-and-forget: refreshes the cache for the *next* run when this one's is
 *  stale. Never throws, never rejects, never keeps the process alive — an
 *  early `ENOTFOUND` reaching the unhandled-rejection handler would exit a
 *  clean `check` with 1, the one failure a gate must never have. */
export function refreshCache(pkg: Pkg, deps: UpdateDeps): void {
  if (isSkipped(deps.env)) return;
  const fetchFn = deps.fetch;
  if (typeof fetchFn !== "function") return;
  let dir: string;
  let cache: Cache | undefined;
  try {
    dir = cacheDirOf(deps);
    cache = readCache(dir);
    if (!isStale(cache, deps.now())) return;
    // Stamp the attempt first so concurrent processes don't all fetch, and a
    // failure backs off rather than retrying every call. A known `latest`
    // survives the attempt: a fact from yesterday beats none.
    writeCache(dir, {
      checkedAt: deps.now(),
      ...(cache?.latest ? { latest: cache.latest } : {}),
    });
  } catch {
    return;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  timer.unref?.();
  void (async () => {
    try {
      const res = await fetchFn(`${REGISTRY}/${pkg.name}/latest`, {
        signal: ctrl.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { version?: unknown };
      const latest = body?.version;
      if (typeof latest !== "string" || !VERSION_RE.test(latest)) return;
      writeCache(dir, { checkedAt: deps.now(), latest });
    } catch {
      /* offline, aborted, garbage — the backoff retries */
    } finally {
      clearTimeout(timer);
    }
  })().catch(() => {});
}

/** The stderr lines. Prefixes are `update:` and `skill:` — lowercase word,
 *  colon — beside this CLI's `error:` and `note:`, and never in the
 *  `file:line:col severity:` shape of a diagnostic, because the skill's
 *  definition of clean is "exit 0 and no diagnostics". */
export function formatNotices(n: Notices): string[] {
  const lines: string[] = [];
  if (n.update)
    lines.push(
      `update: ${n.update.name} ${n.update.latest} is available (running ${n.update.current}) — ${n.update.command}`,
    );
  for (const s of n.skill ?? [])
    lines.push(
      `skill: ${s.file} was installed by squinch ${s.installed}, this is ${s.current} — ` +
        (compareVersions(s.installed, s.current) > 0
          ? "upgrade squinch"
          : "re-run squinch skill"),
    );
  return lines;
}
