// `legend { }` — the author's key (SPEC §5). This file holds what the source
// alone decides: the shapes that parse, and every check-time diagnostic. What
// a view draws of it is `view/legend.ts`'s, tested beside it.
import { describe, it, expect } from "vitest";
import { buildModel } from "../src/index.js";
import type { SView } from "../src/model/types.js";

const BASE = `a = box "A" #money\nb = box "B"\na -> b\n`;
const build = (view: string, more = "") => buildModel(`${BASE}view v {\n${view}\n}\n${more}`);
const legendOf = (v: SView | undefined) =>
  !v?.legend ? null : "auto" in v.legend ? "auto" : v.legend.entries.map((e) => [e.key, e.label]);
const viewV = (r: ReturnType<typeof buildModel>) => r.model.views.find((x) => x.name === "v");
const messages = (r: ReturnType<typeof buildModel>) => r.diagnostics.map((d) => `${d.severity}: ${d.message} | ${d.fix}`);

describe("legend { } — parsing", () => {
  it("reads every key kind, in written order, with or without a colon", () => {
    const r = build(`  color #money red\n  legend {\n    #money: "Payment path"\n    -> "Request"\n    ~>: "Event"\n    <-> "Sync both ways"\n    -- "Related"\n    aggregated "Merged calls"\n    external "Third-party"\n    context: "Outside this view"\n  }`);
    expect(r.diagnostics).toEqual([]);
    expect(legendOf(viewV(r))).toEqual([
      ["#money", "Payment path"], ["->", "Request"], ["~>", "Event"], ["<->", "Sync both ways"],
      ["--", "Related"], ["aggregated", "Merged calls"], ["external", "Third-party"], ["context", "Outside this view"],
    ]);
  });

  it("takes entries on one line, separated by nothing, a comma or a semicolon", () => {
    for (const body of [`-> "Request"  ~> "Event"`, `-> "Request", ~> "Event"`, `-> "Request"; ~> "Event"`]) {
      const r = build(`  legend { ${body} }`);
      expect(r.diagnostics).toEqual([]);
      expect(legendOf(viewV(r))).toEqual([["->", "Request"], ["~>", "Event"]]);
    }
  });

  it("reads a block-string label on one line", () => {
    const r = build(`  legend {\n    -> """Request,\n    answered inline"""\n  }`);
    expect(legendOf(viewV(r))).toEqual([["->", "Request, answered inline"]]);
  });

  it("is off by default, also in auto views", () => {
    const r = buildModel(`system s "S" { a = box "A" }\nview v { scope s }`);
    expect(r.model.views.every((v) => v.legend === null)).toBe(true);
  });

  it("keeps `legend auto` and a bare `legend` as the retired form, so it can be named", () => {
    expect(legendOf(viewV(build(`  legend auto`)))).toBe("auto");
    expect(legendOf(viewV(build(`  legend`)))).toBe("auto");
  });

  it("a `{` on the next line is a syntax error, as for every block", () => {
    const r = build(`  legend\n  {\n    -> "Request"\n  }`);
    expect(r.diagnostics.some((d) => d.severity === "error" && d.message.startsWith("syntax error"))).toBe(true);
  });
});

describe("legend { } — check-time diagnostics", () => {
  it("`legend off` warns: there is nothing to turn off", () => {
    const r = build(`  legend off`);
    expect(legendOf(viewV(r))).toBe(null);
    expect(messages(r)).toEqual([
      "warning: `legend off` does nothing — a view has no legend unless it writes one | delete the line",
    ]);
  });

  it("an unknown key names the key it meant, then every key", () => {
    const keys = "keys: -> ~> <-> -- aggregated external context #tag";
    const cases: [string, string, string][] = [
      ["sync", "unknown legend key `sync` — did you mean `->`?", keys],
      ["async", "unknown legend key `async` — did you mean `~>`?", keys],
      ["two-way", "unknown legend key `two-way` — did you mean `<->`?", keys],
      ["merged", "unknown legend key `merged` — did you mean `aggregated`?", keys],
      ["externl", "unknown legend key `externl` — did you mean `external`?", keys],
      ["vpc", "`vpc` is not a legend key — zones and flows name themselves on the drawing", keys],
      ["flow", "`flow` is not a legend key — zones and flows name themselves on the drawing", keys],
      ["red", "`red` is not a legend key — a colour means something only through a tag",
        "tag what it marks, colour the tag in the view (`color #tag red`) and key `#tag`"],
      ["widgets", "unknown legend key `widgets`", keys],
    ];
    for (const [key, message, fix] of cases) {
      const r = build(`  legend { ${key} "X" }`);
      expect(r.ok).toBe(false);
      expect(r.diagnostics.map((d) => [d.message, d.fix])).toEqual([[message, fix]]);
    }
  });

  it("every line needs a label — none is written for you", () => {
    for (const line of [`external`, `external ""`, `external: "  "`]) {
      const r = build(`  legend {\n    ${line}\n  }`);
      expect(r.diagnostics.map((d) => d.message)).toEqual(["`external` needs a label — what does it mean in this view?"]);
    }
  });

  it("a key written twice, an empty block and a second statement are errors", () => {
    expect(messages(build(`  legend {\n    -> "A"\n    -> "B"\n  }`))).toEqual([
      "error: `->` is in this legend twice | keep one line for it",
    ]);
    expect(build(`  legend { }`).diagnostics.map((d) => d.message)).toEqual(["this `legend { }` is empty"]);
    const two = build(`  legend { -> "A" }\n  legend { ~> "B" }`);
    expect(two.diagnostics.map((d) => [d.message, d.loc.line])).toEqual([
      ["a view takes one `legend` — this is the second", 6],
    ]);
    // the first statement still stands
    expect(legendOf(viewV(two))).toEqual([["->", "A"]]);
  });

  it("a tag no view colours is an error; one coloured elsewhere is not", () => {
    const typo = build(`  color #money red\n  legend { #mony "Money" }`);
    expect(messages(typo)).toEqual([
      "error: `#mony` is coloured in no view, so its legend entry can never show | did you mean `#money`?",
    ]);
    const none = build(`  legend { #money "Money" }`);
    expect(messages(none)).toEqual([
      "error: `#money` is coloured in no view, so its legend entry can never show | add a `color #money` line, with the hue you want, to the views it should colour",
    ]);
    // round 37: the tag the view highlights — a highlight needs no key
    const lit = build(`  highlight #money\n  legend { #money "Money" }`);
    expect(messages(lit)).toEqual([
      "error: `#money` is highlighted, not coloured — a legend keys a colour, and a highlight needs no key | drop the entry, or colour the tag: add a `color #money` line, with the hue you want, to the views it should colour",
    ]);
    // one block pasted into every view: a view that does not colour the tag
    // just leaves the entry out (view/legend.ts), so this checks clean
    const shared = build(`  legend { #money "Money" }`, `view w {\n  color #money red\n  legend { #money "Money" }\n}`);
    expect(shared.diagnostics).toEqual([]);
  });

  it("points each error at its own line", () => {
    const r = build(`  legend {\n    -> "A"\n    sync "B"\n    external\n  }`);
    expect(r.diagnostics.map((d) => d.loc.line)).toEqual([7, 8]);
  });
});
