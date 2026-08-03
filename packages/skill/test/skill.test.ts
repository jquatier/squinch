// SKILL.md is the whole contract with the product's primary consumer, and across
// four cold-agent rounds it produced more findings than any source file — a
// cookbook row keyed to the wrong diagnostic, an icon id that had moved, a
// construct implemented but never documented, an idiom whose second half did
// nothing. None of it was mechanically checked; `packages/cli/test/readme.test.ts`
// had already shown the technique in 35 lines.
//
// These tests check the guide against the engine rather than against a snapshot,
// so they fail when the *tool* drifts away from the doc, which is the direction
// drift actually travels.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildModel, iconExists, packExists } from "@squinch/core";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(pkg, "SKILL.md"), "utf8");
const CORE = join(pkg, "..", "core", "src");

/** Fenced ```squinch blocks, in document order. */
const blocks = [...SKILL.matchAll(/```squinch\n([\s\S]*?)```/g)].map((m) => m[1]);

describe("SKILL.md — icon references", () => {
  // Icon ids are the single most rot-prone thing in the guide: packs regenerate
  // with `npm run fetch`, vendors rename, and a dead id sends an agent hunting
  // for a service that "does not exist". Round 3 watched two agents conclude
  // SKILL.md was wrong when it was `icons search` that was broken.
  const refs = [
    ...new Set(
      [...SKILL.matchAll(/\b(aws|azure|logos|sys|builtin|k8s)\/([a-z0-9][a-z0-9-]*)\b/g)].map(
        (m) => `${m[1]}/${m[2]}`,
      ),
    ),
  ];

  it("quotes a meaningful number of them, so this test cannot pass vacuously", () => {
    expect(refs.length).toBeGreaterThan(50);
  });

  it("every icon id it names resolves against the installed packs", () => {
    const dead = refs.filter((r) => {
      const [p, id] = r.split("/");
      return !packExists(p) || !iconExists(p, id);
    });
    expect(dead, `SKILL.md names icons that no longer exist: ${dead.join(", ")}`).toEqual([]);
  });
});

describe("SKILL.md — example blocks", () => {
  it("has the blocks this file assumes", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(4);
  });

  // The blocks are deliberately *fragments* — later ones reference ids declared
  // in earlier ones — so "builds clean" is the wrong bar. What must hold is that
  // the grammar accepts every line: a shape the parser rejects is a shape an
  // agent will copy and then have to debug. That is exactly how the missing
  // `"Label" datastore { … }` ordering cost two rounds an iteration.
  it("every block is syntactically valid", () => {
    blocks.forEach((src, i) => {
      const syntax = buildModel(src).diagnostics.filter((d) =>
        d.message.startsWith("syntax error"),
      );
      expect(syntax.map((d) => `line ${d.loc.line}: ${d.message}`), `block ${i}`).toEqual([]);
    });
  });

  it("raises nothing but unresolved cross-references", () => {
    // Anything else — a bad icon, a rejected attr, a conflicting hint — means the
    // guide is teaching something the engine refuses.
    blocks.forEach((src, i) => {
      const bad = buildModel(src)
        .diagnostics.filter((d) => d.severity === "error" && !d.message.includes("unknown id"))
        .map((d) => `line ${d.loc.line}: ${d.message}`);
      expect(bad, `block ${i}`).toEqual([]);
    });
  });
});

