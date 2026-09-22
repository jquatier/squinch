// Maintainer-only: regenerate the pack from Google's official Cloud product
// icon library (https://cloud.google.com/icons). Icons are copied VERBATIM —
// Google publishes no licence for them beyond the page's stated purpose
// ("the Google Cloud product icons you need for your diagrams, technical
// documentation, and more"), so this pack takes no liberties: no recolouring,
// no reshaping, no optimizer, no metadata stripping. Theme treatment happens
// at render time in @squinch/core, and the one treatment the files need to
// render at all — folding their `<style>` class rules onto the shapes as
// presentation attributes — happens in core's load-time sanitizer, never here.
// NOTICE records the footing this pack ships on.
//
// What ships is Google's CURRENT icon system (early 2025): 19 unique icons
// for core products (4-colour) and 26 category icons (2-colour), one per
// product category. Every other product draws as its category's icon by
// Google's own design, which is what the alias table below encodes — every
// product named in Google's "product icons" PDF resolves to the glyph Google
// says to draw it with. The 216 "legacy console icons" are deliberately NOT
// fetched: the same PDF says "these icons should not be used as of 2026".
//
//   npx tsx scripts/fetch.ts
//
// Requires `unzip` on PATH (maintainer machines only; never runs in CI).
//
// Google publishes the ZIPs at unversioned URLs that can change silently, so
// each is PINNED BY CONTENT HASH: a mismatch fails the fetch rather than
// quietly regenerating the pack from artwork nobody reviewed. Moving a pin is
// a deliberate act — download, diff the icons, then record the new hash and
// the PDF's "Updated" date as RELEASE.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_PAGE = "https://cloud.google.com/icons";

/** The "Updated:" date on Google's product-icons PDF, the only version marker
 *  the library publishes. Recorded by hand beside the pins it belongs to. */
const RELEASE = "2026-05";

const SOURCES: { url: string; sha256: string; kind: "core" | "category" }[] = [
  {
    url: "https://services.google.com/fh/files/misc/core-products-icons.zip",
    sha256: "6531a10f58bc599c24d9a455d81dd757c1a03c3c43da9cddf639b859c1c1eece",
    kind: "core",
  },
  {
    url: "https://services.google.com/fh/files/misc/category-icons.zip",
    sha256: "e5bc3abd3527dc2500e9bff7f15870783e2c764129c49b7cd4c1b4e105345002",
    kind: "category",
  },
];

/** Ids must be writable in the DSL; the grammar's Ident token is
 *  `[a-zA-Z_]([a-zA-Z0-9_] | -[a-zA-Z0-9_])*`. Google's folder names are not
 *  ("AI _ Machine Learning", "Hybrid & Multicloud"), so the id is a slug of
 *  the folder — the product or category name, never the filename, which
 *  carries export noise (`-512-color-rgb`). Only the *name* is normalized;
 *  the SVG bytes stay verbatim. */
const IDENT = /^[a-zA-Z_]([a-zA-Z0-9_]|-[a-zA-Z0-9_])*$/;
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Folder → id, where the slug is not what people type. */
const RENAME: Record<string, string> = {
  "Cloud Spanner": "spanner", // Google's own PDF calls it Spanner
  Agents: "agents", // the folder for the "AI Applications & Agents" category
};

/** Folder → title, where the folder name is not the product's name. Titles
 *  feed `icons search`, so they carry the words the id dropped. */
const TITLE: Record<string, string> = {
  "AI _ Machine Learning": "AI / Machine Learning",
  Agents: "AI Applications & Agents",
  "Security Identity": "Security & Identity",
  "Cloud Spanner": "Spanner",
  "Distributed Cloud": "Google Distributed Cloud",
  "Security Operations": "Google Security Operations",
  "Threat Intelligence": "Google Threat Intelligence",
  Marketplace: "Google Cloud Marketplace",
  GKE: "Google Kubernetes Engine (GKE)",
};

/** Which category each core product belongs to, per the PDF's tables. The
 *  category icons themselves get one shared category. */
