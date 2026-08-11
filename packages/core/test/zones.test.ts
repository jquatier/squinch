// Zones (SPEC §Zones): cross-cutting deployment boundaries — a separate
// hierarchy from ownership, rendered as dashed kind-tinted frames.
import { describe, it, expect } from "vitest";
import { buildModel, buildProject, render } from "../src/index.js";
import { layoutView } from "../src/layout/layout.js";
import { validateSVG } from "../src/render/validate.js";

const BASE = `pack aws

erp = box "Legacy ERP" external

system ingest "Ingestion" {
  gw = aws/api-gateway "Gateway"
  fn = aws/lambda "Sync Worker"
  gw -> fn
}

system core "Core Platform" {
  api = aws/lambda "API"
  db  = aws/aurora "Database" datastore
  api -> db
}

erp ~> ingest.gw "nightly batch"
ingest.fn -> core.api "events"
`;

const ZONES = `
zone onprem "On-Premises" onprem {
  contains erp
}
zone cloud "AWS Cloud" cloud {
  contains ingest, core
}
zone vpc1 "VPC prod-main" vpc {
  contains core
}

view landscape {
  include *
}
`;

describe("zones — model", () => {
  it("parses zones with kind and members", () => {
    const r = buildModel(BASE + ZONES);
    expect(r.ok).toBe(true);
    expect(r.model.zones.map((z) => z.id)).toEqual(["onprem", "cloud", "vpc1"]);
    expect(r.model.zones[1].kind).toBe("cloud");
    expect(r.model.zones[1].members).toEqual(["ingest", "core"]);
  });

  it("kind defaults to custom; unknown kinds get did-you-mean", () => {
    const ok = buildModel(BASE + `zone z1 "Z" { contains erp }\n`);
    expect(ok.model.zones[0].kind).toBe("custom");
    const bad = buildModel(BASE + `zone z2 "Z" vcp { contains erp }\n`);
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0].message).toContain("unknown zone kind");
    expect(bad.diagnostics[0].fix).toContain("vpc");
  });

  it("unknown members resolve with did-you-mean; empty zones warn", () => {
    const r = buildModel(BASE + `zone z "Z" { contains ingst }\n`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.fix?.includes("ingest"))).toBe(true);
    const empty = buildModel(BASE + `zone z "Z" vpc { }\n`);
    expect(empty.diagnostics.some((d) => d.severity === "warning" && d.message.includes("no members"))).toBe(true);
  });

  it("`contains <zone-id>` expands to the inner zone's members", () => {
    // Two of twenty round-5 agents wrote the outer boundary by naming the inner
    // one. The diagnostic told them to copy the members; now the language just
    // does it, which cannot change any existing render — it only makes a source
    // that used to error legal.
    const r = buildModel(BASE + `
zone vpc1 "VPC" vpc { contains ingest, core }
zone acct "Account" cloud { contains vpc1 }
`);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const acct = r.model.zones.find((z) => z.id === "acct")!;
    expect(acct.members).toEqual(["ingest", "core"]);
  });

  it("expansion is recursive, order-free, and mixes with hand-listed members", () => {
    // the outer zone is normally written *first*, above the zone it names
    const r = buildModel(BASE + `
zone acct "Account" cloud { contains vpc1, erp }
zone vpc1 "VPC" vpc { contains inner }
zone inner "Inner" network { contains core }
`);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.model.zones.find((z) => z.id === "acct")!.members).toEqual(["core", "erp"]);
    // an expansion overlapping a hand-listed member is nesting working, not a
    // double-listing — no warning
    const overlap = buildModel(BASE + `
zone vpc1 "VPC" vpc { contains core }
zone acct "Account" cloud { contains vpc1, core }
`);
    expect(overlap.diagnostics.filter((d) => d.message.includes("listed twice"))).toEqual([]);
    expect(overlap.model.zones.find((z) => z.id === "acct")!.members).toEqual(["core"]);
    // …but writing the same leaf twice yourself still warns
    const dup = buildModel(BASE + `zone z "Z" vpc { contains core, core }\n`);
    expect(dup.diagnostics.some((d) => d.message.includes("listed twice"))).toBe(true);
  });

  it("a zone naming itself, or a cycle, degrades to the empty-zone warning", () => {
    for (const src of [
      `zone z "Z" vpc { contains z }`,
      `zone a "A" vpc { contains b }\nzone b "B" vpc { contains a }`,
    ]) {
      const r = buildModel(BASE + src + "\n");
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(r.diagnostics.some((d) => d.message.includes("has no members"))).toBe(true);
    }
  });

  it("a zone id is still not a node anywhere else", () => {
    // sugar in `contains` only — an edge to a boundary stays an error
    const r = buildModel(BASE + `
zone vpc1 "VPC" vpc { contains core }
erp -> vpc1 "nope"
`);
    expect(r.diagnostics.some((d) => d.message.includes("is a zone, not a node"))).toBe(true);
  });

  it("duplicate zone ids error", () => {
    const r = buildModel(BASE + `zone z "A" { contains erp }\nzone z "B" { contains core }\n`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes("duplicate zone"))).toBe(true);
  });
});

