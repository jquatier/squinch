// Bundles the extension host and the language server into CommonJS, the only
// module format the VS Code extension host loads. @squinch/core is bundled in;
// the AWS pack is copied beside the output so its disk loader still finds it.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(join(root, "dist"), { recursive: true });

for (const entry of ["extension", "server"]) {
  await build({
    entryPoints: [join(root, "src", `${entry}.ts`)],
    outfile: join(root, "dist", `${entry}.cjs`),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: true,
    external: ["vscode"], // provided by the host
    // core resolves disk packs via import.meta.url, which CJS lacks
    define: { "import.meta.url": "__squinchModuleUrl" },
    banner: { js: "const __squinchModuleUrl = require('url').pathToFileURL(__filename).href;" },
    logLevel: "warning",
  });
}

// the pack ships beside the bundle: node-fs walks up from the module dir
const pack = join(root, "..", "pack-aws");
cpSync(join(pack, "pack.json"), join(root, "pack-aws", "pack.json"), { recursive: false, force: true });
cpSync(join(pack, "icons"), join(root, "pack-aws", "icons"), { recursive: true, force: true });
console.log("bundled dist/extension.cjs + dist/server.cjs (+ pack-aws)");
