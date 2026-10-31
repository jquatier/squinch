// `link:` makes a leaf's title a hyperlink. The load-bearing rules: an author's
// string reaches an `href`, so only http(s) may pass; and a render with no link
// is the render it always was.
import { describe, it, expect } from "vitest";
import { buildModel, diffModels, exportHTML, render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";

const URL_OK = "https://runbooks.example.com/orders?a=1&b=2#top";
const leaf = (attrs: string) => `system s "S" {\n a = sys/server "API" ${attrs}\n b = sys/database "DB"\n a -> b\n}\nview v { scope s }\n`;
const linked = leaf(`{ link: "${URL_OK}" }`);

describe("link: the model", () => {
  it("is the node's own field, not a bag entry", () => {
    const r = buildModel(linked);
    expect(r.diagnostics).toEqual([]);
    expect(r.model.nodes.get("s.a")!.link).toBe(URL_OK);
    expect(r.model.nodes.get("s.a")!.attrs).toEqual({});
  });

  it.each([
    "http://example.com",
    "HTTPS://Example.COM/Path",
    "https://example.com:8443/a",
    "https://medium.com/@someone/post",
    "https://example.com?q=a@b",
  ])("accepts %s", (url) => {
    const r = buildModel(leaf(`{ link: "${url}" }`));
    expect(r.diagnostics).toEqual([]);
    expect(r.model.nodes.get("s.a")!.link).toBe(url);
  });

  it.each([
    ["script", "javascript:alert(1)"],
    ["script, mixed case", "JaVaScRiPt:alert(1)"],
    ["script, an embedded tab", "java\tscript:alert(1)"],
    ["script, a leading space", " javascript:alert(1)"],
    ["data", "data:text/html,hi"],
    ["mailto", "mailto:someone@example.com"],
    ["relative", "/runbooks/orders"],
    ["no scheme", "example.com"],
    ["no host", "https://"],
    ["userinfo", "https://good.example@evil.example/"],
    ["a backslash", "https:\\\\evil.example"],
    ["a space", "https://example.com/a b"],
    ["not ASCII", "https://bücher.example"],
  ])("refuses %s, and it never reaches the node", (_name, url) => {
    const r = buildModel(leaf(`{ link: "${url}" }`));
    const e = r.diagnostics.find((d) => d.severity === "error")!;
    expect(e.message).toContain("`link` must be an http or https URL");
    expect(e.fix).toContain("https://example.com/runbook");
    expect(r.model.nodes.get("s.a")!.link).toBeUndefined();
  });

  it("a bare word is refused rather than read as a path", () => {
    const r = buildModel(leaf(`{ link: runbook }`));
    expect(r.diagnostics.find((d) => d.severity === "error")?.message).toContain("`link` must be");
  });

  it("an unquoted URL says to quote it: `//` starts a comment, so it cannot parse", () => {
    const r = buildModel(leaf(`{ link: https://example.com/x }`));
    expect(r.ok).toBe(false);
    expect(r.diagnostics.find((d) => d.message.includes("`link` must be"))?.fix).toContain("in quotes");
  });

  it.each(["url", "href", "hyperlink"])("`%s:` points at link:", (key) => {
    const w = buildModel(leaf(`{ ${key}: "${URL_OK}" }`)).diagnostics[0];
    expect(w.severity).toBe("warning");
    expect(w.fix).toBe("did you mean `link`?");
  });

  it("a container warns and says why, rather than doing nothing", () => {
    const r = buildModel(`system s "S" {\n link: "${URL_OK}"\n a = sys/server "API"\n}`);
    expect(r.ok).toBe(true);
    expect(r.diagnostics.map((d) => d.message)).toEqual(["`link` is a leaf attribute"]);
    expect(r.diagnostics[0].fix).toContain("zooms");
  });

  it("a changed link is a cosmetic difference", () => {
    const d = diffModels(buildModel(leaf("")).model, buildModel(linked).model);
    expect(d.changes.map((c) => [c.detail, c.weight])).toEqual([["s.a link", "cosmetic"]]);
  });
});

describe("link: the render", () => {
  const svg = async (src: string, view = "v", opts = {}) => {
    const r = await render(src, { theme: "light", view, ...opts });
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    return r.svg!;
  };
  const ANCHOR = `<a class="sq-link" href="https://runbooks.example.com/orders?a=1&amp;b=2#top" target="_blank" rel="noopener noreferrer">`;

  it("wraps the title alone, and stays valid XML with an & in the URL", async () => {
    const out = await svg(linked);
    expect(out).toContain(`${ANCHOR}<rect `);
    expect(out).toMatch(/fill="none" pointer-events="all"\/><text [^>]*>API<\/text><\/a>/);
    expect(out.match(/<a /g)).toHaveLength(1);
    // the surface is still the group's first rect: the dive and the tests read it
    expect(out).toMatch(/<g data-path="s\.a"[^>]*>\s*<rect [^>]*filter=/);
  });

  it("carries its hover once, and only when there is a link", async () => {
    const out = await svg(leaf(`{ link: "${URL_OK}" }`).replace(`b = sys/database "DB"`, `b = sys/database "DB" { link: "${URL_OK}" }`));
    expect(out.match(/\.sq-link\{cursor:pointer\}/g)).toHaveLength(1);
    expect(out.match(/<a /g)).toHaveLength(2);
    const plain = await svg(leaf(""));
    expect(plain).not.toContain("sq-link");
    expect(plain).not.toContain("<a ");
  });

  it("removing a link puts back exactly the render without one", async () => {
    const out = await svg(linked);
    const stripped = out
      .replace(/<defs><style>\.sq-link[^]*?<\/style><\/defs>\n/, "")
      .replace(/<a [^>]*><rect [^>]*\/>/, "")
      .replace("</a>", "");
    expect(stripped).toBe(await svg(leaf("")));
  });

  it("a person's name links too", async () => {
    const out = await svg(`person p "On call" { link: "${URL_OK}" }\nsystem s "S" {\n a = sys/server "API"\n}\np -> s.a\nview v { include *; expand s }`);
    expect(out).toMatch(/<a [^>]*>.*>On call<\/text><\/a>/);
  });

  it("a card's preview row is not a link, because the card's click zooms", async () => {
    const out = await svg(`${linked}view top { include *; preview s }`, "top");
    expect(out).toContain("API");
    expect(out).not.toContain("<a ");
  });

  it("an adaptive render keeps the link", async () => {
    const out = await svg(linked, "v", { adaptive: true });
    expect(out).toContain(ANCHOR);
  });

  it("a refused link draws nothing, whatever a host does with the error", async () => {
    const r = await render(leaf(`{ link: "javascript:alert(1)" }`), { theme: "light", view: "v" });
    expect(r.ok).toBe(false);
    expect(r.svg ?? "").not.toContain("javascript");
  });
});

describe("link: the interactive export", () => {
  it("an external href is only ever an <a>'s, and the hover is shared", async () => {
    const { html, ok } = await exportHTML([{ name: "d.squinch", src: linked }]);
    expect(ok).toBe(true);
    const external = [...html!.matchAll(/<(\w+)\b[^<>]*\b(?:href|src)="(?!#|data:)[^"]*"/g)].map((m) => m[1]);
    expect(external.length).toBeGreaterThan(0);
    expect(new Set(external)).toEqual(new Set(["a"]));
    expect(html).not.toContain("<link");
    expect(html!.match(/\.sq-link\{cursor:pointer\}/g)).toHaveLength(1);
  });
});
