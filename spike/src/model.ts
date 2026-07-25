// Hand-built models (no parser in Phase 0). Mirrors the canonical SPEC §10.1 example.
export type Side = "NORTH" | "SOUTH" | "EAST" | "WEST";

export interface Node {
  id: string;
  label: string;
  icon: string; // plate code, stands in for the AWS icon in the spike
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  label?: string;
  async?: boolean;
  route?: { fromSide?: Side; toSide?: Side }; // SPEC: `route a ~> b from east to west`
}

export interface Model {
  name: string;
  nodes: Node[];
  edges: Edge[];
  rows: string[][]; // SPEC Tier-1 `rows` hint
  place: { node: string; rightOf: string }[]; // SPEC Tier-1 `place X right-of Y`
}

export const canonical: Model = {
  name: "canonical",
  nodes: [
    { id: "api", label: "API Gateway", icon: "APIGW" },
    { id: "create", label: "Create Handler", icon: "λ" },
    { id: "get", label: "Get Handler", icon: "λ" },
    { id: "search", label: "Search Handler", icon: "λ" },
    { id: "db", label: "Orders Table", icon: "DDB" },
    { id: "files", label: "Assets", icon: "S3" },
    { id: "idx", label: "Search Index", icon: "OS" },
    { id: "sync", label: "Stream Sync", icon: "λ" },
  ],
  edges: [
    { id: "e1", from: "api", to: "create" },
    { id: "e2", from: "api", to: "get" },
    { id: "e3", from: "api", to: "search" },
    { id: "e4", from: "create", to: "db" },
    { id: "e5", from: "create", to: "files" },
    { id: "e6", from: "get", to: "db" },
    { id: "e7", from: "search", to: "idx" },
    {
      id: "e8",
      from: "db",
      to: "sync",
      label: "DynamoDB stream",
      async: true,
      route: { fromSide: "EAST", toSide: "WEST" },
    },
    { id: "e9", from: "sync", to: "idx", label: "index updates" },
  ],
  rows: [["api"], ["create", "get", "search"], ["db", "files", "idx"]],
  place: [{ node: "sync", rightOf: "db" }],
};

// Exit criterion 1: rank membership must be stable when one node is added.
export const stability: Model = {
  ...canonical,
  name: "stability",
  nodes: [...canonical.nodes, { id: "cache", label: "Cache Warmer", icon: "λ" }],
  edges: [...canonical.edges, { id: "e10", from: "api", to: "cache" }],
  rows: [["api"], ["create", "get", "search", "cache"], ["db", "files", "idx"]],
};

// Exit criterion 4: 4 edges into one side of a node → spread ports + stubs.
export const fanin: Model = {
  name: "fanin",
  nodes: [
    { id: "w1", label: "Ingest A", icon: "λ" },
    { id: "w2", label: "Ingest B", icon: "λ" },
    { id: "w3", label: "Backfill", icon: "λ" },
    { id: "w4", label: "Migration Writer With A Long Name", icon: "λ" },
    { id: "sink", label: "Orders Table", icon: "DDB" },
  ],
  edges: [
    { id: "f1", from: "w1", to: "sink" },
    { id: "f2", from: "w2", to: "sink" },
    { id: "f3", from: "w3", to: "sink", label: "batched" },
    { id: "f4", from: "w4", to: "sink" },
  ],
  rows: [["w1", "w2", "w3", "w4"], ["sink"]],
  place: [],
};