const CORE_CATEGORY: Record<string, string> = {
  "ai-hypercomputer": "AI / Machine Learning",
  alloydb: "Databases",
  anthos: "Hybrid & Multicloud",
  apigee: "Integration Services",
  bigquery: "Data Analytics",
  "cloud-run": "Serverless Computing",
  "cloud-sql": "Databases",
  spanner: "Databases",
  "cloud-storage": "Storage",
  "compute-engine": "Compute",
  "distributed-cloud": "Hybrid & Multicloud",
  gke: "Containers",
  hyperdisk: "Storage",
  looker: "Business Intelligence",
  mandiant: "Security & Identity",
  "security-command-center": "Security & Identity",
  "security-operations": "Security & Identity",
  "threat-intelligence": "Security & Identity",
  "vertex-ai": "AI / Machine Learning",
};
const CATEGORY_OF_CATEGORIES = "Product categories";

/** The load-bearing table. Two kinds of entry:
 *
 *  1. Short forms of the 19 core products — what people type (`gcs`, `gce`,
 *     `bq`) — plus the products the PDF stars as "default to unique icon"
 *     but ships no icon for (Looker Studio → Looker, BigQuery Omni → BigQuery).
 *  2. Every general product in the PDF's category tables → its category icon.
 *     That is how Google draws them now, and it is what lets an agent writing
 *     from prose reach `gcp/pubsub` or `gcp/cloud-functions` and get the glyph
 *     Google would use, rather than a dead id. The label carries the product
 *     name; the icon says the category.
 *
 *  Pruned at fetch: an alias whose target was not fetched is a hard error. */
