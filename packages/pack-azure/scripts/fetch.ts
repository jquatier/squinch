// Maintainer-only: regenerate the pack from the official Azure architecture
// icons. Icons are copied VERBATIM — Microsoft's terms permit copying and
// distributing them for architecture diagrams but forbid altering the artwork
// ("Don't crop, flip, or rotate icons. Don't distort or change icon shape in
// any way"), so we never recolour, reshape, or "optimize" them. Theme treatment
// happens at render time in @squinch/core.
//
//   npx tsx scripts/fetch.ts [--url <zip url>]
//
// Requires `unzip` on PATH (maintainer machines only; never runs in CI).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, basename, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_PAGE = "https://learn.microsoft.com/en-us/azure/architecture/icons/";

/** What people actually type. Azure's own names are long and inconsistently
 *  prefixed ("Azure-Cosmos-DB" but "Function-Apps"), so short forms matter. */
const ALIASES: Record<string, string> = {
  aks: "kubernetes-services",
  vm: "virtual-machine",
  vms: "virtual-machine",
  vnet: "virtual-networks",
  cosmos: "azure-cosmos-db",
  cosmosdb: "azure-cosmos-db",
  functions: "function-apps",
  blob: "storage-accounts",
  sql: "sql-database",
  "app-service": "app-services",
  "service-bus": "azure-service-bus",
  "event-hub": "event-hubs",
  "key-vault": "key-vaults",
  "front-door": "front-door-and-cdn-profiles",
  "app-gateway": "application-gateways",
  "load-balancer": "load-balancers",
  aci: "container-instances",
  acr: "container-registries",
  "log-analytics": "log-analytics-workspaces",
  "api-management": "api-management-services",
  redis: "azure-managed-redis",
};

/** An id has to be writable in the DSL, and the grammar's Ident token is
 *  `[a-zA-Z_]([a-zA-Z0-9_] | -[a-zA-Z0-9_])*`. Microsoft's filenames are not:
 *  V24 ships parentheses ("Virtual-Machines-(Classic)"), a `+`
 *  ("Web-App-+-Database") and one trailing space. Left alone those ids parse as
 *  nothing and the icon is unreachable — shipped, indexed, and impossible to
 *  reference. Only the *name* is normalized; the SVG bytes stay verbatim. */
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");

/** `10021-icon-service-Virtual-Machine.svg` → `virtual-machine`.
 *  One file in V24 has a stray space in its numeric prefix, hence `[\d\s]`. */
const idFor = (file: string): string =>
  slug(basename(file).replace(/^[\d\s]+-icon-service-/, "").replace(/\.svg$/, ""));

/** `10021-icon-service-Virtual-Machine.svg` → `Virtual Machine` */
const titleFor = (file: string): string =>
  basename(file)
    .replace(/^[\d\s]+-icon-service-/, "")
    .replace(/\.svg$/, "")
    .replace(/-/g, " ");

/** the containing folder: `ai + machine learning` → `AI + Machine Learning` */
const categoryFor = (path: string): string =>
  (path.split(sep).at(-2) ?? "other")
    .split(" ")
    .map((w) => (w === "+" ? w : w.replace(/^(\w)/, (c) => c.toUpperCase())))
    .join(" ")
    .replace(/\bAi\b/, "AI")
    .replace(/\bIot\b/, "IoT")
    .replace(/\bDevops\b/, "DevOps");

async function resolveZipUrl(): Promise<string> {
  const flagIdx = process.argv.indexOf("--url");
  if (flagIdx > -1 && process.argv[flagIdx + 1]) return process.argv[flagIdx + 1];
  const html = await (await fetch(ICONS_PAGE)).text();
  const found = html.match(/https:\/\/[^"']*\/icons\/Azure_Public_Service_Icons[^"']*\.zip/);
  if (!found) throw new Error(`could not find the icon package link on ${ICONS_PAGE}`);
  return found[0];
}

const url = await resolveZipUrl();
console.log(`source: ${url}`);

const tmp = join(pkgRoot, ".fetch-tmp");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const zipPath = join(tmp, "icons.zip");

const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
execFileSync("unzip", ["-o", "-q", zipPath, "-d", tmp]);

const svgs: string[] = [];
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".svg") && !p.includes("__MACOSX")) svgs.push(p);
  }
};
walk(tmp);
// sorted so the category a shared icon lands in is decided by the input, not by
// filesystem order — the same zip must always produce the same pack.json
svgs.sort();

const iconsDir = join(pkgRoot, "icons");
rmSync(iconsDir, { recursive: true, force: true });
mkdirSync(iconsDir, { recursive: true });

const icons: Record<string, { file: string; title: string; category: string }> = {};
// Azure files the same service under every category it touches — App Services
// appears in five. The duplicates are byte-identical, so the first sorted path
// wins and the rest are dropped.
const duplicates: string[] = [];
const conflicts: string[] = [];
for (const src of svgs) {
  const id = idFor(src);
  const existing = icons[id];
  if (existing) {
    const same = readFileSync(src).equals(readFileSync(join(iconsDir, existing.file)));
    (same ? duplicates : conflicts).push(id);
    continue;
  }
  const file = `${id}.svg`;
  writeFileSync(join(iconsDir, file), readFileSync(src)); // verbatim, byte for byte
  icons[id] = { file, title: titleFor(src), category: categoryFor(src) };
}

const aliases: Record<string, string> = {};
const deadAliases: string[] = [];
for (const [alias, target] of Object.entries(ALIASES)) {
  if (icons[target] && !icons[alias]) aliases[alias] = target;
  else if (!icons[target]) deadAliases.push(`${alias} → ${target}`);
}

const version = url.match(/Icons_(V\d+)/)?.[1] ?? "unknown";
writeFileSync(
  join(pkgRoot, "pack.json"),
  JSON.stringify(
    {
      name: "azure",
      title: "Azure Architecture Icons",
      release: version,
      source: url,
      license: "Microsoft icon terms — architecture diagrams, training and docs only",
      attribution:
        "Microsoft — https://learn.microsoft.com/en-us/azure/architecture/icons/",
      // viewBoxes are tight to the artwork (the vnet chevrons touch the edge),
      // so flush placements — the zone-chip tab — inset it slightly. Same
      // treatment as pack-k8s; nodes are unaffected.
      fullBleed: true,
      icons: Object.fromEntries(Object.entries(icons).sort(([a], [b]) => a.localeCompare(b))),
      aliases: Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + "\n",
);

rmSync(tmp, { recursive: true, force: true });
console.log(
  `wrote ${Object.keys(icons).length} icons + ${Object.keys(aliases).length} aliases (release ${version})` +
    `\ncollapsed ${duplicates.length} cross-category duplicates` +
    // a same-id-different-bytes pair would mean silently dropping real artwork
    (conflicts.length ? `\nWARNING same id, different artwork: ${conflicts.join(", ")}` : "") +
    (deadAliases.length ? `\nWARNING aliases with no target: ${deadAliases.join(", ")}` : ""),
);