describe("zones — layout + render", () => {
  it("renders nested + disjoint zones as dashed frames with chips", async () => {
    const r = await render(BASE + ZONES, { view: "landscape", theme: "light" });
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    const zoneGroups = r.svg!.match(/data-kind="zone"/g) ?? [];
    expect(zoneGroups.length).toBe(3);
    expect(r.svg).toContain(`data-zone-kind="vpc"`);
    expect(r.svg).toContain("On-Premises");
    // determinism
    const again = await render(BASE + ZONES, { view: "landscape", theme: "light" });
    expect(again.svg).toBe(r.svg);
  });

  it("partial overlap is a render error naming the members", async () => {
    const src = BASE + `
zone a "A" vpc { contains erp, ingest }
zone b "B" vpc { contains ingest, core }
view landscape { include * }
`;
    const r = await render(src, { view: "landscape" });
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((x) => x.message.includes("partially overlap"));
    expect(d?.fix).toContain("shared: ingest");
  });

  it("a zone cutting through an expanded container is a render error", async () => {
    const src = BASE + `
zone z "Z" vpc { contains core.api }
view detail {
  include *
  expand core
}
`;
    // expand core → api/db live inside the frame; the zone grabs api only
    const r = await render(src, { view: "detail" });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((x) => x.message.includes("cuts through"))).toBe(true);
  });

  it("a zone enclosing a whole subtree is legal under `expand *`; a partial grab still errors", async () => {
    const whole = BASE + `
zone z "Z" vpc { contains core }
view full { expand * }
`;
    const r1 = await render(whole, { view: "full" });
    expect(r1.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    expect(r1.svg).toContain(`data-kind="zone"`);
    const partial = BASE + `
zone z "Z" vpc { contains core.api }
view full { expand * }
`;
    const r2 = await render(partial, { view: "full" });
    expect(r2.ok).toBe(false);
    expect(r2.diagnostics.some((x) => x.message.includes("cuts through"))).toBe(true);
  });

  it("zones with no visible members disappear (SPEC: follow visibility)", async () => {
    const src = BASE + `
zone z "Z" vpc { contains core.api }
view landscape { include * }
`;
    // core.api is lifted into the core card at landscape altitude → zone empty
    const r = await render(src, { view: "landscape" });
    expect(r.ok).toBe(true);
    expect(r.svg).not.toContain(`data-kind="zone"`);
  });

  it("chips slide along the border away from crossing edges, and carry a halo", async () => {
    // adversarial: src feeds the zone's leftmost member, so the edge drops
    // through the default chip spot (top-left). ELK won't avoid labels
    // (spiked) — placeZoneChips must slide the chip right.
    const src = `pack aws
src = aws/lambda "Source"
a = aws/lambda "Alpha"
b = aws/lambda "Bravo"
c = aws/lambda "Charlie"
src -> a
zone net "Network Segment Alpha" network {
  contains a, b, c
}
view v {
  include *
  layout { rows [src] [a b c] }
}
`;
    const r = await render(src, { view: "v", theme: "light" });
    expect(r.ok).toBe(true);
    const chipGroup = r.svg!.match(/<g data-kind="zone-chip"[^>]*>(.*?)<\/g>/s)?.[1] ?? "";
    // halo present: first rect is the canvas knockout, 3px proud
    const rects = [...chipGroup.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)"/g)].map((m) => ({
      x: +m[1], y: +m[2], w: +m[3],
    }));
    expect(rects.length).toBeGreaterThanOrEqual(2);
    expect(rects[0].x).toBe(rects[1].x - 3); // halo wraps chip
    // the zone boundary's left edge:
    const zx = +(r.svg!.match(/<g data-kind="zone"[^>]*><rect x="(-?\d+)"/)?.[1] ?? NaN);
    // chip slid right of the default (zx + 12) to clear the crossing edge
    expect(rects[1].x).toBeGreaterThan(zx + 12);
    // and in both themes it stays deterministic
    const again = await render(src, { view: "v", theme: "light" });
    expect(again.svg).toBe(r.svg);
  });

  it("zone chips can carry an icon and choose their corner", async () => {
    const src = BASE + `
zone cloud "AWS Cloud" cloud {
  contains ingest, core
  icon: aws/cloudfront
  label: bottom-right
}
view landscape { include * }
`;
    const r = await render(src, { view: "landscape", theme: "light" });
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    const chip = r.svg!.match(/<g data-kind="zone-chip"[^>]*>(.*?)<\/g>/s)![1];
    expect(chip).toContain("cloudfront"); // symbol <use> inside the chip
    // bottom-right: chip straddles the BOTTOM border
    const zone = r.svg!.match(/<g data-kind="zone"[^>]*><rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/)!;
    const zoneBottom = +zone[2] + +zone[4];
    const chipY = +chip.match(/<rect x="-?\d+" y="(-?\d+)"/)![1];
    expect(Math.abs(chipY + 3 - (zoneBottom - 10))).toBeLessThanOrEqual(1); // halo y = chip y - 3
  });

  it("zone color is a theme role — override works, hex is rejected", async () => {
    const src = BASE + `
zone z "Custom" custom {
  contains core
  color: accent
}
view landscape { include * }
`;
    const r = await render(src, { view: "landscape", theme: "light" });
    expect(r.ok).toBe(true);
    // light theme accent
    expect(r.svg!.match(/<g data-kind="zone"[^>]*>.*?stroke="#5A57C9"/s)).toBeTruthy();
    const bad = buildModel(BASE + `zone z "Z" cloud { contains core\n color: "#ff0000" }\n`);
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0].message).toContain("theme roles only, never hex");
  });

  it("bad zone icon and label position get did-you-means", () => {
    const icon = buildModel(BASE + `zone z "Z" cloud { contains core\n icon: aws/cloudfrunt }\n`);
    expect(icon.ok).toBe(false);
    expect(icon.diagnostics[0].fix).toContain("aws/cloudfront");
    const pos = buildModel(BASE + `zone z "Z" cloud { contains core\n label: top-rigth }\n`);
    expect(pos.ok).toBe(false);
    expect(pos.diagnostics[0].fix).toContain("top-right");
  });

  it("a zone with no visible members says so, in views the author wrote", async () => {
    // found by a cold-run agent: they declared a VPC around a node that sits
    // inside a collapsed card, and the boundary silently never appeared
    const src = BASE + `
zone vpc1 "VPC" vpc { contains core.db }
view landscape { include * }
`;
    const r = await render(src, { view: "landscape" });
    expect(r.ok).toBe(true); // a warning, not an error — the diagram is fine
    const d = r.diagnostics.find((x) => x.message.includes("no visible members"));
    expect(d?.severity).toBe("warning");
    expect(d?.fix).toContain("core.db");
    expect(d?.fix).toContain("expand");
  });

  it("auto views stay quiet — the author did not write them", async () => {
    const src = BASE + `zone vpc1 "VPC" vpc { contains core.db }\n`;
    const r = await render(src, { view: "ingest" });
    expect(r.diagnostics.some((x) => x.message.includes("no visible members"))).toBe(false);
  });

  it("zone kinds show up as earned legend entries", async () => {
    const src = BASE + ZONES.replace("view landscape {\n  include *\n}", "view landscape {\n  include *\n  legend auto\n}");
    const r = await render(src, { view: "landscape" });
    expect(r.ok).toBe(true);
    for (const kind of ["onprem", "cloud", "vpc"]) expect(r.svg).toContain(`>${kind}</text>`);
  });
});

