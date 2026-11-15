// Placement with zones and expanded containers: is the arrangement the author
// asked for the one drawn? Every case states an arrangement in the source and
// then checks the rectangles for it — side by side means side by side.
import { describe, it, expect } from "vitest";
import { buildProject } from "../../src/index.js";
import { layoutView } from "../../src/layout/layout.js";
import { checkLayout } from "../invariants.js";
import { row, stack, level, leftOf, sys, zone, view, type Ask } from "./asks.js";

const web = sys("web", "Web", ["ui", "bff"], ["ui -> bff"]);
const api = sys("api", "API", ["gw", "svc", "db"], ["gw -> svc", "svc -> db"]);
const data = sys("data", "Data", ["lake", "jobs"], ["jobs -> lake"]);
const ops = sys("ops", "Ops", ["mon", "log"]);

interface Case { name: string; src: string; asks: Ask[] }
export const cases: Case[] = [
  { name: "two zones, cards, side by side",
    src: web + api + "web.bff -> api.gw\n" + zone("a", "Public", "vpc", "web") + zone("b", "Private", "vpc", "api") + view("layout { rows [web api] }"),
    asks: [row("a", "b"), level("a", "b")] },
  { name: "two zones, expanded, side by side",
    src: web + api + "web.bff -> api.gw \"REST\"\n" + zone("a", "Public", "vpc", "web") + zone("b", "Private", "vpc", "api") + view("expand web, api\nlayout { rows [web api] }"),
    asks: [row("a", "b"), level("a", "b"), row("web", "api")] },
  { name: "three zones in a row, chained",
    src: web + api + data + "web.bff -> api.gw\napi.svc -> data.lake\n" + zone("a", "Edge", "vpc", "web") + zone("b", "App", "vpc", "api") + zone("c", "Data", "vpc", "data") + view("expand *\nlayout { rows [web api data] }"),
    asks: [row("a", "b", "c"), level("a", "b", "c")] },
  { name: "three zones in a row, calls both ways",
    src: web + api + data + "web.bff -> api.gw\napi.svc -> web.bff \"push\"\napi.svc -> data.lake\ndata.jobs ~> api.svc \"done\"\n" + zone("a", "Edge", "vpc", "web") + zone("b", "App", "vpc", "api") + zone("c", "Data", "vpc", "data") + view("expand *\nlayout { rows [web api data] }"),
    asks: [row("a", "b", "c"), level("a", "b", "c")] },
  { name: "a row of three, a wire skipping the middle",
    src: web + api + data + "web.bff -> data.lake \"export\"\nweb.bff -> api.gw\n" + zone("a", "Edge", "vpc", "web") + zone("b", "App", "vpc", "api") + zone("c", "Data", "vpc", "data") + view("expand *\nlayout { rows [web api data] }"),
    asks: [row("a", "b", "c"), level("a", "b", "c")] },
  { name: "two zones side by side, shared service below",
    src: web + api + 'bus = box "Event bus"\nweb.bff ~> bus\napi.svc ~> bus\n' + zone("a", "Public", "vpc", "web") + zone("b", "Private", "vpc", "api") + view("expand web, api\nlayout { rows [web api] [bus] }"),
    asks: [row("a", "b"), level("a", "b"), stack("a", "bus"), stack("b", "bus")] },
  { name: "two zones side by side, a bus they both publish to and read from",
    src: web + api + 'bus = box "Event bus"\nweb.bff ~> bus\nbus ~> api.svc\napi.svc ~> bus\nbus ~> web.bff\n' + zone("a", "Public", "vpc", "web") + zone("b", "Private", "vpc", "api") + view("expand web, api\nlayout { rows [web api] }"),
    asks: [row("a", "b"), level("a", "b")] },
  { name: "user above two zones side by side",
    src: 'person u "User"\n' + web + api + "u -> web.ui\nu -> api.gw\nweb.bff -> api.gw\n" + zone("a", "Public", "vpc", "web") + zone("b", "Private", "vpc", "api") + view("expand web, api\nlayout { rows [u] [web api] }"),
    asks: [row("a", "b"), level("a", "b"), stack("u", "a")] },
  { name: "two by two",
    src: web + api + data + ops + "web.bff -> api.gw\nweb.bff -> data.lake\napi.svc -> ops.log\ndata.jobs -> ops.mon\n" + zone("a", "A", "vpc", "web") + zone("b", "B", "vpc", "api") + zone("c", "C", "vpc", "data") + zone("d", "D", "vpc", "ops") + view("expand *\nlayout { rows [web api] [data ops] }"),
    asks: [row("a", "b"), row("c", "d"), stack("a", "c"), stack("b", "d"), level("a", "b"), level("c", "d")] },
  { name: "two expanded systems side by side inside one zone",
    src: web + api + "web.bff -> api.gw\n" + zone("z", "VPC", "vpc", "web", "api") + view("expand web, api\nlayout { rows [web api] }"),
    asks: [row("web", "api"), level("web", "api")] },
  { name: "nested: a cloud holding two VPCs side by side",
    src: web + api + "web.bff -> api.gw\n" + zone("cloud", "Cloud", "cloud", "web", "api") + zone("a", "VPC one", "vpc", "web") + zone("b", "VPC two", "vpc", "api") + view("expand web, api\nlayout { rows [web api] }"),
    asks: [row("a", "b"), level("a", "b")] },
  { name: "on-premises beside a cloud that holds two VPCs",
    src: 'erp = box "ERP"\n' + web + api + "erp -> api.gw \"sync\"\nweb.bff -> api.gw\n" + zone("onprem", "On-prem", "onprem", "erp") + zone("cloud", "Cloud", "cloud", "web", "api") + zone("a", "VPC one", "vpc", "web") + zone("b", "VPC two", "vpc", "api") + view("expand web, api\nlayout { rows [erp web api] }"),
    asks: [row("onprem", "cloud"), row("a", "b"), level("a", "b")] },
  { name: "zones of bare boxes side by side, one member named each",
    src: 'a1 = box "A1"\na2 = box "A2"\na3 = box "A3"\nb1 = box "B1"\nb2 = box "B2"\na1 -> a2\na2 -> a3\nb1 -> b2\na2 -> b1\n' + zone("a", "Left", "vpc", "a1", "a2", "a3") + zone("b", "Right", "vpc", "b1", "b2") + view("layout { rows [a1 b1] }"),
    asks: [row("a", "b"), level("a", "b")] },
  { name: "a tall zone beside a short one",
    src: sys("tall", "Tall", ["t1", "t2", "t3", "t4"], ["t1 -> t2", "t2 -> t3", "t3 -> t4"]) + sys("short", "Short", ["s1"]) + "tall.t2 -> short.s1\n" + zone("a", "Tall", "vpc", "tall") + zone("b", "Short", "vpc", "short") + view("expand *\nlayout { rows [tall short] }"),
    asks: [row("a", "b"), level("a", "b")] },
  { name: "side by side with no wire between them",
    src: web + api + data + zone("a", "A", "vpc", "web") + zone("b", "B", "vpc", "api") + zone("c", "C", "vpc", "data") + view("expand *\nlayout { rows [web api data] }"),
    asks: [row("a", "b", "c"), level("a", "b", "c")] },
  { name: "side by side by `cols`",
    src: web + api + "web.bff -> api.gw\n" + zone("a", "Public", "vpc", "web") + zone("b", "Private", "vpc", "api") + view("expand web, api\nlayout { cols [web] [api] }"),
    asks: [leftOf("a", "b")] },
  { name: "side by side by `place`",
    src: web + api + "web.bff -> api.gw\n" + zone("a", "Public", "vpc", "web") + zone("b", "Private", "vpc", "api") + view("expand web, api\nlayout { place api right-of web }"),
    asks: [row("a", "b"), level("a", "b")] },
  { name: "stacked on purpose although the wire runs upward",
    src: web + api + "api.svc -> web.bff \"callback\"\n" + zone("a", "Public", "vpc", "web") + zone("b", "Private", "vpc", "api") + view("expand web, api\nlayout { rows [web] [api] }"),
    asks: [stack("a", "b")] },
  { name: "left to right flow, zones as columns",
    src: web + api + data + "web.bff -> api.gw\napi.svc -> data.lake\n" + zone("a", "Edge", "vpc", "web") + zone("b", "App", "vpc", "api") + zone("c", "Data", "vpc", "data") + view("expand *\nlayout { direction right }"),
    asks: [row("a", "b", "c")] },
  { name: "left to right flow, two zones in one column",
    src: web + api + data + "web.bff -> api.gw\nweb.bff -> data.lake\n" + zone("a", "Edge", "vpc", "web") + zone("b", "App", "vpc", "api") + zone("c", "Data", "vpc", "data") + view("expand *\nlayout { direction right\n rows [web] [api data] }"),
    asks: [row("a", "b"), leftOf("a", "c"), stack("b", "c")] },
  { name: "rows inside one zone",
    src: 'a = box "A"\nb = box "B"\nc = box "C"\nd = box "D"\na -> c\nb -> c\nc -> d\na -> b\n' + zone("z", "Zone", "vpc", "a", "b", "c", "d") + view("layout { rows [a b] [c] [d] }"),
    asks: [row("a", "b"), level("a", "b"), stack("a", "c"), stack("c", "d")] },
  { name: "rows inside each of two zones that sit side by side",
    src: 'a1 = box "A1"\na2 = box "A2"\nb1 = box "B1"\nb2 = box "B2"\na1 -> a2\nb1 -> b2\na1 -> b1\na2 -> b2\n' + zone("a", "Left", "vpc", "a1", "a2") + zone("b", "Right", "vpc", "b1", "b2") + view("layout { rows [a1 b1] [a2 b2] }"),
    asks: [row("a", "b"), level("a", "b"), stack("a1", "a2"), stack("b1", "b2"), level("a1", "b1"), level("a2", "b2")] },
  { name: "expanded systems in a row, no zones",
    src: web + api + data + "web.bff -> api.gw\napi.svc -> data.lake\n" + view("expand *\nlayout { rows [web api data] }"),
    asks: [row("web", "api", "data"), level("web", "api", "data")] },
  { name: "expanded systems in a row, calls both ways",
    src: web + api + "web.bff -> api.gw \"query\"\napi.svc -> web.bff \"subscribe\"\n" + view("expand *\nlayout { rows [web api] }"),
    asks: [row("web", "api"), level("web", "api")] },
  { name: "expanded systems two by two",
    src: web + api + data + ops + "web.bff -> api.gw\nweb.bff -> data.lake\napi.svc -> ops.log\ndata.jobs -> ops.mon\napi.svc -> data.lake\n" + view("expand *\nlayout { rows [web api] [data ops] }"),
    asks: [row("web", "api"), row("data", "ops"), stack("web", "data"), stack("api", "ops"), level("web", "api"), level("data", "ops")] },
  { name: "one expanded, one collapsed, side by side in zones",
    src: web + api + "web.bff -> api.gw\n" + zone("a", "Public", "vpc", "web") + zone("b", "Private", "vpc", "api") + view("expand api\nlayout { rows [web api] }"),
    asks: [row("a", "b"), level("a", "b")] },
  { name: "two regions side by side, replication between databases",
    src: sys("east", "East", ["lb", "app", "db"], ["lb -> app", "app -> db"]) + sys("west", "West", ["lb", "app", "db"], ["lb -> app", "app -> db"]) + 'dns = box "DNS"\ndns -> east.lb\ndns -> west.lb\neast.db ~> west.db "replication"\n' + zone("cloud", "Cloud", "cloud", "east", "west") + zone("ra", "us-east-1", "region", "east") + zone("rb", "us-west-2", "region", "west") + view("expand east, west\nlayout { rows [dns] [east west] }"),
    asks: [row("ra", "rb"), level("ra", "rb"), stack("dns", "ra")] },
  { name: "three zones, the outer two call each other across the middle",
    src: web + api + data + "web.bff -> data.lake\ndata.jobs -> web.bff \"refresh\"\napi.svc -> data.lake\n" + zone("a", "A", "vpc", "web") + zone("b", "B", "vpc", "api") + zone("c", "C", "vpc", "data") + view("expand *\nlayout { rows [web api data] }"),
    asks: [row("a", "b", "c"), level("a", "b", "c")] },
];

