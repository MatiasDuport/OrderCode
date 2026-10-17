import { realpathSync, existsSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { HarnessError } from "./errors.js";
import type { PermissionDecision, PermissionProfile, PermissionRequest, PermissionRule, RunMode, ToolEffect } from "./types.js";
import type { Persistence } from "./persistence.js";

export interface PermissionCheckInput {
  sessionId: string;
  projectPath: string;
  agentId: string;
  toolName: string;
  action: string;
  effect: ToolEffect;
  path?: string;
  destination?: string;
  resource?: string;
  arguments?: Record<string, unknown>;
  runId?: string;
  mode?: RunMode;
  reason?: string;
}

export type PermissionCheck =
  | { kind: "allow"; source: "profile" | "rule" | "once"; request: PermissionRequest }
  | { kind: "reject"; request: PermissionRequest; reason: string }
  | { kind: "approval"; request: PermissionRequest };

function normalizePath(value: string, base = process.cwd()): string {
  const normalized = resolve(isAbsolute(value) ? value : resolve(base, value));
  let ancestor = normalized;
  const missing: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return normalized;
    missing.unshift(basename(ancestor));
    ancestor = parent;
  }
  try { return resolve(realpathSync.native(ancestor), ...missing); } catch { return normalized; }
}

function pathWithin(path: string, root: string): boolean {
  const child = normalizePath(path);
  const parent = normalizePath(root);
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function expired(rule: PermissionRule): boolean {
  return !!rule.expiresAt && Date.parse(rule.expiresAt) <= Date.now();
}

export class PermissionEngine {
  private readonly once = new Map<string, PermissionDecision>();
  private readonly session = new Map<string, PermissionDecision>();
  private readonly pending = new Map<string, PermissionRequest>();

  constructor(private readonly persistence: Persistence) {
    for (const request of persistence.listPendingPermissionRequests()) this.pending.set(request.id, request);
  }

  check(profile: PermissionProfile, input: PermissionCheckInput): PermissionCheck {
    const request = this.makeRequest(input);
    const path = input.path ? normalizePath(input.path, input.projectPath) : undefined;
    const projectPath = normalizePath(input.projectPath);
    if (input.mode === "plan" && input.effect !== "READ") return { kind: "reject", request, reason: "Plan mode is read-only. Switch to Build before making changes." };
    if (profile === "reading" && input.effect !== "READ") return { kind: "reject", request, reason: "The reading profile permits read-only tools." };
    if (path && !pathWithin(path, projectPath) && !this.matchesExternalRule(input, path)) {
      return { kind: "reject", request, reason: "The requested path is outside the active project scope." };
    }

    const onceDecision = this.once.get(this.key(input));
    if (onceDecision === "once") {
      this.once.delete(this.key(input));
      return { kind: "allow", source: "once", request };
    }
    if (this.session.has(this.key(input))) return { kind: "allow", source: "once", request };

    const rule = this.findRule(input, path);
    if (rule) {
      if (rule.decision === "reject") return { kind: "reject", request, reason: "A matching permission rule rejects this action." };
      return { kind: "allow", source: "rule", request };
    }

    if (input.effect === "READ") return { kind: "allow", source: "profile", request };
    if (profile === "auto" && !["EXECUTE", "NETWORK", "PUBLISH", "DESTRUCTIVE", "GIT_WRITE"].includes(input.effect)) return { kind: "allow", source: "profile", request };
    if (profile === "advanced" && !["PUBLISH", "DESTRUCTIVE"].includes(input.effect)) return { kind: "allow", source: "profile", request };

    this.pending.set(request.id, request);
    this.persistence.addPermissionRequest(request);
    return { kind: "approval", request };
  }

  resolve(requestId: string, decision: PermissionDecision, rule?: Omit<PermissionRule, "id" | "decision">): PermissionRequest {
    if (!["reject", "once", "session", "project"].includes(decision)) throw new HarnessError("INVALID_PERMISSION_DECISION", "Permission decision is not supported.");
    const request = this.pending.get(requestId);
    if (!request) throw new HarnessError("PERMISSION_REQUEST_NOT_FOUND", `Permission request not found: ${requestId}`);
    this.persistence.resolvePermissionRequest(requestId, decision);
    this.pending.delete(requestId);
    if (decision === "once") this.once.set(this.key(request), decision);
    if (decision === "session") this.session.set(this.key(request), decision);
    if (decision === "project") {
      this.persistence.addPermissionRule({
        id: `rule_${randomUUID()}`,
        decision: "project",
        effect: request.effect,
        toolName: request.toolName,
        action: request.action,
        projectPath: request.projectPath,
        ...(request.path ? { pathPrefix: request.path } : {}),
        ...(request.destination ? { destination: request.destination } : {}),
        ...(request.resource ? { resource: request.resource } : {}),
        ...rule,
      });
    }
    return request;
  }

  getPending(sessionId?: string): PermissionRequest[] {
    return [...this.pending.values()].filter((request) => !sessionId || request.sessionId === sessionId);
  }

  private makeRequest(input: PermissionCheckInput): PermissionRequest {
    return {
      id: `perm_${randomUUID()}`,
      sessionId: input.sessionId,
      agentId: input.agentId,
      toolName: input.toolName,
      action: input.action,
      effect: input.effect,
      projectPath: normalizePath(input.projectPath),
      ...(input.path ? { path: normalizePath(input.path, input.projectPath) } : {}),
      ...(input.destination ? { destination: input.destination } : {}),
      ...(input.arguments ? { arguments: input.arguments } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.resource ? { resource: input.resource } : input.path ? { resource: normalizePath(input.path, input.projectPath) } : {}),
    };
  }

  private findRule(input: PermissionCheckInput, path?: string): PermissionRule | undefined {
    return this.persistence.listPermissionRules(normalizePath(input.projectPath)).find((rule) => {
      if (expired(rule)) return false;
      if (rule.effect && rule.effect !== input.effect) return false;
      if (rule.toolName && rule.toolName !== input.toolName) return false;
      if (rule.action && rule.action !== input.action) return false;
      if (rule.projectPath && !pathWithin(input.projectPath, rule.projectPath)) return false;
      if (rule.destination && rule.destination !== input.destination) return false;
      if (rule.resource && rule.resource !== input.resource) return false;
      return !rule.pathPrefix || (!!path && pathWithin(path, rule.pathPrefix));
    });
  }

  private matchesExternalRule(input: PermissionCheckInput, path: string): boolean {
    return this.persistence.listPermissionRules(normalizePath(input.projectPath)).some((rule) => !!rule.pathPrefix && pathWithin(path, rule.pathPrefix) && (!rule.toolName || rule.toolName === input.toolName) && (!rule.effect || rule.effect === input.effect) && rule.decision !== "reject" && !expired(rule));
  }

  private key(input: PermissionCheckInput | PermissionRequest): string {
    const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}` : JSON.stringify(value);
    const argumentsHash = input.arguments ? createHash("sha256").update(canonical(input.arguments)).digest("hex") : "";
    return [input.sessionId, input.toolName, input.action, input.effect, input.path ? normalizePath(input.path, input.projectPath) : "", input.destination ?? "", input.resource ?? "", argumentsHash].join("|");
  }
}

export { normalizePath, pathWithin };