// ── round-3 gauntlet findings: zones silently defeating layout hints ────────
describe("zones vs layout hints", () => {
  const SRC = `pack aws
a = aws/api-gateway "A"
b = aws/lambda "B"
c = aws/dynamodb "C" datastore
a -> b
b -> c
`;

  it("says so when a rank hint is inert because one zone swallows it", async () => {
    // unitOf() ranks by outermost zone, so members of one zone collapse to a
    // single unit: rows between them are discarded AND the "runs upward" check
    // compares that unit against itself. The render came out byte-identical to
    // having no layout block, with check exiting 0 and reporting nothing.
    const src = `${SRC}zone z "Z" account { contains a, b, c }
view v {
  include *
  layout { rows [c] [b] [a] }
}
`;
    const r = await render(src, { view: "v", theme: "light" });
    expect(r.ok).toBe(true);
    const w = r.diagnostics.find((d) => d.message.includes("have no effect"));
    expect(w?.severity).toBe("warning");
    expect(w?.message).toContain("`z`");
    expect(w?.fix).toContain("between* zones");
  });

  it("stays quiet when one member is named — that ranks the zone, and it works", async () => {
    // Naming a member records the rank against its *unit*, which is the zone,
    // so a single mention is how you position the whole boundary against
    // everything outside it. Warning here told people a hint they could watch
    // working had no effect — and the advice ("order the zones themselves")
    // pointed at something the language has no syntax for.
    const src = `${SRC}zone z "Z" account { contains a, b }
view v {
  include *
  layout { rows [a] [c] }
}
`;
    const r = await render(src, { view: "v", theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.diagnostics.find((d) => d.message.includes("have no effect"))).toBeUndefined();
  });

  it("and the hint it stays quiet about genuinely moves the diagram", async () => {
    // The guard against silencing the warning by breaking the feature instead
    // of fixing the diagnostic. A zone with ranks on both sides of it is the
    // shape where naming one member matters: without that band the zone drifts
    // up into the caller's rank and the nodes below it scatter.
    const src = (band: string) => `pack aws
edge = aws/cloudfront "Edge"
alb  = aws/elb "ALB"
app  = aws/fargate "App"
tbl  = aws/dynamodb "Table" datastore
ix   = aws/lambda "Indexer"
idx  = aws/opensearch "Index" datastore
edge -> alb
alb -> app
app -> tbl
app -> idx
tbl ~> ix
ix -> idx
zone z "VPC" vpc { contains alb, app }
view v {
  include *
  layout { rows [edge]${band} [tbl ix idx] }
}
`;
    const pinned = await render(src(" [alb]"), { view: "v", theme: "light" });
    const loose = await render(src(""), { view: "v", theme: "light" });
    expect(pinned.ok && loose.ok).toBe(true);
    expect(pinned.diagnostics.find((d) => d.message.includes("have no effect"))).toBeUndefined();
    expect(pinned.svg).not.toBe(loose.svg);
  });

  it("still reports a real rank conflict when no zone is involved", async () => {
    const src = `${SRC}view v {
  include *
  layout { rows [c] [b] [a] }
}
`;
    const r = await render(src, { view: "v", theme: "light" });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes("runs upward"))).toBe(true);
  });

  it("refuses an align that would drag a member outside its own boundary", async () => {
    // The zone frame is sized by ELK long before the align pass moves nodes, so
    // an unchecked snap drew the member outside the boundary containing it —
    // a false claim, rendered cleanly, check exit 0.
    const src = `pack logos
pg = logos/postgresql "PG" datastore
far = logos/redis "Far"
web = logos/nginx "Web"
web -> pg
web -> far
zone onprem "On-Prem" onprem { contains pg }
view v {
  include *
  layout { align far pg }
}
`;
    const r = await render(src, { view: "v", theme: "light" });
    expect(r.ok).toBe(true);
    const w = r.diagnostics.find((d) => d.message.includes("outside zone"));
    expect(w?.severity).toBe("warning");
    expect(w?.message).toContain("`onprem`");

    // and the node really is still inside the frame it claims to be in
    const zone = r.svg!.match(
      /data-kind="zone"[^>]*>.*?<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/s,
    )!;
    const [zx, zy, zw, zh] = zone.slice(1, 5).map(Number);
    const node = [
      ...r.svg!.matchAll(
        /data-path="([^"]+)" data-kind="leaf"[^>]*>\s*<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g,
      ),
    ].find((m) => m[1] === "pg")!;
    const [nx, ny, nw, nh] = node.slice(2, 6).map(Number);
    expect(nx >= zx && ny >= zy && nx + nw <= zx + zw && ny + nh <= zy + zh).toBe(true);
  });

  it("refuses two zones with identical members", async () => {
    // Passes the partial-overlap test (nothing is exclusive to either) and
    // then breaks the nesting pass, which orders zones by strict containment:
    // neither can parent the other, so one loses its geometry and its members
    // render outside it. Found by a generated-input spike — no hand-written
    // diagram had ever declared the same boundary twice.
    const src = `a = box "A"\nb = box "B"\n` +
      `zone z0 "Z0" vpc { contains a, b }\nzone z1 "Z1" vpc { contains b, a }\n` +
      `view v { include * }`;
    const built = buildProject([{ name: "t.squinch", src }]);
    const view = built.model.views.find((v) => v.name === "v")!;
    const { diagnostics } = await layoutView(built.model, view, { metrics: "inter", scale: 1 });
    const err = diagnostics.find((d) => d.severity === "error");
    expect(err?.message).toContain("exactly the same members");
    expect(err?.fix).toContain("merge them");
  });

  it("still allows proper nesting and disjoint zones", async () => {
    const mk = (zones: string) => `a = box "A"\nb = box "B"\n${zones}\nview v { include * }`;
    for (const zones of [
      `zone z0 "Z0" vpc { contains a, b }\nzone z1 "Z1" network { contains a }`,  // nested
      `zone z0 "Z0" vpc { contains a }\nzone z1 "Z1" vpc { contains b }`,          // disjoint
    ]) {
      const built = buildProject([{ name: "t.squinch", src: mk(zones) }]);
      const view = built.model.views.find((v) => v.name === "v")!;
      const { diagnostics } = await layoutView(built.model, view, { metrics: "inter", scale: 1 });
      expect(diagnostics.filter((d) => d.severity === "error"), zones).toEqual([]);
    }
  });
});

