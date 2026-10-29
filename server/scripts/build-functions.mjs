// Bundles the server into deploy/ as a standalone Cloud Functions source: one JS file, the knowledge
// base, and a package.json listing only what the Functions runtime installs itself.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { build } from "esbuild";

const OUT = "deploy";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const RUNTIME_DEPS = ["firebase-admin", "firebase-functions"];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);

await build({
  entryPoints: ["src/functions.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: `${OUT}/index.js`,
  external: RUNTIME_DEPS,
  // Some bundled CommonJS dependencies call require(); give ESM output one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

fs.cpSync("knowledge", `${OUT}/knowledge`, { recursive: true });
fs.writeFileSync(
  `${OUT}/package.json`,
  JSON.stringify(
    {
      name: "insuragent-functions",
      private: true,
      type: "module",
      main: "index.js",
      engines: { node: "22" },
      dependencies: Object.fromEntries(RUNTIME_DEPS.map((d) => [d, pkg.dependencies[d]])),
    },
    null,
    2,
  ),
);
// The Firebase CLI loads the code locally to discover the functions, so the runtime deps must be installed.
execSync("npm install --omit=dev --no-audit --no-fund --loglevel=error", { cwd: OUT, stdio: "inherit" });
console.log(`built ${OUT}/`);
