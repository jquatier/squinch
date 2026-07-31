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
  file?: string; // set when built via buildProject
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
  file?: string;
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
  file?: string;
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
  file?: string;
}

export type Side = "north" | "south" | "east" | "west";
export type RelPos = "right-of" | "left-of" | "above" | "below";

export type NoteAnchor =
  | { kind: "relpos"; relpos: RelPos; target: string }
  | { kind: "edge"; from: string; to: string }
  | { kind: "corner"; corner: "top-left" | "top-right" | "bottom-left" | "bottom-right" };

export interface SNote {
  anchor: NoteAnchor;
  text: string;
  style?: string; // e.g. "warning"
  loc: Loc;
}

export interface SView {
  name: string;
  title?: string;
  theme?: string;
  scope?: string; // container path
  /** Filter: keep only interior elements matching these ids/tags. Empty = no
   *  filter. This is the view's *which* axis; `scope` is its *where*. */
  only: (string | { tag: string })[];
  include: (string | { tag: string })[]; // "*" arrives as {star:true}? — "*" as literal path
  includeStar: boolean;
  exclude: (string | { tag: string })[];
  expand: string[];
  /** Outside elements to draw at their own depth instead of as their top-level
   *  card. Split out of `include`, which used to carry this second meaning. */
  detail: string[];
  context: "auto" | "off";
  highlight: string[]; // tag names, no '#'
  showDescriptions: boolean;
  showFlow?: string; // flow id — render ①②③ badges on that flow's edges
  legend: boolean; // `legend auto` — key of the styles actually used (off by default)
  titleblock?: Record<string, string>; // drafting corner block key/values
  notes: SNote[];
  layout: {
    direction?: "down" | "right";
    density?: "compact" | "comfortable" | "spacious";
    lines?: "orthogonal" | "curved" | "straight";
    rows?: string[][]; // resolved paths — horizontal bands, top to bottom
    /** vertical bands, left to right: members share an axis exactly */
    cols?: string[][];
    place: { node: string; relpos: RelPos; target: string; loc: Loc }[];
    /** `align a b c` — b and c share a's axis exactly (a is the anchor). */
    align: { nodes: string[]; loc: Loc }[];
    routes: { from: string; to: string; label?: string; fromSide?: Side; toSide?: Side; loc: Loc }[];
    /** `channel a, b, c -> db` — those edges merge into one trunk (SPEC §6 Tier 2). */
    channels: { sources: string[]; target: string; loc: Loc }[];
  };
  loc: Loc;
  file?: string;
  /** Synthesized for a container that has no explicit view (SPEC §5). */
  auto?: boolean;
}

// Deployment boundaries (SPEC §Zones): cross-cutting membership, separate
// from the ownership hierarchy. Kind drives the frame styling.
export const ZONE_KINDS = [
  "account", "region", "vpc", "subnet", "network", "cloud", "onprem", "custom",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export type ZoneLabelPos = "top-left" | "top-right" | "bottom-left" | "bottom-right";

// zone outline colors are THEME ROLES, never hex (SPEC: diagrams reference
// roles) — four kind-group tints plus the general-purpose inks
export const ZONE_COLORS = [
  "account", "network", "cloud", "neutral", "ink", "muted", "accent",
] as const;
export type ZoneColor = (typeof ZONE_COLORS)[number];

export interface SZone {
  id: string;
  label?: string;
  kind: ZoneKind;
  members: string[]; // resolved node/container paths, declaration order
  icon?: { pack: string; id: string }; // optional chip icon (flush tab)
  labelPos: ZoneLabelPos; // which border corner the chip straddles
  color?: ZoneColor; // outline/tint override; default derives from kind
  loc: Loc;
  file?: string;
}

// Numbered paths (SPEC §Flows): an ordered walk over EXISTING edges — flows
// annotate the model, they never create structure.
export interface SFlow {
  id: string;
  label?: string;
  steps: { from: string; to: string }[]; // resolved, declaration order = numbering
  loc: Loc;
  file?: string;
}

export interface SModel {
  packs: string[];
  nodes: Map<string, SNode>;
  containers: Map<string, SContainer>;
  edges: SEdge[];
  zones: SZone[];
  flows: SFlow[];
  views: SView[];
  fileTheme?: string;
}

export interface BuildResult {
  model: SModel;
  diagnostics: Diagnostic[];
  ok: boolean; // no error-severity diagnostics
}
