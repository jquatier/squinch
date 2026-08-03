import { describe, it, expect } from "vitest";

describe("searchIcons", () => {
  it("never lists an alias next to its canonical id", () => {
    const gateway = searchIcons("gateway");
    expect(gateway).toContain("aws/api-gateway");
    expect(gateway).not.toContain("aws/apigateway"); // alias collapses onto canonical
  });

  it("alias-only matches stay reachable by their famous short names", () => {
    expect(searchIcons("sqs")).toContain("aws/sqs");
    expect(searchIcons("s3")).toContain("aws/s3");
    expect(searchIcons("aks")).toContain("azure/aks");
  });

  // Every cold-run agent typed the product's real name and was told it did not
  // exist, because the match was a raw substring against the id: "front door"
  // never occurs in "front-door-and-cdn-profiles". Two of them concluded the
  // documentation was wrong and nearly rewrote correct files.
  it("matches the words people actually type, in any order", () => {
    expect(searchIcons("front door", "azure")).toContain("azure/front-door-and-cdn-profiles");
    expect(searchIcons("key vault", "azure")).toContain("azure/key-vaults");
    expect(searchIcons("api management", "azure")).toContain("azure/api-management-services");
    expect(searchIcons("management api", "azure")).toContain("azure/api-management-services");
    // and against the human title, not just the id
    expect(searchIcons("gateway", "aws")).toContain("aws/api-gateway");
  });

  it("singular and plural find each other", () => {
    // Azure ships "Container Registries" and "Data Factories"; nobody searches
    // for those spellings.
    expect(searchIcons("container registry", "azure")).toContain("azure/container-registries");
    expect(searchIcons("data factory", "azure")).toContain("azure/data-factories");
  });

  it("short acronyms are never stemmed into false positives", () => {
    // `sqs` → `sq` would match the `sq` inside `postgresql`
    expect(searchIcons("sqs")).not.toContain("azure/arc-postgresql");
    expect(searchIcons("sqs").every((h) => h.includes("sqs"))).toBe(true);
  });
});

describe("every installed pack", () => {
  // The grammar's Ident token. An id outside it cannot appear in an IconRef, so
  // the icon ships, gets indexed by `icons search`, and is impossible to
  // actually use. Both vendors produce such names — Amazon's
  // "Elemental-Appliances-&-Software", Azure's "Virtual-Machines-(Classic)" and
  // one filename with a trailing space — so the fetch scripts normalize, and
  // this is the assertion that keeps them honest.
  const IDENT = /^[a-zA-Z_]([a-zA-Z0-9_]|-[a-zA-Z0-9_])*$/;

  for (const pack of allPackNames()) {
    it(`${pack}: every id is writable in the DSL`, () => {
      const bad = iconIds(pack).filter((id) => !IDENT.test(id));
      expect(bad, `unreferenceable ids in ${pack}: ${bad.join(", ")}`).toEqual([]);
    });

    it(`${pack}: every alias points at an icon that exists`, () => {
      const ids = new Set(iconIds(pack));
      const dangling = Object.entries(packInfo(pack)?.aliases ?? {})
        .filter(([, target]) => !ids.has(target))
        .map(([alias, target]) => `${alias} → ${target}`);
      expect(dangling, `dangling aliases in ${pack}`).toEqual([]);
    });

    it(`${pack}: declares the licence and attribution its consumers must show`, () => {
      // Two of the packs are CC-BY: credit has to travel with the artwork
      // wherever it goes, and the surfaces that show it (the playground's
      // credits panel, the README licence table) read these fields rather than
      // restating them. A pack shipping without them would silently publish
      // uncredited icons — so the manifest is where it fails, not the page.
      const info = packInfo(pack);
      if (!info) return; // builtin glyph sets have no manifest
      expect(info.license?.trim(), `${pack} has no license in pack.json`).toBeTruthy();
      expect(info.attribution?.trim(), `${pack} has no attribution in pack.json`).toBeTruthy();
    });
  }
});
import { sanitizeIcon } from "../src/packs/sanitize.js";
import { iconAsset, hasIcon, iconTitle, packInfo, symbolId } from "../src/packs/registry.js";
import { searchIcons, render, validateSVG, allPackNames, iconIds } from "../src/index.js";