const ALIASES: Record<string, string> = {
  // ── core products: short forms ───────────────────────────────────────────
  gcs: "cloud-storage",
  bucket: "cloud-storage",
  "storage-bucket": "cloud-storage",
  gce: "compute-engine",
  vm: "compute-engine",
  vms: "compute-engine",
  "virtual-machine": "compute-engine",
  run: "cloud-run",
  "cloud-run-functions": "cloud-run",
  bq: "bigquery",
  "bigquery-functions": "bigquery",
  "bigquery-omni": "bigquery",
  vertex: "vertex-ai",
  sql: "cloud-sql",
  cloudsql: "cloud-sql",
  "cloud-spanner": "spanner",
  "kubernetes-engine": "gke",
  "google-kubernetes-engine": "gke",
  "alloydb-omni": "alloydb",
  "looker-studio": "looker",
  "looker-studio-pro": "looker",
  secops: "security-operations",
  "google-security-operations": "security-operations",
  chronicle: "security-operations",
  scc: "security-command-center",
  "google-threat-intelligence": "threat-intelligence",
  gti: "threat-intelligence",
  gdc: "distributed-cloud",
  "google-distributed-cloud": "distributed-cloud",
  "persistent-disk": "hyperdisk", // the PDF: "Hyperdisk (previously Persistent Disk)"
  "ai-hypercomputer-cluster": "ai-hypercomputer",

  // ── category icons: the category's own other names ───────────────────────
  "ai-applications-agents": "agents",
  "ai-applications": "agents",
  ai: "ai-machine-learning",
  ml: "ai-machine-learning",
  "machine-learning": "ai-machine-learning",
  bi: "business-intelligence",
  devtools: "developer-tools",
  hybrid: "hybrid-multicloud",
  multicloud: "hybrid-multicloud",
  integration: "integration-services",
  management: "management-tools",
  maps: "maps-geospatial",
  geospatial: "maps-geospatial",
  media: "media-services",
  network: "networking",
  security: "security-identity",
  identity: "security-identity",
  serverless: "serverless-computing",
  web: "web-mobile",
  mobile: "web-mobile",

  // ── AI Applications & Agents ─────────────────────────────────────────────
  "customer-engagement-suite": "agents",
  "conversational-agents": "agents",
  "agent-assist": "agents",
  "conversational-insights": "agents",
  "contact-center-as-a-service": "agents",
  ccaas: "agents",

  // ── AI / Machine Learning ────────────────────────────────────────────────
  gemini: "ai-machine-learning",
  "ai-platform": "ai-machine-learning",
  "ai-hub": "ai-machine-learning",
  "advanced-agent-modeling": "ai-machine-learning",
  automl: "ai-machine-learning",
  "automl-vision": "ai-machine-learning",
  "automl-natural-language": "ai-machine-learning",
  "automl-tables": "ai-machine-learning",
  "automl-translation": "ai-machine-learning",
  "automl-video-intelligence": "ai-machine-learning",
  "cloud-gpu": "ai-machine-learning",
  gpu: "ai-machine-learning",
  "cloud-tpu": "ai-machine-learning",
  tpu: "ai-machine-learning",
  "cloud-healthcare-api": "ai-machine-learning",
  "healthcare-api": "ai-machine-learning",
  "healthcare-nlp-api": "ai-machine-learning",
  "cloud-natural-language-api": "ai-machine-learning",
  "natural-language-api": "ai-machine-learning",
  "cloud-optimization-ai": "ai-machine-learning",
  "cloud-translation-api": "ai-machine-learning",
  translation: "ai-machine-learning",
  "media-translation-api": "ai-machine-learning",
  "cloud-vision-api": "ai-machine-learning",
  "vision-api": "ai-machine-learning",
  "data-labeling": "ai-machine-learning",
  dialogflow: "ai-machine-learning",
  "document-ai": "ai-machine-learning",
  genomics: "ai-machine-learning",
  "recommendations-ai": "ai-machine-learning",
  "speech-to-text": "ai-machine-learning",
  "text-to-speech": "ai-machine-learning",
  "tensorflow-enterprise": "ai-machine-learning",
  "visual-inspection-ai": "ai-machine-learning",

  // ── Collaboration ────────────────────────────────────────────────────────
  "google-workspace": "collaboration",
  workspace: "collaboration",

  // ── Compute ──────────────────────────────────────────────────────────────
  batch: "compute",
  "container-optimized-os": "compute",
  "gce-systems-management": "compute",
  "migrate-to-virtual-machines": "compute",
  "migrate-to-vms": "compute",
  "os-config-management": "compute",
  "os-inventory-management": "compute",
  "os-patch-management": "compute",
  "vmware-engine": "compute",

  // ── Containers ───────────────────────────────────────────────────────────
  "backup-for-gke": "containers",
  knative: "containers",
  "knative-serving": "containers",
  "migrate-to-containers": "containers",

  // ── Data Analytics ───────────────────────────────────────────────────────
  "analytics-hub": "data-analytics",
  biglake: "data-analytics",
  "cloud-composer": "data-analytics",
  composer: "data-analytics",
  "cloud-data-fusion": "data-analytics",
  "data-fusion": "data-analytics",
  "data-catalog": "data-analytics",
  "data-layers": "data-analytics",
  "data-loss-prevention": "data-analytics",
  dlp: "data-analytics",
  dataflow: "data-analytics",
  dataplex: "data-analytics",
  dataprep: "data-analytics",
  dataproc: "data-analytics",
  "dataproc-metastore": "data-analytics",
  datashare: "data-analytics",
  datastream: "data-analytics",
  "pub-sub": "data-analytics",
  pubsub: "data-analytics",

  // ── Databases ────────────────────────────────────────────────────────────
  "bare-metal-solution": "databases",
  bigtable: "databases",
  "cloud-bigtable": "databases",
  "database-center": "databases",
  "database-migration-service": "databases",
  dms: "databases",
  datastore: "databases",
  firestore: "databases",
  memorystore: "databases",

  // ── Developer Tools ──────────────────────────────────────────────────────
  "cloud-code": "developer-tools",
  "cloud-deployment-manager": "developer-tools",
  "deployment-manager": "developer-tools",
  "cloud-scheduler": "developer-tools",
  scheduler: "developer-tools",
  "cloud-shell": "developer-tools",
  "cloud-tasks": "developer-tools",
  tasks: "developer-tools",
  "cloud-workstations": "developer-tools",
  workstations: "developer-tools",
  "runtime-config": "developer-tools",
  "service-catalog": "developer-tools",
  "tools-for-powershell": "developer-tools",

  // ── DevOps ───────────────────────────────────────────────────────────────
  "artifact-registry": "devops",
  "cloud-build": "devops",
  "cloud-deploy": "devops",
  "container-registry": "devops",
  gcr: "devops",

  // ── Integration Services ─────────────────────────────────────────────────
  "advanced-api-security": "integration-services",
  "api-analytics": "integration-services",
  "application-integration": "integration-services",
  "cloud-api-gateway": "integration-services",
  "api-gateway": "integration-services",
  "cloud-apis": "integration-services",
  "cloud-endpoints": "integration-services",
  endpoints: "integration-services",
  connectors: "integration-services",
  "developer-portal": "integration-services",
  eventarc: "integration-services",
  workflows: "integration-services",

  // ── Management Tools ─────────────────────────────────────────────────────
  "carbon-footprint": "management-tools",
  "producer-portal": "management-tools",

  // ── Maps & Geospatial ────────────────────────────────────────────────────
  "earth-engine": "maps-geospatial",
  "google-earth": "maps-geospatial",
  "google-maps-platform": "maps-geospatial",
  "maps-platform": "maps-geospatial",

  // ── Marketplace ──────────────────────────────────────────────────────────
  "google-cloud-marketplace": "marketplace",
  "cloud-marketplace": "marketplace",

  // ── Migration ────────────────────────────────────────────────────────────
  "migrate-for-compute-engine": "migration",
  "transfer-appliance": "migration",

  // ── Networking ───────────────────────────────────────────────────────────
  "cloud-armor": "networking",
  armor: "networking",
  "cloud-cdn": "networking",
  cdn: "networking",
  "cloud-dns": "networking",
  dns: "networking",
  "cloud-domains": "networking",
  "cloud-firewall": "networking",
  "cloud-firewall-rules": "networking",
  firewall: "networking",
  "cloud-ids": "networking",
  "cloud-interconnect": "networking",
  interconnect: "networking",
  "cloud-load-balancing": "networking",
  "load-balancing": "networking",
  "load-balancer": "networking",
  lb: "networking",
  "cloud-nat": "networking",
  nat: "networking",
  "cloud-network": "networking",
  "cloud-router": "networking",
  "cloud-vpn": "networking",
  vpn: "networking",
  "connectivity-test": "networking",
  "data-transfer": "networking",
  "network-connectivity-center": "networking",
  "network-intelligence-center": "networking",
  "network-security": "networking",
  "network-tiers": "networking",
  "network-topology": "networking",
  "packet-mirroring": "networking",
  "partner-interconnect": "networking",
  "premium-network-tier": "networking",
  "private-connectivity": "networking",
  "private-service-connect": "networking",
  psc: "networking",
  routes: "networking",
  "service-mesh": "networking",
  "virtual-private-cloud": "networking",
  vpc: "networking",

  // ── Observability ────────────────────────────────────────────────────────
  "cloud-audit-logs": "observability",
  "audit-logs": "observability",
  "cloud-logging": "observability",
  logging: "observability",
  "cloud-monitoring": "observability",
  monitoring: "observability",
  "error-reporting": "observability",
  "google-cloud-observability": "observability",
  profiler: "observability",
  "cloud-trace": "observability",
  trace: "observability",

  // ── Operations ───────────────────────────────────────────────────────────
  "app-hub": "operations",
  "backup-and-dr": "operations",
  "capacity-planner": "operations",
  "performance-dashboard": "operations",
  "personalized-service-health": "operations",

  // ── Security & Identity ──────────────────────────────────────────────────
  "access-context-manager": "security-identity",
  "asset-inventory": "security-identity",
  "cloud-asset-inventory": "security-identity",
  "assured-workloads": "security-identity",
  beyondcorp: "security-identity",
  "binary-authorization": "security-identity",
  "certificate-authority-service": "security-identity",
  "certificate-manager": "security-identity",
  "cloud-external-key-manager": "security-identity",
  ekm: "security-identity",
  "cloud-hsm": "security-identity",
  "cloud-security-scanner": "security-identity",
  "identity-and-access-management": "security-identity",
  iam: "security-identity",
  "identity-aware-proxy": "security-identity",
  iap: "security-identity",
  "identity-platform": "security-identity",
  "key-access-justifications": "security-identity",
  "key-management-service": "security-identity",
  "cloud-kms": "security-identity",
  kms: "security-identity",
  "managed-service-for-microsoft-active-directory": "security-identity",
  "managed-microsoft-ad": "security-identity",
  "phishing-protection": "security-identity",
  "policy-analyzer": "security-identity",
  "recaptcha-enterprise": "security-identity",
  recaptcha: "security-identity",
  "risk-manager": "security-identity",
  "secret-manager": "security-identity",
  "security-key-enforcement": "security-identity",
  "web-risk": "security-identity",
  "web-security-scanner": "security-identity",
  "workload-identity-federation": "security-identity",

  // ── Serverless Computing ─────────────────────────────────────────────────
  "app-engine": "serverless-computing",
  gae: "serverless-computing",
  "cloud-functions": "serverless-computing",
  functions: "serverless-computing",

  // ── Storage ──────────────────────────────────────────────────────────────
  filestore: "storage",
  "google-cloud-netapp-volumes": "storage",
  "netapp-volumes": "storage",
  "local-ssd": "storage",
  parallelstore: "storage",
  "storage-transfer-service": "storage",
  "storage-transfer": "storage",

  // ── Web3 ─────────────────────────────────────────────────────────────────
  "blockchain-node-engine": "web3",
  "blockchain-rpc": "web3",
};

