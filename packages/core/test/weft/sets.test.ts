// Every view of every set, drawn as written and turned on its side: all of
// them legal, and none of them worse than the last recorded picture.
//
//   npx vitest run test/weft/sets.test.ts --disable-console-intercept
//
//   RANDOM=400        more random diagrams than the 80 always drawn (legality
//                     only: the baseline is recorded over the first 80)
//   UPDATE_QUALITY=1  re-record `quality.baseline.json` — in the same commit
//                     as the change that earned the difference
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { draw, sources, QUALITY, SETS, type Quality, type SetName } from "./sets.js";

const BASELINE = join(dirname(fileURLToPath(import.meta.url)), "quality.baseline.json");
/** Random diagrams in the always-on run, and in the recorded baseline. */
const RANDOM_BASE = 80;
const RANDOM = Math.max(RANDOM_BASE, +(process.env.RANDOM ?? RANDOM_BASE));

interface Total { views: number; totals: Quality }
const zero = (): Total => ({ views: 0, totals: Object.fromEntries(QUALITY.map((k) => [k, 0])) as Quality });

/** One set drawn both ways. Returns what broke and the two totals. */
async function run(set: SetName) {
  const illegal: string[] = [];
  const total = { down: zero(), right: zero() };
  const list = sources(set, RANDOM);
  for (const [i, source] of list.entries()) {
    // only the corpus is swept with its auto views: nothing else in CI lays one out
    for (const right of [false, true]) {
      const drawn = await draw(source, { auto: set === "corpus", right, mustBuild: set !== "corpus" });
      for (const d of drawn) {
        for (const line of d.illegal) illegal.push(`${d.view}${right ? " (turned right)" : ""}: ${line}`);
        if (set === "random" && i >= RANDOM_BASE) continue; // beyond the baseline: legality only
        const t = right ? total.right : total.down;
        t.views++;
        for (const k of QUALITY) t.totals[k] += d.quality[k];
      }
    }
  }
  return { illegal, total };
}

describe("every set, as written and turned to flow rightward", () => {
  const measured: Record<string, Total> = {};

  for (const set of SETS)
    it(`${set}: every view is legal`, async () => {
      const { illegal, total } = await run(set);
      measured[set] = total.down;
      measured[`${set}, turned right`] = total.right;
      // the floor keeps a discovery bug from turning the sweep into a no-op
      const floor = { corpus: 120, trial: 30, round2: 30, random: RANDOM_BASE }[set];
      expect(total.down.views).toBeGreaterThanOrEqual(floor);
      expect(illegal.slice(0, 30), `${illegal.length} broken rule(s)`).toEqual([]);
    }, 300_000);

  // The legality sweep says a picture is allowed. This says it is no worse
  // than it was: crossings, bends and the rest of `metrics.ts`, totalled per
  // set, against the numbers recorded the last time someone looked. Lower is
  // better for every one of them; a total that rises fails.
  it("quality: no total is worse than the recorded baseline", () => {
    expect(Object.keys(measured)).toHaveLength(SETS.length * 2);
    if (process.env.UPDATE_QUALITY) {
      writeFileSync(BASELINE, JSON.stringify(measured, null, 2) + "\n");
      console.log(`recorded ${BASELINE}`);
      return;
    }
    expect(existsSync(BASELINE), "no quality.baseline.json — record one with UPDATE_QUALITY=1").toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, Total>;
    const worse: string[] = [], better: string[] = [];
    const cell = (now: number, was: number | undefined) => (was === undefined ? `${now}` : now === was ? `${now}` : `${now} (${now > was ? "+" : ""}${now - was})`).padStart(13);
    console.log(`${"set".padEnd(24)}${"views".padStart(13)}${QUALITY.map((k) => k.padStart(13)).join("")}`);
    for (const [name, now] of Object.entries(measured)) {
      const was = baseline[name];
      console.log(`${name.padEnd(24)}${cell(now.views, was?.views)}${QUALITY.map((k) => cell(now.totals[k], was?.totals[k])).join("")}`);
      if (!was) { worse.push(`${name}: not in the baseline`); continue; }
      // totals over a different set of views are not comparable: a file was
      // added or removed, and the numbers have to be recorded again
      if (was.views !== now.views) { worse.push(`${name}: ${now.views} views, the baseline has ${was.views} — the set changed`); continue; }
      for (const k of QUALITY) {
        if (now.totals[k] > was.totals[k]) worse.push(`${name}: ${k} ${was.totals[k]} → ${now.totals[k]}`);
        if (now.totals[k] < was.totals[k]) better.push(`${name}: ${k} ${was.totals[k]} → ${now.totals[k]}`);
      }
    }
    if (better.length) console.log(`\nbetter than the baseline — record it with UPDATE_QUALITY=1:\n  ${better.join("\n  ")}`);
    expect(worse, "worse than quality.baseline.json (UPDATE_QUALITY=1 re-records, if the change earned it)").toEqual([]);
  });
});