/** Random: 2–4 zones asked into one row, each an expanded system, wires anywhere. */
function randomRow(seed: number): Case {
  let s = seed * 104729 + 7;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (n: number) => Math.floor(rnd() * n);
  const n = 2 + pick(3);
  const ids = Array.from({ length: n }, (_, i) => `s${i}`);
  const leaves = ids.map((id) => Array.from({ length: 1 + pick(3) }, (_, k) => `${id}.n${k}`));
  let src = ids.map((id, i) => sys(id, `System ${i}`, leaves[i].map((l) => l.split(".")[1]), leaves[i].slice(1).map((l, k) => `n${k} -> ${l.split(".")[1]}`))).join("");
  const flat = leaves.flat();
  for (let k = 0; k < n + pick(4); k++) {
    const a = flat[pick(flat.length)], b = flat[pick(flat.length)];
    if (a.split(".")[0] !== b.split(".")[0]) src += `${a} ${rnd() < 0.3 ? "~>" : "->"} ${b}${rnd() < 0.4 ? ' "calls"' : ""}\n`;
  }
  if (seed % 2) src += 'top = box "Entry"\n' + `top -> ${flat[0]}\n`;
  src += ids.map((id, i) => zone(`z${i}`, `Zone ${i}`, "vpc", id)).join("");
  src += view(`expand *\nlayout { rows ${seed % 2 ? "[top] " : ""}[${ids.join(" ")}] }`);
  const zs = ids.map((_, i) => `z${i}`);
  return { name: `random row of ${n} (${seed})`, src, asks: [row(...zs), level(...zs)] };
}