const tmp = join(pkgRoot, ".fetch-tmp");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const iconsDir = join(pkgRoot, "icons");
rmSync(iconsDir, { recursive: true, force: true });
mkdirSync(iconsDir, { recursive: true });

const icons: Record<string, { file: string; title: string; category: string }> = {};
const problems: string[] = [];

for (const src of SOURCES) {
  console.log(`source: ${src.url}`);
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${src.url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== src.sha256)
    throw new Error(
      `${basename(src.url)} does not match its pin:\n  expected ${src.sha256}\n  got      ${hash}\n` +
        `Google republished the ZIP. Diff the icons deliberately, then move the pin and RELEASE.`,
    );
  const dir = join(tmp, src.kind);
  mkdirSync(dir, { recursive: true });
  const zipPath = join(tmp, `${src.kind}.zip`);
  writeFileSync(zipPath, bytes);
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", dir]);

  // <set>/<Product Name>/SVG/<Name>-512-color[-rgb].svg — one SVG per folder.
  // PNG/ siblings and Finder droppings are skipped; the folder is the name.
  const svgs: { folder: string; path: string }[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".svg") && !p.includes("__MACOSX") && basename(d) === "SVG")
        svgs.push({ folder: basename(dirname(d)), path: p });
    }
  };
  walk(dir);
  // sorted so the same zip always produces the same pack.json
  svgs.sort((a, b) => a.path.localeCompare(b.path));

  for (const { folder, path } of svgs) {
    const id = RENAME[folder] ?? slug(folder);
    if (!IDENT.test(id)) { problems.push(`id not Ident-safe: ${id} (${folder})`); continue; }
    if (icons[id]) { problems.push(`two files for one id: ${id} (${folder})`); continue; }
    const svg = readFileSync(path);
    // a root without a viewBox mis-scales silently (the sanitizer falls back
    // to 0 0 80 80), so it is a fetch-time error, not a runtime surprise
    if (!/<svg[^>]*viewBox="/.test(svg.toString("utf8"))) { problems.push(`no viewBox: ${folder}`); continue; }
    writeFileSync(join(iconsDir, `${id}.svg`), svg); // verbatim, byte for byte
    const category =
      src.kind === "core" ? CORE_CATEGORY[id] : CATEGORY_OF_CATEGORIES;
    if (!category) { problems.push(`core product with no category: ${id}`); continue; }
    icons[id] = { file: `${id}.svg`, title: TITLE[folder] ?? folder, category };
  }
}

