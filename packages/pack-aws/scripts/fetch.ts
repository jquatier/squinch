// Maintainer-only: regenerate the pack from the official AWS Architecture Icons
// package. Icons are copied VERBATIM — the CC-BY-ND licence forbids derivatives,
// so we never recolour, reshape, or "optimize" them. Theme treatment happens at
// render time in @squinch/core.
//
//   npx tsx scripts/fetch.ts [--url <zip url>]
//
// Requires `unzip` on PATH (maintainer machines only; never runs in CI).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_PAGE = "https://aws.amazon.com/architecture/icons/";

/** Short aliases for services everybody calls by initials. */
const ALIASES: Record<string, string> = {
  s3: "simple-storage-service",
  sqs: "simple-queue-service",
  sns: "simple-notification-service",
  ses: "simple-email-service",
  ecs: "elastic-container-service",
  eks: "elastic-kubernetes-service",
  ecr: "elastic-container-registry",
  efs: "elastic-file-system",
  elb: "elastic-load-balancing",
  opensearch: "opensearch-service",
  "step-functions": "step-functions",
  dynamo: "dynamodb",
  apigateway: "api-gateway",
  cloudwatch: "cloudwatch",
  glacier: "simple-storage-service-glacier",
  // group/boundary icons (zone chips)
  vpc: "virtual-private-cloud-vpc",
  "aws-cloud": "cloud",
};

/** An id has to be writable in the DSL, and the grammar's Ident token is
 *  `[a-zA-Z_]([a-zA-Z0-9_] | -[a-zA-Z0-9_])*`. Amazon's filenames are not:
 *  "Elemental-Appliances-&-Software" carries an ampersand, which parses as
 *  nothing — the icon ships, gets indexed by `icons search`, and cannot be
 *  referenced. Only the *name* is normalized; the SVG bytes stay verbatim. */
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");

/** Arch_Amazon-DynamoDB_64.svg → dynamodb; Res_AWS-Cloud-logo_32.svg → aws-cloud-logo */
function idFor(file: string): string {
  return slug(
    basename(file)
      .replace(/^(Arch_|Res_)/, "")
      .replace(/_(64|48|32)\.svg$/, "")
      .replace(/^(Amazon|AWS)-/, ""),
  );
}

/** Arch_Amazon-DynamoDB_64.svg → Amazon DynamoDB */
function titleFor(file: string): string {
  return basename(file).replace(/^(Arch_|Res_)/, "").replace(/_(64|48|32)\.svg$/, "").replace(/-/g, " ");
}

/** Arch_Compute → Compute; group icons → Group */
const categoryFor = (path: string) =>
  path.includes("Architecture-Group-Icons")
    ? "Group"
    : (path.match(/Arch_([A-Za-z-]+)\/64\//)?.[1] ?? "Other").replace(/-/g, " ");

async function resolveZipUrl(): Promise<string> {
  const flagIdx = process.argv.indexOf("--url");
  if (flagIdx > -1 && process.argv[flagIdx + 1]) return process.argv[flagIdx + 1];
  const html = await (await fetch(ICONS_PAGE)).text();
  const found = html.match(/https:\/\/[^"']*Icon-package[^"']*\.zip/);
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

// 64px architecture service icons, plus the group/boundary icons (AWS Cloud
// logo frame, Region, Account, VPC, subnets…) — the natural zone artwork.
execFileSync("unzip", ["-o", "-q", zipPath, "Architecture-Service-Icons_*/*/64/*.svg", "-d", tmp]);
execFileSync("unzip", ["-o", "-q", zipPath, "Architecture-Group-Icons_*/*.svg", "-d", tmp]);

const svgs: string[] = [];
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (
      entry.name.endsWith(".svg") &&
      !p.includes("__MACOSX") &&
      !/_Dark\.svg$/i.test(entry.name) // ship the light variants; themes plate them
    ) svgs.push(p);
  }
};
walk(tmp);
svgs.sort();

const iconsDir = join(pkgRoot, "icons");
rmSync(iconsDir, { recursive: true, force: true });
mkdirSync(iconsDir, { recursive: true });

const icons: Record<string, { file: string; title: string; category: string }> = {};
const collisions: string[] = [];
for (const src of svgs) {
  const id = idFor(src);
  if (icons[id]) {
    collisions.push(id);
    continue;
  }
  const file = `${id}.svg`;
  writeFileSync(join(iconsDir, file), readFileSync(src)); // verbatim, byte for byte
  icons[id] = { file, title: titleFor(src), category: categoryFor(src) };
}

const aliases: Record<string, string> = {};
for (const [alias, target] of Object.entries(ALIASES)) {
  if (icons[target] && !icons[alias]) aliases[alias] = target;
}

const version = url.match(/Icon-package_(\d+)/)?.[1] ?? "unknown";
writeFileSync(
  join(pkgRoot, "pack.json"),
  JSON.stringify(
    {
      name: "aws",
      title: "AWS Architecture Icons",
      release: version,
      source: url,
      license: "CC-BY-ND-2.0",
      attribution: "Amazon Web Services — https://aws.amazon.com/architecture/icons/",
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
    (collisions.length ? `\nskipped duplicate ids: ${collisions.join(", ")}` : ""),
);
