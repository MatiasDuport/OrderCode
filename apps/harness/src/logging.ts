import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ToolResult } from "./types.js";

const MAX_INLINE_CHARS = 4_000;

export interface LogStore {
  write(label: string, content: string): Promise<string>;
  read(ref: string, start?: number, end?: number): Promise<string>;
}

export class FileLogStore implements LogStore {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async write(label: string, content: string): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "run";
    const digest = createHash("sha256").update(content).digest("hex").slice(0, 12);
    const ref = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeLabel}-${digest}-${randomUUID().slice(0, 8)}.log`;
    const path = join(this.directory, ref);
    await appendFile(path, content, "utf8");
    return path;
  }

  async read(ref: string, start = 0, end?: number): Promise<string> {
    const content = await readFile(ref, "utf8");
    return content.slice(Math.max(0, start), end === undefined ? undefined : Math.max(start, end));
  }
}

export function compactOutput(content: string | undefined, maxChars = MAX_INLINE_CHARS): string | undefined {
  if (!content) return content;
  if (content.length <= maxChars) return content;
  if (maxChars <= 0) return "";
  const marker = `\n… [${content.length - maxChars} chars omitted] …\n`;
  if (marker.length >= maxChars) return content.slice(0, maxChars);
  const available = maxChars - marker.length;
  const head = Math.floor(available * 0.68);
  return `${content.slice(0, head)}${marker}${content.slice(-Math.max(0, available - head))}`;
}

export async function optimizeToolResult(
  result: Omit<ToolResult, "summary" | "durationMs" | "logRef"> & { summary?: string; durationMs?: number },
  logStore: LogStore,
  rawOutput?: string,
): Promise<ToolResult> {
  const durationMs = result.durationMs ?? 0;
  const logRef = rawOutput ? await logStore.write(`${result.toolName}-${result.status}`, rawOutput) : undefined;
  const dataText = result.data === undefined ? "" : ` ${JSON.stringify(result.data).slice(0, 300)}`;
  const summary = result.summary ?? `${result.toolName} ${result.status}.${dataText}`.trim();
  return {
    ...result,
    durationMs,
    summary,
    ...(logRef ? { logRef } : {}),
    ...(result.diagnostics ? { diagnostics: compactOutput(result.diagnostics) } : {}),
  };
}
