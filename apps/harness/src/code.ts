import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Node } from "web-tree-sitter";
import type { Persistence } from "./persistence.js";
import type { CodeIndexedFile, CodeRelationship, CodeSymbol } from "./types.js";

export type { CodeRelationship, CodeSymbol } from "./types.js";

const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".rs"]);
const ignored = new Set([".git", "node_modules", "target", "dist", "build", ".turbo"]);
const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES = 100_000;
const MAX_RIPGREP_OUTPUT_BYTES = 2_000_000;
const RIPGREP_TIMEOUT_MS = 15_000;
const ripgrepGlobs = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.rs"];
type SupportedGrammar = "typescript" | "tsx" | "javascript" | "python" | "rust";
const parsers = new Map<SupportedGrammar, Parser>();
let treeSitterReady: Promise<void> | undefined;
const grammarFiles: Record<SupportedGrammar, string> = { typescript: "tree-sitter-typescript.wasm", tsx: "tree-sitter-tsx.wasm", javascript: "tree-sitter-javascript.wasm", python: "tree-sitter-python.wasm", rust: "tree-sitter-rust.wasm" };

interface CodeCandidate { file: string; path: string; size: number; mtimeMs: number }
export interface CodeGraphResult { query: string; files: number; symbols: number; relationships: CodeRelationship[]; truncated: boolean }
export interface CodeIntelligenceOptions { ripgrepCommand?: string | null; ripgrepTimeoutMs?: number }

export class CodeIntelligence {
  private readonly indexes = new Map<string, CodeIndexedFile[]>();
  private readonly invalidated = new Set<string>();

  private readonly ripgrepCommand: string | null;
  private readonly ripgrepTimeoutMs: number;

  constructor(private readonly persistence: Persistence, options: CodeIntelligenceOptions = {}) {
    this.ripgrepCommand = options.ripgrepCommand === undefined ? (process.platform === "win32" ? "rg.exe" : "rg") : options.ripgrepCommand;
    this.ripgrepTimeoutMs = Math.max(100, Math.min(options.ripgrepTimeoutMs ?? RIPGREP_TIMEOUT_MS, 60_000));
  }

  invalidate(projectPath: string): void {
    const root = resolve(projectPath);
    this.indexes.delete(root);
    this.invalidated.add(root);
  }

  async index(projectPath: string): Promise<{ projectPath: string; files: number; symbols: number; updatedFiles: number }> {
    const root = resolve(projectPath);
    const candidates = await this.collect(root);
    if (candidates.length > MAX_FILES) throw new Error(`The project contains more than ${MAX_FILES} supported source files; narrow the workspace before indexing.`);
    const previous = new Map(this.persistence.listCodeIndexFiles(root).map((file) => [file.path, file]));
    const forceRefresh = this.invalidated.delete(root);
    const indexed: CodeIndexedFile[] = [];
    let updatedFiles = 0;

    for (const candidate of candidates) {
      const current = previous.get(candidate.path);
      if (!forceRefresh && current && current.size === candidate.size && current.mtimeMs === candidate.mtimeMs) {
        indexed.push(current);
        previous.delete(candidate.path);
        continue;
      }
      if (candidate.size > MAX_FILE_BYTES) {
        this.persistence.deleteCodeIndexFiles(root, [candidate.path]);
        previous.delete(candidate.path);
        continue;
      }
      const content = await readFile(candidate.file, "utf8").catch(() => undefined);
      if (content === undefined) {
        this.persistence.deleteCodeIndexFiles(root, [candidate.path]);
        previous.delete(candidate.path);
        continue;
      }
      const hash = createHash("sha256").update(content).digest("hex");
      const parsed = current?.hash === hash ? current : await parseSource(candidate.path, content);
      const record: CodeIndexedFile = { path: candidate.path, hash, size: candidate.size, mtimeMs: candidate.mtimeMs, symbols: parsed.symbols, relationships: parsed.relationships };
      this.persistence.upsertCodeIndexFile(root, record, content);
      indexed.push(record);
      previous.delete(candidate.path);
      updatedFiles += 1;
    }

    this.persistence.deleteCodeIndexFiles(root, [...previous.keys()]);
    this.indexes.set(root, indexed);
    return { projectPath: root, files: indexed.length, symbols: indexed.reduce((total, file) => total + file.symbols.length, 0), updatedFiles };
  }

