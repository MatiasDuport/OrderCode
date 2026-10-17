import { copyFile, mkdir } from "node:fs/promises";
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