/** Lay the case out: what broke a hard rule, and which asks do not hold. */
export async function arranged(c: Case) {
  const built = buildProject([{ name: c.name, src: c.src }]);
  const errs = built.diagnostics.filter((d) => d.severity === "error");
  if (errs.length) throw new Error(`${c.name}: ${errs[0].message}`);
  const { positioned } = await layoutView(built.model, built.model.views.find((x) => x.name === "v")!);
  return {
    illegal: checkLayout(positioned, { zoneMembers: new Map(built.model.zones.map((z) => [z.id, z.members])) }),
    // `level` and `flush` are tidiness, and held to the same standard: a row
    // whose members start on different lines is not the row that was asked for
    missed: c.asks.filter((a) => !a.holds(positioned)).map((a) => a.say),
  };
}

describe("zones and expanded containers are arranged as asked", () => {
  for (const c of cases)
    it(c.name, async () => {
      const { illegal, missed } = await arranged(c);
      expect(illegal).toEqual([]);
      expect(missed).toEqual([]);
    });

  it("sixty random rows of two to four zones, wires anywhere between them", async () => {
    const bad: string[] = [];
    for (let seed = 0; seed < 60; seed++) {
      const c = randomRow(seed);
      const { illegal, missed } = await arranged(c);
      bad.push(...illegal.map((b) => `${c.name}: ${b}`), ...missed.map((m) => `${c.name}: not ${m}`));
    }
    expect(bad).toEqual([]);
  });
});
