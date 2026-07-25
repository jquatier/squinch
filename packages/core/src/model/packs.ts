// v1-slice pack registry: a built-in AWS manifest subset. The real pack pipeline
// (npm packs, pack.json, sanitization) is Phase 2 — this provides the contract:
// icon ids are validated at build time, with did-you-mean on misses.
export interface IconMeta {
  code: string; // plate abbreviation until real SVG assets land
  color: string;
}

const aws: Record<string, IconMeta> = {
  "api-gateway": { code: "APIGW", color: "#B0468C" },
  lambda: { code: "λ", color: "#D9760A" },
  dynamodb: { code: "DDB", color: "#4568C9" },
  s3: { code: "S3", color: "#6C8F1F" },
  opensearch: { code: "OS", color: "#8A5FC9" },
  sqs: { code: "SQS", color: "#B0468C" },
  sns: { code: "SNS", color: "#B0468C" },
  eventbridge: { code: "EVB", color: "#B0468C" },
  kinesis: { code: "KIN", color: "#8A5FC9" },
  aurora: { code: "AUR", color: "#4568C9" },
  rds: { code: "RDS", color: "#4568C9" },
  cloudfront: { code: "CF", color: "#8A5FC9" },
  amplify: { code: "AMP", color: "#C7362E" },
  ecs: { code: "ECS", color: "#D9760A" },
  eks: { code: "EKS", color: "#D9760A" },
  "step-functions": { code: "SFN", color: "#B0468C" },
};

const builtin: Record<string, IconMeta> = {
  box: { code: "▢", color: "#6F6E69" },
  person: { code: "☺", color: "#6F6E69" },
};

// First-party archetype glyphs (DESIGN §: sys pack) — text codes until the real
// stroke-SVG set lands; used as card badges.
const sys: Record<string, IconMeta> = {
  api: { code: "API", color: "#6F6E69" },
  webapp: { code: "WEB", color: "#6F6E69" },
  mobile: { code: "MOB", color: "#6F6E69" },
  service: { code: "SVC", color: "#6F6E69" },
  worker: { code: "WRK", color: "#6F6E69" },
  database: { code: "DB", color: "#6F6E69" },
  cache: { code: "$", color: "#6F6E69" },
  queue: { code: "Q", color: "#6F6E69" },
  "event-bus": { code: "BUS", color: "#6F6E69" },
  filestore: { code: "FS", color: "#6F6E69" },
  search: { code: "SRCH", color: "#6F6E69" },
  gateway: { code: "GW", color: "#6F6E69" },
  auth: { code: "AUTH", color: "#6F6E69" },
  monitor: { code: "MON", color: "#6F6E69" },
  scheduler: { code: "CRON", color: "#6F6E69" },
  org: { code: "ORG", color: "#6F6E69" },
  internet: { code: "NET", color: "#6F6E69" },
};

export const packs: Record<string, Record<string, IconMeta>> = { aws, builtin, sys };

export function iconMeta(pack: string, id: string): IconMeta | undefined {
  return packs[pack]?.[id];
}

export function iconIds(pack: string): string[] {
  return Object.keys(packs[pack] ?? {});
}
