// Maintainer-only: regenerate the pack from Simple Icons (CC0-1.0). Icons are
// copied VERBATIM — the brand-coloured plate treatment happens at render time
// in @squinch/core, never here.
//
//   npm run fetch
//
// Simple Icons ships ~3,450 marks. Vendoring all of them would bloat every
// install and bury the ones people actually reach for, so this is a curated
// list: the products that show up in architecture diagrams. Add a slug, run
// the script, commit the result. Unknown slugs are reported, never silent.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// The package's export map hides icons/*.svg, so resolve its root and read the
// files directly; metadata comes from the module's own icon objects.
const siRoot = dirname(require.resolve("simple-icons"));
const si = (await import("simple-icons")) as Record<string, unknown>;
const bySlug = new Map<string, { slug: string; title: string; hex: string }>();
for (const value of Object.values(si))
  if (value && typeof value === "object" && "slug" in value)
    bySlug.set((value as { slug: string }).slug, value as { slug: string; title: string; hex: string });

// Deliberately absent, and not an oversight: Simple Icons removes marks at the
// trademark owner's request, so Slack, Twilio, Salesforce, Heroku, SendGrid,
// Segment, Tableau, dbt, gRPC, HAProxy, Linode and Typesense have no upstream
// icon. Use `box` for those — do not re-add the slugs expecting them to appear.
/** Curated by role — the categories double as `squinch icons search` context. */
const CURATED: Record<string, string[]> = {
  Database: [
    "postgresql", "mysql", "mariadb", "mongodb", "redis", "sqlite", "elasticsearch",
    "apachecassandra", "neo4j", "clickhouse", "influxdb", "duckdb", "cockroachlabs",
    "supabase", "planetscale", "prisma",
  ],
  Messaging: ["apachekafka", "rabbitmq", "natsdotio", "celery", "apachepulsar"],
  Runtime: [
    "nodedotjs", "python", "go", "rust", "openjdk", "typescript", "javascript",
    "php", "ruby", "dotnet", "deno", "bun", "elixir", "kotlin", "swift", "scala",
  ],
  Framework: [
    "spring", "django", "rubyonrails", "fastapi", "express", "nestjs", "laravel",
    "flask", "react", "vuedotjs", "angular", "svelte", "nextdotjs", "nuxt", "astro",
  ],
  Platform: [
    "docker", "kubernetes", "terraform", "ansible", "nginx", "apache", "helm",
    "vault", "consul", "envoyproxy", "istio", "argo", "podman", "redhatopenshift",
    "cloudflare", "vercel", "netlify", "digitalocean", "googlecloud",
    "render", "railway", "fastly", "akamai",
  ],
  Observability: [
    "grafana", "prometheus", "datadog", "sentry", "opentelemetry", "jaeger",
    "elastic", "kibana", "newrelic", "splunk", "pagerduty",
  ],
  Data: [
    "snowflake", "databricks", "apacheairflow", "apachespark", "apacheflink",
    "looker", "apachehadoop",
  ],
  Service: [
    "stripe", "auth0", "okta", "algolia", "meilisearch",
    "mailgun", "shopify", "hubspot", "atlassian", "jira", "discord", "zoom",
  ],
  "Source control": [
    "github", "gitlab", "bitbucket", "git", "githubactions", "circleci", "jenkins",
    "sonarqubeserver", "renovate",
  ],
  Protocol: ["graphql", "apollographql", "swagger", "openapiinitiative", "socketdotio"],
  Gateway: ["kong", "traefikproxy", "caddy"],
  Storage: ["minio", "ceph"],
};

interface IconEntry { file: string; title: string; category: string; color: string }

const icons: Record<string, IconEntry> = {};
const missing: string[] = [];
const iconsDir = join(pkgRoot, "icons");
rmSync(iconsDir, { recursive: true, force: true });
mkdirSync(iconsDir, { recursive: true });

for (const [category, slugs] of Object.entries(CURATED))
  for (const slug of slugs.sort()) {
    const meta = bySlug.get(slug);
    const file = join(siRoot, "icons", `${slug}.svg`);
    if (!meta || !existsSync(file)) {
      missing.push(slug);
      continue;
    }
    const svg = readFileSync(file, "utf8");
    writeFileSync(join(iconsDir, `${slug}.svg`), svg); // verbatim
    icons[slug] = { file: `${slug}.svg`, title: meta.title, category, color: `#${meta.hex}` };
  }

/** Short aliases for names people type differently than the upstream slug. */
const ALIASES: Record<string, string> = {
  postgres: "postgresql", node: "nodedotjs", nodejs: "nodedotjs",
  kafka: "apachekafka", cassandra: "apachecassandra", pulsar: "apachepulsar",
  nats: "natsdotio", java: "openjdk", rails: "rubyonrails", vue: "vuedotjs",
  next: "nextdotjs", nextjs: "nextdotjs", k8s: "kubernetes", es: "elasticsearch",
  airflow: "apacheairflow", spark: "apachespark", flink: "apacheflink",
  hadoop: "apachehadoop", traefik: "traefikproxy", envoy: "envoyproxy",
  gcp: "googlecloud", ts: "typescript", js: "javascript", socketio: "socketdotio",
  openapi: "openapiinitiative", actions: "githubactions",
  openshift: "redhatopenshift", sonarqube: "sonarqubeserver",
};
const aliases: Record<string, string> = {};
for (const [alias, target] of Object.entries(ALIASES))
  if (icons[target] && !icons[alias]) aliases[alias] = target;

const version = (JSON.parse(readFileSync(join(siRoot, "package.json"), "utf8")) as { version: string }).version;
writeFileSync(
  join(pkgRoot, "pack.json"),
  JSON.stringify(
    {
      name: "logos",
      title: "Product & technology logos",
      release: version,
      source: "https://simpleicons.org",
      license: "CC0-1.0",
      attribution: "Simple Icons — https://simpleicons.org (marks are their owners' trademarks)",
      // single-path marks: the renderer plates them in the brand colour
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
    `(simple-icons ${version})` +
    (missing.length ? `\nunknown slugs (upstream renamed or removed?): ${missing.join(", ")}` : ""),
);
