export interface Loc {
  from: number;
  to: number;
  line: number;
  col: number;
}

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  fix?: string; // "did you mean …?" — always actionable when present
  loc: Loc;
}

export interface SNode {
  path: string; // full dotted path — the stable identity
  name: string; // last segment
  label: string;
  icon?: { pack: string; id: string };
  kinds: ("external" | "datastore" | "person")[];
  description?: string;
  tags: string[];
  attrs: Record<string, string>;
  loc: Loc;
}

export interface SContainer {
  path: string;
  name: string;
  kind: "system" | "container";
  label?: string;
  children: string[]; // child paths, declaration order
  attrs: Record<string, string>;
  tags: string[];
  loc: Loc;
}

export type ArrowKind = "->" | "~>" | "<->" | "--";

export interface SEdge {
  id: string; // e1, e2… declaration order after fan-out expansion
  from: string; // resolved path
  to: string;
  arrow: ArrowKind;
  label?: string;
  attrs: Record<string, string>;
  tags: string[];
  loc: Loc;
}

export type Side = "north" | "south" | "east" | "west";
export type RelPos = "right-of" | "left-of" | "above" | "below";

export interface SView {
  name: string;
  title?: string;
  theme?: string;
  scope?: string; // container path
  layout: {
    direction?: "down" | "right";
    rows?: string[][]; // resolved paths
    place: { node: string; relpos: RelPos; target: string; loc: Loc }[];
    routes: { from: string; to: string; label?: string; fromSide?: Side; toSide?: Side; loc: Loc }[];
  };
  loc: Loc;
}

export interface SModel {
  packs: string[];
  nodes: Map<string, SNode>;
  containers: Map<string, SContainer>;
  edges: SEdge[];
  views: SView[];
  fileTheme?: string;
}

export interface BuildResult {
  model: SModel;
  diagnostics: Diagnostic[];
  ok: boolean; // no error-severity diagnostics
}