describe("zone chips — the segmented grammar (docs/design)", () => {
  const src = (detail: string, label = "vpc-prod", wide = true) => `pack aws
system app "Platform" {
  api = aws/api-gateway "API Gateway"
  db  = aws/dynamodb "Orders Table" datastore
  ${wide ? `cache = aws/elasticache "Session Cache"\n  api -> cache "reads"` : ""}
  api -> db "writes"
}
zone vpc_a "${label}" vpc {
  contains app
  icon: aws/vpc
${detail ? `  detail: "${detail}"` : ""}
}
view main {
  expand app
${wide ? "  layout { rows [app.api] [app.db app.cache] }" : ""}
}`;

  it("draws the mono segment when the boundary has room for it", async () => {
    const r = await render(src("10.0.0.0/16"), { view: "main", theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    expect(r.svg).toContain(">10.0.0.0/16<");
    // in mono, and the face is embedded because this render reached for it
    expect(r.svg).toMatch(/font-family="SquinchMono[^"]*" fill="[^"]+">10\.0\.0\.0\/16</);
    expect(r.svg).toContain("font-family:SquinchMono");
  });

  it("segments are flush — no canvas sliver between the icon tab and the bed", async () => {
    // The tab was a square of artwork inside a `c.h + 4` slot, so 4px of the
    // canvas knockout showed between icon and label bed as a white strip.
    const r = await render(src("10.0.0.0/16"), { view: "main", theme: "light" });
    const at = r.svg!.indexOf(`<g data-kind="zone-chip"`);
    const chip = r.svg!.slice(at, r.svg!.indexOf("</g>", r.svg!.indexOf(">vpc-prod<")));
    const beds = [...chip.matchAll(/<rect x="(\d+)"[^>]*width="(\d+)"[^>]*clip-path/g)]
      .map((m) => ({ x: +m[1], w: +m[2] }))
      .sort((a, b) => a.x - b.x);
    expect(beds.length).toBe(3); // icon tab, label, detail
    for (let i = 1; i < beds.length; i++)
      expect(beds[i].x, "segment starts where the previous ends").toBe(beds[i - 1].x + beds[i - 1].w);
  });

  it("drops the segment rather than truncating it on a narrow boundary", async () => {
    // A clipped `10.0.0.0/16` is not a shortened label, it is a different
    // network — so the segment is all-or-nothing and the name keeps the room.
    const long = "production network boundary, eu-west-1";
    const r = await render(src("10.0.0.0/16", long, false), { view: "main", theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.svg).not.toContain("10.0.0.0");
    // and nothing paid for a face it never drew with
    expect(r.svg).not.toContain("font-family:SquinchMono");
  });

  it("beds sit under the border, so the chip never paints over its own tints", async () => {
    const r = await render(src("10.0.0.0/16"), { view: "main", theme: "light" });
    const at = r.svg!.indexOf(`<g data-kind="zone-chip"`);
    const chip = r.svg!.slice(at, r.svg!.indexOf("</g>", r.svg!.indexOf(">vpc-prod<")));
    // the bordered rect is fill="none": a filled one drawn last would erase
    // the segment beds underneath it (it did, once)
    expect(chip).toMatch(/rx="3" fill="none" stroke="#[0-9A-F]{6}59"/);
    // three strengths of one hue, never a second colour
    const tints = [...chip.matchAll(/fill="(#[0-9A-F]{6})(1F|33)"/g)].map((m) => m[1]);
    expect(new Set(tints).size).toBe(1);
  });

  it("zone frames carry no fill, so nesting cannot compound", async () => {
    // genuinely nested: the outer boundary holds the inner one's member plus
    // another, which is how zones nest (by shared members, never by naming)
    const nested = `pack aws
system app "P" { api = aws/api-gateway "API" }
system ops "Ops" { runner = aws/lambda "Runner" }
zone outer "Outer" cloud { contains app, ops }
zone inner "Inner" vpc { contains app }
view main { include * }`;
    const r = await render(nested, { view: "main", theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    const frames = [...r.svg!.matchAll(/<g data-kind="zone"[^>]*><rect[^>]*\/>/g)].map((m) => m[0]);
    expect(frames.length).toBe(2);
    for (const f of frames) {
      expect(f).toContain(`fill="none"`);
      expect(f).not.toContain("fill-opacity");
    }
  });
});