describe("pack sanitizer", () => {
  const wrap = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${inner}</svg>`;

  it("keeps geometry and colour verbatim", () => {
    const { body, viewBox } = sanitizeIcon(
      wrap(`<g fill="none"><rect x="0" y="0" width="80" height="80" fill="#8C4FFF"/></g>`),
      "t",
    );
    expect(viewBox).toBe("0 0 80 80");
    expect(body).toContain(`fill="#8C4FFF"`);
    expect(body).toContain(`width="80"`);
  });

  it("namespaces gradient ids without touching the colours inside them", () => {
    // The failure this guards: `#5ea0ef` in a stop-color is a hex colour, not
    // an id reference. Namespacing it yields `#t-5ea0ef`, which is not a colour
    // at all, so the gradient paints black — silently, and for every gradient
    // icon in the pack.
    const { body } = sanitizeIcon(
      wrap(
        `<defs><radialGradient id="g1"><stop offset="0.18" stop-color="#5ea0ef"/>` +
          `<stop offset="1" stop-color="#0078d4"/></radialGradient></defs>` +
          `<circle cx="9" cy="9" r="8.5" fill="url(#g1)"/>`,
      ),
      "t",
    );
    expect(body).toContain(`id="t-g1"`); // the id itself is namespaced
    expect(body).toContain(`fill="url(#t-g1)"`); // and so is the reference
    expect(body).toContain(`stop-color="#5ea0ef"`); // but the colour is untouched
    expect(body).toContain(`stop-color="#0078d4"`);
    expect(body).not.toContain("#t-5ea0ef");
  });

  it("strips scripts, event handlers and foreignObject", () => {
    const { body } = sanitizeIcon(
      wrap(
        `<script>alert(1)</script>` +
          `<foreignObject><div>hi</div></foreignObject>` +
          `<rect width="10" height="10" onload="alert(2)" onclick="x()" fill="#111"/>`,
      ),
      "t",
    );
    expect(body).not.toContain("script");
    expect(body).not.toContain("foreignObject");
    expect(body).not.toContain("onload");
    expect(body).not.toContain("onclick");
    expect(body).toContain(`fill="#111"`); // the safe part survives
  });

  it("drops external references and raw style/class", () => {
    const { body } = sanitizeIcon(
      wrap(`<image href="http://evil.test/x.png" width="10" height="10"/>` +
        `<rect width="5" height="5" style="behavior:url(#x)" class="c" fill="#222"/>`),
      "t",
    );
    expect(body).not.toContain("evil.test");
    expect(body).not.toContain("<image");
    expect(body).not.toContain("style=");
    expect(body).not.toContain("class=");
  });

  it("namespaces internal ids so icons can share a document", () => {
    const a = sanitizeIcon(wrap(`<clipPath id="c"><rect width="1" height="1"/></clipPath><rect clip-path="url(#c)" width="2" height="2"/>`), "one");
    const b = sanitizeIcon(wrap(`<clipPath id="c"><rect width="1" height="1"/></clipPath><rect clip-path="url(#c)" width="2" height="2"/>`), "two");
    expect(a.body).toContain(`id="one-c"`);
    expect(a.body).toContain(`url(#one-c)`);
    expect(b.body).toContain(`url(#two-c)`);
  });
});

describe("aws pack", () => {
  it("is installed with a manifest and licence metadata", () => {
    const info = packInfo("aws")!;
    expect(info.license).toBe("CC-BY-ND-2.0");
    expect(info.attribution).toContain("Amazon Web Services");
    expect(Object.keys(info.icons).length).toBeGreaterThan(250);
  });

  it("resolves ids and common aliases", () => {
    expect(hasIcon("aws", "lambda")).toBe(true);
    expect(hasIcon("aws", "s3")).toBe(true); // alias
    expect(hasIcon("aws", "sqs")).toBe(true);
    expect(hasIcon("aws", "nope-not-real")).toBe(false);
    expect(iconTitle("aws", "s3")).toContain("Simple Storage Service");
    // aliases share the canonical symbol, so one <symbol> serves both
    expect(symbolId("aws", "s3")).toBe(symbolId("aws", "simple-storage-service"));
  });

  it("loads real artwork through the sanitizer", () => {
    const asset = iconAsset("aws", "lambda")!;
    expect(asset.viewBox).toMatch(/^0 0 \d+ \d+$/);
    expect(asset.body).toContain("<path");
    expect(asset.body).not.toContain("<script");
  });

  it("search finds services by substring", () => {
    expect(searchIcons("dynamo")).toContain("aws/dynamodb");
    expect(searchIcons("lambda", "aws")).toContain("aws/lambda");
  });
});

describe("icon rendering", () => {
  const SRC = `pack aws
system s "S" {
  a = aws/lambda "One"
  b = aws/lambda "Two"
  c = aws/s3 "Bucket"
  a -> b
  b -> c
}`;

  it("emits one symbol per distinct icon and reuses it", async () => {
    const r = await render(SRC, { theme: "light" });
    expect(r.ok).toBe(true);
    const symbols = r.svg!.match(/<symbol /g) ?? [];
    const uses = r.svg!.match(/<use /g) ?? [];
    expect(symbols.length).toBe(2); // lambda + s3, deduplicated
    expect(uses.length).toBe(3); // three nodes
    expect(validateSVG(r.svg!).ok).toBe(true);
  });

  it("never puts clip-path on <use> (it blocks instantiation)", async () => {
    const r = await render(SRC, { theme: "light" });
    expect(r.svg).not.toMatch(/<use[^>]*clip-path/);
  });

  it("box nodes render the first-party cube glyph on their plate", async () => {
    const r = await render(`system s "S" {\n a = box "Plain"\n}`, { theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.svg).toContain(`href="#sq-builtin-box"`);
    expect(r.svg).toContain('stroke="currentColor"');
  });
});
