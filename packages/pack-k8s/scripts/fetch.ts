// Maintainer-only: regenerate the pack from the official Kubernetes community
// icon set (github.com/kubernetes/community, icons/). The set exists precisely
// to standardize architecture diagrams, and is dual-licensed Apache-2.0 /
// CC-BY-4.0 — a real redistribution grant, which is the bar a pack has to
// clear here (see the GCP paragraph in CLAUDE.md for the counter-example).
//
// Unlike the AWS (CC-BY-ND) and Azure (no-alteration terms) packs, this
// licence PERMITS modification — so the one treatment applied is mechanical:
// the Inkscape/sodipodi/RDF editor metadata (~35 lines per file, more than
// half the bytes) is stripped. Paths, colours and geometry are untouched, and
// NOTICE records the treatment.
//
//   npm run fetch
//
// Downloads from a PINNED COMMIT, never a branch: regeneration must be
// byte-reproducible, and moving the pin is a deliberate, reviewed act.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** kubernetes/community @ 2026-08-02. Bump deliberately; rerun; review diff. */
const COMMIT = "e6d1cbd0ca50e350877253d1564bbefffc2fad66";
const RAW = `https://raw.githubusercontent.com/kubernetes/community/${COMMIT}/icons/svg`;

/** The whole set, by upstream directory. Resources and infrastructure ship
 *  unlabeled (we draw our own labels); the six control-plane components exist
 *  only labeled upstream — the baked-in text (api, sched, …) matches how the
 *  k8s docs themselves draw them, so they go in as-is. */
const SOURCES: { dir: string; ids: string[] }[] = [
  {
    dir: "resources/unlabeled",
    ids: [
      "c-role", "cm", "crb", "crd", "cronjob", "deploy", "ds", "ep", "group",
      "hpa", "ing", "job", "limits", "netpol", "ns", "pod", "psp", "pv", "pvc",
      "quota", "rb", "role", "rs", "sa", "sc", "secret", "sts", "svc", "user",
      "vol",
    ],
  },
  {
    dir: "infrastructure_components/unlabeled",
    ids: ["control-plane", "etcd", "node"],
  },
  {
    dir: "control_plane_components/labeled",
    ids: ["api", "c-c-m", "c-m", "k-proxy", "kubelet", "sched"],
  },
];

/** The upstream ids are kubectl's short names — right for the canonical id
 *  (that is what cluster operators type) — but the long names are what an
 *  agent writing from prose will reach for. Both must resolve. */
const ALIASES: Record<string, string> = {
  deployment: "deploy",
  service: "svc",
  statefulset: "sts",
  daemonset: "ds",
  replicaset: "rs",
  configmap: "cm",
  namespace: "ns",
  ingress: "ing",
  serviceaccount: "sa",
  storageclass: "sc",
  persistentvolume: "pv",
  persistentvolumeclaim: "pvc",
  networkpolicy: "netpol",
  endpoints: "ep",
  clusterrole: "c-role",
  clusterrolebinding: "crb",
  rolebinding: "rb",
  volume: "vol",
  apiserver: "api",
  scheduler: "sched",
  kubeproxy: "k-proxy",
  controllermanager: "c-m",
  cloudcontrollermanager: "c-c-m",
};

/** Upstream has no titles; searching "stateful set" or "cluster role binding"
 *  has to hit, and `searchIcons` matches id + title — so the titles carry the
 *  words the abbreviations dropped. */
const TITLES: Record<string, string> = {
  api: "API Server", "c-c-m": "Cloud Controller Manager",
  "c-m": "Controller Manager", "c-role": "Cluster Role", cm: "Config Map",
  "control-plane": "Control Plane", crb: "Cluster Role Binding",
  crd: "Custom Resource Definition", cronjob: "Cron Job", deploy: "Deployment",
  ds: "Daemon Set", ep: "Endpoints", etcd: "etcd", group: "Group",
  hpa: "Horizontal Pod Autoscaler", ing: "Ingress", job: "Job",
  "k-proxy": "kube-proxy", kubelet: "kubelet", limits: "Limit Range",
  netpol: "Network Policy", node: "Node", ns: "Namespace", pod: "Pod",
  psp: "Pod Security Policy", pv: "Persistent Volume",
  pvc: "Persistent Volume Claim", quota: "Resource Quota",
  rb: "Role Binding", role: "Role", rs: "Replica Set",
  sa: "Service Account", sc: "Storage Class", secret: "Secret",
  sched: "Scheduler", sts: "Stateful Set", svc: "Service", user: "User",
  vol: "Volume",
};

