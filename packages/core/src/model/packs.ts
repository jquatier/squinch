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

export const packs: Record<string, Record<string, IconMeta>> = { aws, builtin };

export function iconMeta(pack: string, id: string): IconMeta | undefined {
  return packs[pack]?.[id];
}

export function iconIds(pack: string): string[] {
  return Object.keys(packs[pack] ?? {});
}