describe("SKILL.md — grammar coverage", () => {
  const grammar = readFileSync(join(CORE, "grammar", "squinch.grammar"), "utf8");
  const keywords = [...new Set([...grammar.matchAll(/kw<"([a-z-]+)">/g)].map((m) => m[1]))];
  /** Statement *verbs* — the first keyword of a production. Their argument
   *  words (`off`, `east`, `descriptions`) are values, not things you reach
   *  for, and a single example cannot show both arms of an enum anyway. */
  const verbs = [
    ...new Set([...grammar.matchAll(/\w+(?:Stmt|Decl|Block)\s*\{\s*kw<"([a-z-]+)">/g)].map((m) => m[1])),
  ];

  it("documents every keyword the grammar accepts", () => {
    // `cols` shipped implemented-but-undocumented and was therefore unusable —
    // no agent could reach for a word it had never been shown.
    expect(keywords.length).toBeGreaterThan(20);
    const missing = keywords.filter((k) => !new RegExp(`\\b${k}\\b`).test(SKILL));
    expect(missing, `grammar keywords absent from SKILL.md: ${missing.join(", ")}`).toEqual([]);
  });

  it("shows every keyword the cookbook recommends in a fenced block", () => {
    // Round 4's lesson: fixing the prose was not enough, because agents copy the
    // reference block. A verb the cookbook names but no example shows is a verb
    // that will be spelled wrong.
    // the table only — past it sits the quality bar, whose `--theme light` is a
    // CLI flag rather than a recommendation to write `theme` in a view
    const table = SKILL.slice(SKILL.indexOf("## Layout cookbook"));
    const cookbook = table.slice(0, table.indexOf("\n## ", 3) + 1 || undefined);
    const shown = blocks.join("\n");
    const named = verbs.filter((k) => new RegExp(`\`[^\`]*\\b${k}\\b`).test(cookbook));
    const unshown = named.filter((k) => !new RegExp(`\\b${k}\\b`).test(shown));
    expect(unshown, `recommended by the cookbook but in no example: ${unshown.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("SKILL.md — diagnostic coverage", () => {
  /** Every diagnostic the engine can emit, as its leading literal words. */
  function engineMessages(): string[] {
    const files: string[] = [];
    (function walk(d: string) {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.includes("grammar/parser")) files.push(p);
      }
    })(CORE);
    const out = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:message:\s*|(?:error|warn)\([^,]+,\s*[^,]+,\s*)`/g)) {
        // Every literal run in the template, not just the one before the first
        // `${}`. Taking only the prefix skipped every message that *opens* with
        // an interpolation — `` `${x} runs upward — row …` `` — which is 23 of
        // 41 of them, so the check covered three quarters of what it claimed.
        // `runs upward` was in the blind spot, and is what a round-5 agent hit.
        const parts: string[] = [];
        let lit = "";
        for (let i = m.index! + m[0].length; i < src.length; i++) {
          const c = src[i];
          if (c === "\\") { lit += src[i + 1] === "`" ? "`" : ""; i++; continue; }
          if (c === "$" && src[i + 1] === "{") {
            parts.push(lit); lit = "";
            // skip the expression, counting braces so `${a ? `${b}` : c}` closes
            let depth = 1;
            i++;
            while (depth && ++i < src.length) {
              if (src[i] === "{") depth++;
              else if (src[i] === "}") depth--;
            }
            continue;
          }
          if (c === "`") { parts.push(lit); break; }
          lit += c;
        }
        // strip the punctuation that abuts an interpolation, so this matches the
        // cookbook's `"hint conflict … runs upward"` elision style
        const clean = (s: string) => s.trim().replace(/^[\s:`—-]+|[\s:`—-]+$/g, "");
        // the longest run identifies the message; the prefix stays keyed too,
        // since that is what the existing cookbook rows are written against
        const runs = parts.map(clean).filter((s) => s.length >= 4);
        if (!runs.length) continue;
        // the prefix, because that is what the existing cookbook rows are
        // written against, and the longest run, because that is what identifies
        // a message which opens with an interpolation
        out.add(runs[0]);
        out.add(runs.reduce((a, b) => (b.length > a.length ? b : a)));
      }
    }
    return [...out].sort();
  }

  /** Diagnostics whose own `fix:` fully answers them — a did-you-mean or an
   *  exact substitution. A cookbook row would only restate the message. */
  const SELF_EXPLANATORY = new Set([
    "unknown icon", "unknown id", "unknown pack", "unknown view", "unknown theme",
    "unknown flow", "unknown zone kind", "unknown zone color", "unknown zone label position",
    "unknown density", "unknown lines style", "duplicate id", "duplicate flow",
    "duplicate zone", "duplicate edge", "syntax error near", "ambiguous flow step",
    "contradictory place hints", "flow", "theme", "zone", "zones", "exclude #",
    // Newly visible once the extractor stopped reading only the prefix. Each
    // carries a fix that names the exact substitution — the members to copy,
    // the themes that pair, the `detail` to write — so a cookbook row would
    // only restate it. The ones that needed a technique got one instead.
    "has no members", "has no steps", "listed twice in zone",
    "theme roles only, never hex", "is a zone, not a node",
    "has no dark counterpart to pair with", "has no visible members in view",
    "is included, but", "is already here as a context card", "edges match `route",
    "nothing is tagged #", "it sits inside an expanded container",
    "'s axis would collide with", "'s axis would take it outside zone",
  ]);

  it("every diagnostic that needs a technique is in the cookbook", () => {
    // The reverse of the usual check. Round 4's finding #4 was a cookbook row
    // keyed to a *different* diagnostic's text, which misroutes in both
    // directions; this catches the other half — a diagnostic that ships without
    // the agent ever being told what to do about it.
    const messages = engineMessages();
    expect(messages.length).toBeGreaterThan(20);
    const undocumented = messages
      .filter((m) => !SELF_EXPLANATORY.has(m))
      .filter((m) => !SKILL.includes(m));
    expect(
      undocumented,
      `engine diagnostics with no guidance in SKILL.md: ${undocumented.map((u) => JSON.stringify(u)).join(", ")}`,
    ).toEqual([]);
  });

  it("the allowlist stays honest — every entry is still a real diagnostic", () => {
    // Otherwise a renamed message silently drops out of the check above by
    // leaving a stale allowlist entry behind.
    const messages = new Set(engineMessages());
    const stale = [...SELF_EXPLANATORY].filter((m) => !messages.has(m));
    expect(stale, `allowlisted messages the engine no longer emits: ${stale.join(", ")}`).toEqual(
      [],
    );
  });
});
