// Maintainer-only: regenerate the pack from Lucide (ISC). Icons are copied
// VERBATIM at Lucide's own 2px stroke — the neutral plate and currentColor tint
// happen at render time in @squinch/core, never here.
//
//   npm run fetch
//
// Lucide ships 2,000+ icons. Vendoring all of them would bury the ones people
// actually reach for under a pile of shopping carts and coffee cups, so this is
// a curated list, grouped by the role an icon plays in an architecture diagram.
// Add an id, run the script, commit the result. Unknown ids are reported, never
// silent.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lucideRoot = dirname(require.resolve("lucide-static/package.json"));
const iconsSrc = join(lucideRoot, "icons");

/** Curated by role. The group name becomes the icon's `category`. */
const CURATED: Record<string, string[]> = {
  Compute: [
    "server", "server-cog", "cpu", "container", "box", "boxes", "hexagon",
    "component", "layers", "package", "microchip", "terminal", "cog", "settings",
  ],
  Hardware: [
    "laptop", "monitor", "smartphone", "tablet", "hard-drive", "disc", "printer",
    "keyboard", "mouse", "webcam", "usb", "battery", "plug", "power",
  ],
  Network: [
    "network", "router", "wifi", "radio-tower", "cable", "ethernet-port",
    "satellite-dish", "globe", "rss", "share-2", "git-fork", "split", "merge",
    "arrow-left-right", "waypoints",
  ],
  Security: [
    "lock", "lock-keyhole", "unlock", "key-round", "shield", "shield-check",
    "shield-alert", "fingerprint", "scan-face", "user-check", "eye-off",
  ],
  Data: [
    "database", "folder", "folder-open", "file", "files", "archive", "table",
    "save", "hard-drive-download", "hard-drive-upload", "binary", "sheet",
    "search", "filter", "funnel", "tags", "bookmark",
  ],
  Places: [
    "factory", "warehouse", "building", "building-2", "house", "store",
    "landmark", "map-pin", "map", "earth",
  ],
  App: [
    "code", "app-window", "braces", "webhook", "workflow", "route", "door-open",
    "log-in", "log-out", "square-function", "puzzle", "blocks",
  ],
  Messaging: [
    "list", "list-ordered", "inbox", "mail", "send", "bell", "radio", "antenna",
    "megaphone", "message-square", "zap",
  ],
  Observability: [
    "activity", "gauge", "chart-line", "chart-bar", "chart-pie", "eye", "scan",
    "bug", "siren", "thermometer", "clipboard-list",
  ],
  People: [
    "user", "users", "user-cog", "contact", "briefcase", "id-card", "handshake",
  ],
  Process: [
    "clock", "calendar-clock", "timer", "hourglass", "repeat", "refresh-cw",
    "play", "circle-play", "pause", "git-branch", "git-merge", "check-check",
  ],
  Shapes: [
    "circle", "square", "triangle", "diamond", "star", "pentagon", "octagon",
    "shapes", "grid-2x2", "asterisk", "dot", "circle-dot", "square-dashed",
  ],
};

/** `hard-drive-download` → `Hard drive download`; the id is already the name. */
const titleOf = (id: string) =>
  id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Lucide's names are not always the word an architect reaches for: you type
 *  `gear`, it is called `cog`. Aliases so search and authoring both work — the
 *  same treatment pack-logos gives `postgres` → `postgresql`.
 *
 *  Deliberately NOT here: the ids this pack replaced (`api`, `webapp`, `queue`,
 *  `auth`, `monitor`, `gateway`, …). Aliasing those would quietly resurrect the
 *  old vocabulary — `sys/api` would resolve, so a reference this migration
 *  missed would render some other icon instead of failing `check`. The rename is
 *  meant to be enforceable, so the old names must stay unresolvable. */
const ALIASES: Record<string, string> = {
  gear: "cog", cube: "box", disk: "hard-drive", ssd: "hard-drive",
  db: "database", firewall: "shield", phone: "smartphone",
  desktop: "monitor", screen: "monitor", pc: "monitor",
  rack: "server", vm: "server", host: "server",
  onprem: "factory", plant: "factory", office: "building-2",
  people: "users", team: "users",
  browser: "app-window", topic: "radio-tower", broker: "radio-tower",
  pubsub: "radio-tower", lambda: "zap", fn: "square-function",
  bucket: "folder", blob: "folder",
  secret: "lock-keyhole", vault: "lock-keyhole", cert: "shield-check",
  metrics: "chart-line", logs: "clipboard-list", alert: "siren",
  trace: "activity", cron: "clock", retry: "refresh-cw",
  ingress: "log-in", egress: "log-out",
  lb: "share-2", "load-balancer": "share-2",
  cdn: "earth", dns: "globe", job: "cog",
};

interface IconEntry { file: string; title: string; category: string }

const icons: Record<string, IconEntry> = {};
const missing: string[] = [];
const iconsDir = join(pkgRoot, "icons");
rmSync(iconsDir, { recursive: true, force: true });
mkdirSync(iconsDir, { recursive: true });

for (const [category, ids] of Object.entries(CURATED))
  for (const id of [...ids].sort()) {
    const src = join(iconsSrc, `${id}.svg`);
    if (!existsSync(src)) {
      missing.push(id);
      continue;
    }
    writeFileSync(join(iconsDir, `${id}.svg`), readFileSync(src, "utf8")); // verbatim
    icons[id] = { file: `${id}.svg`, title: titleOf(id), category };
  }

// Drop any alias whose target was not curated, and any that collides with a
// real id — a dangling alias fails packs.test.ts, and a shadowing one would
// hide the icon it is named after.
const aliases: Record<string, string> = {};
for (const [alias, target] of Object.entries(ALIASES))
  if (icons[target] && !icons[alias]) aliases[alias] = target;

// `title` is what makes multi-word search work: searchIcons matches every query
// word against `id + title`. `category` is written for parity with the other
// packs and is not currently read by anything.
const version = (
  JSON.parse(readFileSync(join(lucideRoot, "package.json"), "utf8")) as { version: string }
).version;

// ISC requires the copyright notice to travel with the files.
writeFileSync(join(pkgRoot, "LICENSE-ICONS.txt"), readFileSync(join(lucideRoot, "LICENSE"), "utf8"));

writeFileSync(
  join(pkgRoot, "pack.json"),
  JSON.stringify(
    {
      name: "sys",
      title: "System, infrastructure & shapes",
      release: version,
      source: "https://lucide.dev",
      license: "ISC",
      attribution: "Lucide — https://lucide.dev (ISC); portions from Feather (MIT)",
      // stroke-only artwork painting with currentColor: the renderer plates it
      // on a neutral square and tints it, exactly as it did when this set was
      // drawn by hand in core
      monochrome: true,
      icons: Object.fromEntries(Object.entries(icons).sort(([a], [b]) => a.localeCompare(b))),
      aliases: Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `wrote ${Object.keys(icons).length} icons + ${Object.keys(aliases).length} aliases ` +
    `across ${Object.keys(CURATED).length} categories ` +
    `(lucide-static ${version})` +
    (missing.length ? `\nunknown ids (upstream renamed or removed?): ${missing.join(", ")}` : ""),
);