for (const id of Object.keys(CORE_CATEGORY))
  if (!icons[id]) problems.push(`category for unfetched id: ${id}`);

const aliases: Record<string, string> = {};
for (const [alias, target] of Object.entries(ALIASES)) {
  if (!IDENT.test(alias)) { problems.push(`alias not Ident-safe: ${alias}`); continue; }
  if (icons[alias]) { problems.push(`alias shadows an icon: ${alias}`); continue; }
  if (!icons[target]) { problems.push(`alias to missing icon: ${alias} -> ${target}`); continue; }
  aliases[alias] = target;
}

if (problems.length) {
  console.error(`fetch problems:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

writeFileSync(
  join(pkgRoot, "pack.json"),
  JSON.stringify(
    {
      name: "gcp",
      title: "Google Cloud product icons",
      release: RELEASE,
      source: ICONS_PAGE,
      license: "Google Cloud icon library — for architecture diagrams and documentation; no redistribution grant (see NOTICE)",
      attribution: "Google — https://cloud.google.com/icons",
      // the artwork sits in a 512 box with a small baked-in margin, close
      // enough to edge-to-edge that flush placements — the zone-chip tab —
      // inset it slightly. Same treatment as pack-azure and pack-k8s.
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
  `pack-gcp: ${Object.keys(icons).length} icons, ${Object.keys(aliases).length} aliases (release ${RELEASE})`,
);
console.log(`${readdirSync(iconsDir).length} files in icons/`);