  async search(projectPath: string, query: string): Promise<CodeSymbol[]> {
    const root = resolve(projectPath);
    await this.index(root);
    const normalizedQuery = query.trim().slice(0, 256);
    const needle = normalizedQuery.toLowerCase();
    const symbols = (this.indexes.get(root) ?? []).flatMap((file) => file.symbols);
    if (!needle) return symbols.slice(0, 100);

    const symbolMatches = symbols.filter((symbol) => `${symbol.name} ${symbol.path}`.toLowerCase().includes(needle)).slice(0, 100);
    const symbolLocations = new Set(symbolMatches.map((symbol) => `${symbol.path}:${symbol.line}`));
    const ripgrepMatches = this.ripgrepCommand ? await searchWithRipgrep(root, normalizedQuery, 100, this.ripgrepCommand, this.ripgrepTimeoutMs) : undefined;
    const textMatches = (ripgrepMatches ?? this.persistence.searchCodeText(root, normalizedQuery, 100).map((match) => ({ ...match, source: "fts5" as const })))
      .filter((match) => !symbolLocations.has(`${match.path}:${match.line}`))
      .map((match) => ({ name: match.excerpt.trim().slice(0, 100) || query.trim(), kind: "text" as const, path: match.path, line: match.line, excerpt: match.excerpt, source: match.source }));
    return [...symbolMatches, ...textMatches].slice(0, 100);
  }

  async graph(projectPath: string, query: string): Promise<CodeGraphResult> {
    const root = resolve(projectPath);
    await this.index(root);
    const files = this.indexes.get(root) ?? [];
    const queryText = query.trim().replaceAll("\\", "/").slice(0, 256);
    const needle = queryText.toLowerCase();
    const symbols = files.flatMap((file) => file.symbols);
    const symbolFiles = new Map<string, string[]>();
    for (const symbol of symbols) symbolFiles.set(symbol.name, [...(symbolFiles.get(symbol.name) ?? []), symbol.path]);
    const filePaths = new Set(files.map((file) => file.path));
    const all = files.flatMap((file) => file.relationships.filter((relationship) => relationship.kind === "IMPORTS" || symbolFiles.has(relationship.targetName)).map((relationship) => ({
      ...relationship,
      ...(relationship.kind === "IMPORTS" ? { targetPath: resolveImportPath(relationship, filePaths) } : {}),
      ...(!relationship.targetPath && relationship.kind !== "IMPORTS" && symbolFiles.get(relationship.targetName)?.length === 1 ? { targetPath: symbolFiles.get(relationship.targetName)![0] } : {}),
    })));
    const direct = new Set<string>();
    if (needle) {
      const matchingNames = new Set(symbols.filter((symbol) => symbol.name.toLowerCase().includes(needle)).map((symbol) => symbol.name));
      const isPathQuery = queryText.includes("/") || /\.[a-z0-9]+$/i.test(queryText);
      const matchingPaths = isPathQuery ? new Set([...filePaths].filter((path) => path.toLowerCase().includes(needle))) : new Set<string>();
      const matchingSymbolPaths = new Set(symbols.filter((symbol) => matchingNames.has(symbol.name)).map((symbol) => symbol.path));
      for (const edge of all) {
        const matchesPath = matchingPaths.has(edge.sourcePath) || (edge.targetPath !== undefined && matchingPaths.has(edge.targetPath));
        const matchesSymbol = (edge.sourceName !== undefined && matchingNames.has(edge.sourceName))
          || matchingNames.has(edge.targetName)
          || (edge.targetPath !== undefined && matchingSymbolPaths.has(edge.targetPath));
        if (matchesPath || matchesSymbol || [edge.sourceName, edge.targetName].some((value) => value?.toLowerCase().includes(needle))) direct.add(edgeKey(edge));
      }
    }
    const relationships = (needle ? all.filter((edge) => direct.has(edgeKey(edge))) : all).slice(0, 250);
    return { query: queryText, files: files.length, symbols: symbols.length, relationships, truncated: relationships.length < (needle ? direct.size : all.length) };
  }

  private async collect(root: string, directory = root, depth = 0): Promise<CodeCandidate[]> {
    if (depth > 10) return [];
    const output: CodeCandidate[] = [];
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) output.push(...await this.collect(root, file, depth + 1));
      else if (entry.isFile() && extensions.has(extname(entry.name))) {
        const metadata = await stat(file).catch(() => undefined);
        if (metadata?.isFile()) output.push({ file, path: relative(root, file).replaceAll("\\", "/"), size: metadata.size, mtimeMs: metadata.mtimeMs });
      }
    }
    return output;
  }
}

type RipgrepMatch = { path: string; line: number; excerpt: string; source: "ripgrep" };

