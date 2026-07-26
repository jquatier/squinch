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

  it("zone kinds show up as earned legend entries", async () => {
    const src = BASE + ZONES.replace("view landscape {\n  include *\n}", "view landscape {\n  include *\n  legend auto\n}");
    const r = await render(src, { view: "landscape" });
    expect(r.ok).toBe(true);
    for (const kind of ["onprem", "cloud", "vpc"]) expect(r.svg).toContain(`>${kind}</text>`);
  });
});