const CATEGORY: Record<string, string> = {
  "resources/unlabeled": "Resources",
  "infrastructure_components/unlabeled": "Infrastructure",
  "control_plane_components/labeled": "Control plane",
};

/** Ids must be writable in the DSL; the grammar's Ident token is
 *  `[a-zA-Z_]([a-zA-Z0-9_] | -[a-zA-Z0-9_])*`. Upstream's short names all
 *  pass, but assert it: a violation ships an unreachable icon. */
const IDENT = /^[a-zA-Z_]([a-zA-Z0-9_]|-[a-zA-Z0-9_])*$/;

/** Normalize Inkscape output into what the core sanitizer can keep.
 *
 *  Two treatments, both permitted by the licence and recorded in NOTICE:
 *
 *  1. Strip the editor baggage — sodipodi/inkscape/RDF namespaces and
 *     elements, XML prolog, comments. More than half the bytes.
 *  2. Promote `style="fill:#326ce5;…"` into presentation attributes. These
 *     files carry ALL their paint in `style`, and the load-time sanitizer
 *     drops `style` entirely (its allowlist has no way to police CSS) — left
 *     alone, every icon would render unfilled. Only properties the
 *     sanitizer's ATTRS allowlist accepts are promoted; the rest
 *     (`-inkscape-font-specification`, `display`, `marker`, …) are dropped.
 *
 *  Geometry and colour values are never altered — this moves them, verbatim,
 *  from CSS to attributes. */
const PROMOTE = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-opacity",
  "opacity", "font-size", "font-family", "text-anchor", "stop-color",
  "stop-opacity",
]);

function promoteStyles(svg: string): string {
  return svg.replace(/<[a-zA-Z][^>]*>/g, (tag) => {
    const m = /\s+style="([^"]*)"/.exec(tag);
    if (!m) return tag;
    let out = tag.replace(m[0], "");
    for (const decl of m[1].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      const value = decl.slice(i + 1).trim();
      if (!PROMOTE.has(prop) || !value) continue;
      // the style value wins over any same-name attribute (CSS precedence)
      const existing = new RegExp(`\\s+${prop}="[^"]*"`);
      out = out.replace(existing, "");
      out = out.replace(/(\/?>)$/, ` ${prop}="${value}"$1`);
    }
    return out;
  });
}

/** Give the artwork the optical margin every other colour pack ships with.
 *  Azure's glyphs carry built-in whitespace; these are drawn edge-to-edge in
 *  their viewBox, so anywhere the renderer places them flush — the zone-chip
 *  tab especially — the heptagon touches the border and reads as overflow
 *  rather than as a mark. 8% per side, applied to the viewBox only: the
 *  geometry inside is untouched. */
const MARGIN = 0.08;
function padViewBox(svg: string): string {
  return svg.replace(/viewBox="([\d.eE+-]+)[ ,]+([\d.eE+-]+)[ ,]+([\d.eE+-]+)[ ,]+([\d.eE+-]+)"/,
    (_m, x, y, w, h) => {
      const [X, Y, W, H] = [+x, +y, +w, +h];
      const round = (n: number) => String(+n.toFixed(4));
      return `viewBox="${round(X - W * MARGIN)} ${round(Y - H * MARGIN)} ${round(W * (1 + 2 * MARGIN))} ${round(H * (1 + 2 * MARGIN))}"`;
    });
}