function searchWithRipgrep(root: string, query: string, limit: number, command: string, timeoutMs: number): Promise<RipgrepMatch[] | undefined> {
  const args = ["--json", "--fixed-strings", "--ignore-case", "--line-number", "--hidden", "--maxdepth", "10", "--max-filesize", String(MAX_FILE_BYTES), "--max-columns", "4096", "--max-columns-preview"];
  for (const glob of ripgrepGlobs) args.push("--glob", glob);
  for (const name of ignored) args.push("--glob", `!**/${name}/**`);
  args.push("--", query, ".");

  return new Promise((resolveSearch) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { resolveSearch(undefined); return; }

    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let spawnFailed = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);

    child.once("error", () => { spawnFailed = true; });
    child.stdout?.on("data", (value: Buffer | string) => {
      if (outputTruncated) return;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const remaining = MAX_RIPGREP_OUTPUT_BYTES - outputBytes;
      if (chunk.length > remaining) {
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        outputBytes = MAX_RIPGREP_OUTPUT_BYTES;
        outputTruncated = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
      outputBytes += chunk.length;
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      if (spawnFailed || timedOut || (!outputTruncated && exitCode !== 0 && exitCode !== 1)) { resolveSearch(undefined); return; }
      const output = Buffer.concat(chunks).toString("utf8");
      const matches: RipgrepMatch[] = [];
      for (const line of output.split(/\r?\n/)) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as { type?: string; data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number } };
          if (event.type !== "match" || typeof event.data?.path?.text !== "string" || typeof event.data.line_number !== "number") continue;
          const path = event.data.path.text.replaceAll("\\", "/").replace(/^\.\//, "");
          const excerpt = (event.data.lines?.text ?? "").replace(/\r?\n$/, "");
          matches.push({ path, line: event.data.line_number, excerpt: excerpt.slice(0, 240), source: "ripgrep" });
          if (matches.length >= limit) break;
        } catch { /* Ignore a partial JSON line when the output cap is reached. */ }
      }
      resolveSearch(matches);
    });
  });
}

async function parseSource(path: string, content: string): Promise<{ symbols: CodeSymbol[]; relationships: CodeRelationship[] }> {
  const grammar = grammarFor(path);
  if (!grammar) return { symbols: [], relationships: [] };
  const parser = await getParser(grammar);
  const tree = parser.parse(content);
  if (!tree) return { symbols: [], relationships: [] };
  const symbols: CodeSymbol[] = [];
  const relationships: CodeRelationship[] = [];
  const identifiers: Node[] = [];
  const lines = content.split(/\r?\n/);
  const visit = (node: Node): void => {
    const kind = symbolKind(node.type);
    const nameNode = node.childForFieldName("name") ?? (node.type === "variable_declarator" ? node.childForFieldName("name") : null);
    if (kind && nameNode?.text) {
      const line = nameNode.startPosition.row + 1;
      symbols.push({ name: nameNode.text, kind, path, line, excerpt: (lines[line - 1] ?? "").trim().slice(0, 240) });
    }
    if (["identifier", "type_identifier", "shorthand_property_identifier"].includes(node.type)) identifiers.push(node);
    const importPath = importTarget(node);
    if (importPath) relationships.push({ kind: "IMPORTS", sourcePath: path, sourceName: enclosingName(node), targetName: importPath.value, line: node.startPosition.row + 1, confidence: "confirmed" });
    for (const child of node.namedChildren) visit(child);
  };
  visit(tree.rootNode);

  const declarationNodes = new Set<Node>();
  for (const symbol of symbols) {
    const occurrence = identifiers.find((node) => node.text === symbol.name && node.startPosition.row + 1 === symbol.line);
    if (occurrence) declarationNodes.add(occurrence);
  }
  for (const node of identifiers) {
    if (isWithin(node, ["import_statement", "import_from_statement", "use_declaration"]) || declarationNodes.has(node)) continue;
    const parent = node.parent;
    const call = parent?.type === "call_expression" || parent?.type === "call" || parent?.type === "member_expression" && parent.parent?.type === "call_expression";
    relationships.push({ kind: call ? "CALLS" : "REFERENCES", sourcePath: path, ...(enclosingName(node) ? { sourceName: enclosingName(node) } : {}), targetName: node.text, line: node.startPosition.row + 1, confidence: "inferred" });
  }
  tree.delete();
  return { symbols: dedupeSymbols(symbols), relationships: dedupeRelationships(relationships) };
}

function grammarFor(path: string): SupportedGrammar | undefined {
  switch (extname(path).toLowerCase()) {
    case ".ts": return "typescript";
    case ".tsx": return "tsx";
    case ".js": case ".jsx": return "javascript";
    case ".py": return "python";
    case ".rs": return "rust";
    default: return undefined;
  }
}

