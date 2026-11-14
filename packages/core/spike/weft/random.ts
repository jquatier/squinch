// A seeded batch of diagrams nobody wrote: the half of the trial set that
// cannot have been tuned against.

/** A random diagram: a layered DAG with a few back edges, labels, and —
 *  for some — systems, a `rows` line, a rightward flow or a `wrap`. */
export function randomDiagram(seed: number): string {
  let s = seed * 7919 + 17;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (n: number) => Math.floor(rnd() * n);
  const n = 5 + pick(18);
  const grouped = seed % 3 === 0;
  const ids = Array.from({ length: n }, (_, i) => `n${i}`);
  const group = (i: number) => (grouped ? `g${Math.min(3, Math.floor((i * 4) / n))}` : undefined);
  const path = (i: number) => (group(i) ? `${group(i)}.${ids[i]}` : ids[i]);
  const edges: string[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < n; i++) {
    const fan = 1 + pick(2);
    for (let k = 0; k < fan; k++) {
      const from = pick(i);
      if (seen.has(`${from}>${i}`)) continue;
      seen.add(`${from}>${i}`);
      edges.push(`${path(from)} ${rnd() < 0.25 ? "~>" : "->"} ${path(i)}${rnd() < 0.3 ? ` "${["reads", "writes", "calls", "notifies", "syncs"][pick(5)]}"` : ""}`);
    }
  }
  for (let k = 0; k < Math.floor(n / 8); k++) {
    const a = 1 + pick(n - 1), b = pick(a);
    if (!seen.has(`${a}>${b}`)) { seen.add(`${a}>${b}`); edges.push(`${path(a)} -> ${path(b)} "retry"`); }
  }
  const decl = (i: number) => `${ids[i]} = box "Node ${i}"`;
  let src = "";
  if (grouped) {
    const groups = [...new Set(ids.map((_, i) => group(i)!))];
    for (const g of groups) src += `system ${g} "Group ${g.slice(1)}" {\n${ids.map((_, i) => i).filter((i) => group(i) === g).map((i) => `  ${decl(i)}`).join("\n")}\n}\n`;
  } else src += ids.map((_, i) => decl(i)).join("\n") + "\n";
  src += edges.join("\n") + "\n";
  const hint = seed % 5 === 1 ? "\n  layout { direction right }" : seed % 5 === 2 ? "\n  layout { wrap 4 }"
    : seed % 5 === 3 && !grouped && n >= 6 ? `\n  layout { rows [${ids.slice(0, 3).join(" ")}] [${ids.slice(3, 6).join(" ")}] }` : "";
  src += `view v { include *${grouped ? `\n  expand ${seed % 2 ? "*" : "g0, g1"}` : ""}${hint} }\n`;
  return src;
}
