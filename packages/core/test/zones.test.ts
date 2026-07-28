// Zones (SPEC §Zones): cross-cutting deployment boundaries — a separate
// hierarchy from ownership, rendered as dashed kind-tinted frames.
import { describe, it, expect } from "vitest";
import { buildModel, render } from "../src/index.js";
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
});
