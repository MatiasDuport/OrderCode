import { HarnessError } from "./errors.js";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";

const HOOK_PATH = /^\/v1\/integrations\/deploy\/[A-Za-z0-9_-]{8,80}\/[A-Za-z0-9_-]{8,120}$/;
const MAX_RESPONSE_BYTES = 64_000;

export interface DeploymentJob {
  provider: "vercel";
  jobId: string;
  state: string;
  createdAt?: number;
}

export class ReleaseCenter {
  private readonly deployHookUrls = new Map<string, string>();

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  configureDeployHook(projectPath: string, value: unknown): { configured: boolean } {
    const projectKey = keyForProject(projectPath);
    if (value === null || value === undefined || value === "") {
      this.deployHookUrls.delete(projectKey);
      return { configured: false };
    }
    if (typeof value !== "string" || value.length > 2_000 || /[\u0000-\u0020\u007f]/.test(value)) throw new HarnessError("INVALID_RELEASE_HOOK", "The Vercel Deploy Hook URL is invalid.");
    let url: URL;
    try { url = new URL(value); } catch { throw new HarnessError("INVALID_RELEASE_HOOK", "The Vercel Deploy Hook URL is invalid."); }
    if (url.protocol !== "https:" || url.hostname !== "api.vercel.com" || url.port || url.username || url.password || url.search || url.hash || !HOOK_PATH.test(url.pathname)) {
      throw new HarnessError("INVALID_RELEASE_HOOK", "Only a Vercel HTTPS Deploy Hook URL can be stored.");
    }
    this.deployHookUrls.set(projectKey, url.toString());
    return { configured: true };
  }

  deployHookConfigured(projectPath: string): boolean { return this.deployHookUrls.has(keyForProject(projectPath)); }

  async triggerDeploy(projectPath: string, signal?: AbortSignal): Promise<DeploymentJob> {
    const url = this.deployHookUrls.get(keyForProject(projectPath));
    if (!url) throw new HarnessError("RELEASE_HOOK_NOT_CONFIGURED", "Configure a Vercel Deploy Hook in Release Center before deploying.");
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Deploy hook timed out.")), 20_000);
    try {
      const response = await this.fetcher(url, { method: "POST", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) throw new HarnessError("RELEASE_DEPLOY_FAILED", `Vercel rejected the deploy hook (HTTP ${response.status}).`);
      const body = await readBoundedBody(response, MAX_RESPONSE_BYTES);
      let payload: unknown;
      try { payload = JSON.parse(body.toString("utf8")) as unknown; }
      catch { throw new HarnessError("RELEASE_INVALID_RESPONSE", "Vercel returned an invalid deploy job response."); }
      const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const job = root.job && typeof root.job === "object" ? root.job as Record<string, unknown> : {};
      if (typeof job.id !== "string" || !/^[A-Za-z0-9_-]{4,128}$/.test(job.id) || typeof job.state !== "string" || !/^[A-Z_]{3,32}$/.test(job.state)) {
        throw new HarnessError("RELEASE_INVALID_RESPONSE", "Vercel did not confirm a deployment job.");
      }
      return { provider: "vercel", jobId: job.id, state: job.state, ...(typeof job.createdAt === "number" && Number.isFinite(job.createdAt) ? { createdAt: job.createdAt } : {}) };
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      if (controller.signal.aborted) throw new HarnessError("RELEASE_DEPLOY_CANCELLED", "The Vercel deploy request was cancelled or timed out.");
      throw new HarnessError("RELEASE_DEPLOY_FAILED", "Could not contact Vercel or complete the deploy request. Check the connection and try again.");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function keyForProject(projectPath: string): string {
  if (typeof projectPath !== "string" || !projectPath.trim() || projectPath.length > 32_000 || projectPath.includes("\0")) throw new HarnessError("INVALID_PROJECT_PATH", "A valid workspace path is required for Release Center.");
  let normalized = resolve(projectPath);
  try { normalized = realpathSync.native(normalized); } catch { /* Keep the resolved path for workspaces that are temporarily unavailable. */ }
  normalized = normalized.replace(/[\\/]+$/, "") || resolve(projectPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function readBoundedBody(response: Response, limit: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new HarnessError("RELEASE_RESPONSE_TOO_LARGE", "Vercel returned an unexpectedly large deploy response.");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new HarnessError("RELEASE_RESPONSE_TOO_LARGE", "Vercel returned an unexpectedly large deploy response.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