async function getParser(grammar: SupportedGrammar): Promise<Parser> {
  if (!treeSitterReady) treeSitterReady = Parser.init({ locateFile: () => fileURLToPath(new URL("./wasm/web-tree-sitter.wasm", import.meta.url)) });
  await treeSitterReady;
  const cached = parsers.get(grammar);
  if (cached) return cached;
  const parser = new Parser();
  parser.setLanguage(await Language.load(new URL(`./wasm/${grammarFiles[grammar]}`, import.meta.url)));
  parsers.set(grammar, parser);
  return parser;
}

function symbolKind(type: string): CodeSymbol["kind"] | undefined {
  if (["function_declaration", "function_definition", "function_item", "method_definition", "method_declaration"].includes(type)) return "function";
  if (["class_declaration", "class_definition", "class_item", "struct_item", "struct_declaration"].includes(type)) return "class";
  if (["type_alias_declaration", "interface_declaration", "enum_declaration", "enum_item", "trait_item", "type_item"].includes(type)) return "type";
  if (type === "variable_declarator") return "variable";
  return undefined;
}

function importTarget(node: Node): { value: string } | undefined {
  if (node.type === "import_statement" || node.type === "export_statement") {
    const source = node.childForFieldName("source")?.text;
    if (source) return { value: unquote(source) };
  }
  if (node.type === "import_from_statement") {
    const source = node.childForFieldName("module_name")?.text;
    if (source) return { value: source };
  }
  if (node.type === "import_statement") {
    const text = node.text.replace(/^\s*import\s+/, "").replace(/\s+as\s+.*/, "").replace(/;\s*$/, "").trim();
    if (text) return { value: text };
  }
  if (node.type === "use_declaration") {
    const source = node.childForFieldName("argument")?.text ?? node.text.replace(/^\s*use\s+/, "").replace(/;\s*$/, "").trim();
    if (source) return { value: source };
  }
  return undefined;
}

function unquote(value: string): string { return value.length >= 2 ? value.slice(1, -1) : value; }

function enclosingName(node: Node): string | undefined {
  let parent = node.parent;
  while (parent) {
    if (["function_declaration", "function_definition", "function_item", "method_definition", "method_declaration", "class_declaration", "class_definition"].includes(parent.type)) return parent.childForFieldName("name")?.text;
    parent = parent.parent;
  }
  return undefined;
}

function isWithin(node: Node, types: string[]): boolean {
  let parent: Node | null = node;
  while (parent) {
    if (types.includes(parent.type)) return true;
    parent = parent.parent;
  }
  return false;
}

function resolveImportPath(relationship: CodeRelationship, filePaths: Set<string>): string | undefined {
  const source = relationship.sourcePath;
  const target = relationship.targetName;
  const sourceExt = extname(source).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx"].includes(sourceExt) && target.startsWith(".")) {
    const base = posix.resolve("/", source, "..");
    const joined = posix.resolve(base, target).replace(/^\//, "");
    const candidates = [joined, ...[".ts", ".tsx", ".js", ".jsx"].map((extension) => `${joined}${extension}`), ...[".ts", ".tsx", ".js", ".jsx"].map((extension) => `${joined}/index${extension}`)];
    return candidates.find((candidate) => filePaths.has(candidate));
  }
  if (sourceExt === ".py") {
    const module = target.replace(/^\.+/, "").replaceAll(".", "/");
    const sourceDirectory = source.split("/").slice(0, -1).join("/");
    const candidates = [module, `${module}.py`, `${module}/__init__.py`, `${sourceDirectory}/${module}.py`, `${sourceDirectory}/${module}/__init__.py`];
    return candidates.find((candidate) => filePaths.has(candidate));
  }
  if (sourceExt === ".rs") {
    const final = target.split(/::|\./).filter((part) => part && !["crate", "self", "super", "as"].includes(part)).at(-1);
    if (!final) return undefined;
    const candidates = [...filePaths].filter((candidate) => candidate.endsWith(`/${final}.rs`) || candidate === `${final}.rs` || candidate.endsWith(`/${final}/mod.rs`));
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  return undefined;
}

function dedupeSymbols(symbols: CodeSymbol[]): CodeSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => { const key = `${symbol.path}:${symbol.line}:${symbol.name}:${symbol.kind}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function dedupeRelationships(relationships: CodeRelationship[]): CodeRelationship[] {
  const seen = new Set<string>();
  return relationships.filter((edge) => { const key = edgeKey(edge); if (seen.has(key)) return false; seen.add(key); return true; });
}

function edgeKey(edge: CodeRelationship): string { return `${edge.kind}:${edge.sourcePath}:${edge.sourceName ?? ""}:${edge.targetPath ?? ""}:${edge.targetName}:${edge.line}`; }