function stripMetadata(svg: string): string {
  const cleaned = svg
    .replace(/<\?xml[^?]*\?>\s*/g, "")
    .replace(/<!--[\s\S]*?-->\s*/g, "")
    .replace(/<metadata[\s\S]*?<\/metadata>\s*/g, "")
    .replace(/<sodipodi:namedview[\s\S]*?(\/>|<\/sodipodi:namedview>)\s*/g, "")
    .replace(/\s+(?:inkscape|sodipodi):[\w-]+="[^"]*"/g, "")
    .replace(/\s+xmlns:(?:dc|cc|rdf|svg|sodipodi|inkscape)="[^"]*"/g, "")
    .replace(/\n{3,}/g, "\n\n");
  return padViewBox(promoteStyles(cleaned));
}

async function fetchSvg(dir: string, id: string): Promise<string> {
  const url = `${RAW}/${dir}/${id}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

const iconsDir = join(pkgRoot, "icons");
rmSync(iconsDir, { recursive: true, force: true });
mkdirSync(iconsDir, { recursive: true });

interface IconEntry { file: string; title: string; category: string }
const icons: Record<string, IconEntry> = {};
const problems: string[] = [];

for (const { dir, ids } of SOURCES) {
  for (const id of [...ids].sort()) {
    if (!IDENT.test(id)) { problems.push(`id not Ident-safe: ${id}`); continue; }
    const title = TITLES[id];
    if (!title) { problems.push(`no title for: ${id}`); continue; }
    const raw = await fetchSvg(dir, id);
    const svg = stripMetadata(raw);
    // a root without a viewBox mis-scales silently (the sanitizer falls back
    // to 0 0 80 80), so it is a fetch-time error, not a runtime surprise
    if (!/<svg[^>]*viewBox="/.test(svg)) { problems.push(`no viewBox: ${dir}/${id}`); continue; }
    writeFileSync(join(iconsDir, `${id}.svg`), svg);
    icons[id] = { file: `${id}.svg`, title, category: CATEGORY[dir] };
  }
}

// Drop any alias whose target was not fetched, and any that collides with a
// real id — a dangling alias fails packs.test.ts, and a shadowing one would
// hide the icon it is named after.
const aliases: Record<string, string> = {};
for (const [alias, target] of Object.entries(ALIASES)) {
  if (!IDENT.test(alias)) { problems.push(`alias not Ident-safe: ${alias}`); continue; }
  if (icons[target] && !icons[alias]) aliases[alias] = target;
  else if (!icons[target]) problems.push(`alias to missing icon: ${alias} -> ${target}`);
}

// every title key must correspond to a fetched icon — a stale key is a typo
for (const id of Object.keys(TITLES))
  if (!icons[id]) problems.push(`title for unfetched id: ${id}`);

if (problems.length) {
  console.error(`fetch problems:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

writeFileSync(
  join(pkgRoot, "pack.json"),
  JSON.stringify(
    {
      name: "k8s",
      title: "Kubernetes",
      release: COMMIT.slice(0, 12),
      source: "https://github.com/kubernetes/community/tree/main/icons",
      license: "Apache-2.0 OR CC-BY-4.0",
      attribution: "Kubernetes community icons — © the Kubernetes Authors",
      icons: Object.fromEntries(Object.entries(icons).sort(([a], [b]) => a.localeCompare(b))),
      aliases: Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + "\n",
);

// Apache-2.0 is the arm of the dual licence this pack redistributes under,
// and it requires its text to travel with the work.
const lic = await fetch(`https://raw.githubusercontent.com/kubernetes/community/${COMMIT}/LICENSE`);
if (!lic.ok) throw new Error(`could not fetch upstream LICENSE (${lic.status})`);
writeFileSync(join(pkgRoot, "LICENSE-ICONS.txt"), await lic.text());

console.log(
  `pack-k8s: ${Object.keys(icons).length} icons, ${Object.keys(aliases).length} aliases ` +
  `@ kubernetes/community ${COMMIT.slice(0, 12)}`,
);
console.log(`${readdirSync(iconsDir).length} files in icons/`);
