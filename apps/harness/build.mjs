import { copyFile, cp, mkdir, readFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const grammarFiles = [
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
  "tree-sitter-javascript.wasm",
  "tree-sitter-python.wasm",
  "tree-sitter-rust.wasm",
];
const output = resolve("dist");
const wasmOutput = resolve(output, "wasm");
const grammarDirectory = resolve(dirname(require.resolve("@2h2d/tree-sitter-wasms")), "..", "wasm");

await build({
  entryPoints: ["src/index.ts"],
  outfile: resolve(output, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external: ["node:*"],
  banner: { js: 'import { createRequire as __ordercodeCreateRequire } from "node:module"; const require = __ordercodeCreateRequire(import.meta.url);' },
});

await mkdir(wasmOutput, { recursive: true });
await copyFile(require.resolve("web-tree-sitter/web-tree-sitter.wasm"), resolve(wasmOutput, "web-tree-sitter.wasm"));
await Promise.all(grammarFiles.map((file) => copyFile(resolve(grammarDirectory, file), resolve(wasmOutput, file))));

// Ship npm with its dependencies and license; packaged apps never depend on system npx.
const nodeDirectory = dirname(process.execPath);
const npmCandidates = [resolve(nodeDirectory, "node_modules/npm"), resolve(nodeDirectory, "../lib/node_modules/npm"), resolve(nodeDirectory, "../node_modules/npm")];
let npmDirectory;
for (const candidate of npmCandidates) {
  try {
    const metadata = JSON.parse(await readFile(resolve(candidate, "package.json"), "utf8"));
    if (metadata.name !== "npm") continue;
    await access(resolve(candidate, "bin/npx-cli.js"));
    await access(resolve(candidate, "LICENSE"));
    npmDirectory = candidate;
    break;
  } catch { /* Try the next supported Node distribution layout. */ }
}
if (!npmDirectory) throw new Error("A complete npm distribution beside Node.js is required to package the internal MCP installer.");
await cp(npmDirectory, resolve(output, "npm"), { recursive: true, dereference: true, force: true });
