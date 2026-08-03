// The generated Lezer parser is JavaScript, so tsc leaves it behind — it has to
// be copied into dist/ by hand. This was `mkdir -p … && cp …`, which npm runs
// through cmd.exe on Windows, where neither command exists: `pnpm -r build`
// died at core, and core is first in dependency order, so nothing built at all.
//
// Plain .mjs rather than tsx: this runs during the build that produces what tsx
// would need.
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(pkg, "dist", "grammar");
mkdirSync(out, { recursive: true });
for (const f of ["parser.js", "parser.terms.js"])
  copyFileSync(join(pkg, "src", "grammar", f), join(out, f));
