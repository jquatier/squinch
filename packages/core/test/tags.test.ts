// Tag-based include/exclude (SPEC §5): targets expand to every element whose
// EFFECTIVE tags match — inherited tags count; exclude still wins last.
import { describe, it, expect } from "vitest";
import { buildModel, render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";

const SRC = `pack aws
system pay "Payments" {
  api    = aws/lambda "API" { tags: #pci }
  vault  = aws/dynamodb "Vault" datastore { tags: #pci }
  worker = aws/lambda "Worker"
  legacy = box "Old Gateway" external { tags: #deprecated }
  api -> vault
  api -> worker
  api -> legacy
}
system ops "Ops" {
  tags: #deprecated
  dash = aws/lambda "Dashboard"
}
pay.api -> ops.dash "metrics"
`;

describe("tag-based include/exclude", () => {
  it("exclude #tag removes matching elements (and inherited subtrees)", async () => {
    const src = SRC + `view v { scope pay\n exclude #deprecated\n context off }\n`;
    const r = await render(src, { view: "v", theme: "light" });
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    expect(r.svg).not.toContain("Old Gateway");
    expect(r.svg).not.toContain("Dashboard"); // inherited from ops's #deprecated
    expect(r.svg).toContain("Vault");
  });

  it("include #tag pulls tagged elements into a scoped view", async () => {
    const src = SRC + `view v { scope ops\n include #pci }\n`;
    const r = await render(src, { view: "v", theme: "light" });
    expect(r.ok).toBe(true);
    // pci-tagged nodes from the other system materialize
    expect(r.svg).toContain("Vault");
    expect(r.svg).toContain(">API<");
  });

  it("a tag matching nothing warns instead of silently no-oping", async () => {
    const r = await render(SRC + `view v { scope pay\n exclude #nonexistent }\n`, { view: "v" });
    expect(r.ok).toBe(true);
    expect(r.diagnostics.some((d) => d.message.includes("nothing is tagged #nonexistent"))).toBe(true);
  });
});
