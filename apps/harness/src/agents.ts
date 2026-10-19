import { randomUUID } from "node:crypto";
import { HarnessError } from "./errors.js";
import type { Persistence } from "./persistence.js";
import type { AgentProfile, AgentProfileDraft } from "./types.js";

export const OFFICIAL_AGENT_IDS = ["general", "explore", "architect", "build", "debug", "qa", "security", "review"] as const;
const builtInIds = new Set<string>(OFFICIAL_AGENT_IDS);

function normalizeProfile(profile: AgentProfile): AgentProfile {
  return {
    ...profile,
    templateId: typeof profile.templateId === "string" ? profile.templateId : "custom",
    outcome: typeof profile.outcome === "string" ? profile.outcome : "",
    autoAssign: profile.autoAssign === true,
    canDelegate: profile.canDelegate === true,
    delegateAllowlist: Array.isArray(profile.delegateAllowlist) ? profile.delegateAllowlist : [],
    delegationDepth: Number.isInteger(profile.delegationDepth) ? profile.delegationDepth! : 0,
  };
}

export class AgentRegistry {
  constructor(private readonly persistence: Persistence) {}

  list(): AgentProfile[] { return this.persistence.listAgentProfiles().map(normalizeProfile); }

  get(id: string): AgentProfile | undefined {
    const profile = this.persistence.getAgentProfile(id);
    return profile ? normalizeProfile(profile) : undefined;
  }

  preview(draft: AgentProfileDraft): AgentProfile {
    if (!draft || typeof draft !== "object") throw new HarnessError("INVALID_AGENT", "Agent profile data is required.");
    const name = typeof draft.name === "string" ? draft.name.trim() : "";
    const description = typeof draft.description === "string" ? draft.description.trim() : "";
    const instructions = typeof draft.instructions === "string" ? draft.instructions.trim() : "";
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new HarnessError("INVALID_AGENT", "Agent name must contain 1–80 printable characters.");
    if (description.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) throw new HarnessError("INVALID_AGENT", "Agent description must be at most 500 characters and contain no control characters.");
    if (!instructions || instructions.length > 20_000 || instructions.includes("\0")) throw new HarnessError("INVALID_AGENT", "Agent instructions must contain 1–20,000 valid characters.");
    if (!Array.isArray(draft.toolAllowlist) || draft.toolAllowlist.length > 128 || draft.toolAllowlist.some((name) => typeof name !== "string" || !name.trim() || name.length > 160)) throw new HarnessError("INVALID_AGENT", "Agent tools must be a list of at most 128 valid tool names.");
    if (draft.skillAllowlist !== undefined && (!Array.isArray(draft.skillAllowlist) || draft.skillAllowlist.length > 64 || draft.skillAllowlist.some((id) => typeof id !== "string" || !id.trim() || id.length > 256 || id.includes("\0")))) throw new HarnessError("INVALID_AGENT", "Agent skills must be a list of at most 64 valid project skill ids.");
    if (typeof draft.enabled !== "boolean") throw new HarnessError("INVALID_AGENT", "Agent enabled state must be explicit.");
    if (draft.autoAssign !== undefined && typeof draft.autoAssign !== "boolean" || draft.canDelegate !== undefined && typeof draft.canDelegate !== "boolean") throw new HarnessError("INVALID_AGENT", "Agent selection and delegation settings must be explicit booleans.");
    if (draft.delegateAllowlist !== undefined && (!Array.isArray(draft.delegateAllowlist) || draft.delegateAllowlist.some((id) => typeof id !== "string"))) throw new HarnessError("INVALID_AGENT", "Agent delegation targets must be a list of agent identifiers.");
    const toolAllowlist = [...new Set(draft.toolAllowlist.map((name) => name.trim()))];
    const existing = draft.id ? this.persistence.getAgentProfile(draft.id) : undefined;
    if (draft.id && (builtInIds.has(draft.id) || !draft.id.startsWith("custom_") || !existing)) throw new HarnessError("INVALID_AGENT", "Only existing custom agent profiles can be updated.");
    const now = new Date().toISOString();
    const profileId = existing?.id ?? `custom_${randomUUID()}`;
    const canDelegate = draft.canDelegate === true;
    const delegateAllowlist = [...new Set(draft.delegateAllowlist ?? [])];
    if (delegateAllowlist.length > 32 || delegateAllowlist.some((id) => typeof id !== "string" || id.length > 100 || id === profileId || !builtInIds.has(id) && !this.persistence.getAgentProfile(id))) {
      throw new HarnessError("INVALID_AGENT", "Delegation targets must be known agents, cannot include this agent, and must contain at most 32 entries.");
    }
    const delegationDepth = draft.delegationDepth ?? (canDelegate ? 2 : 0);
    if (!Number.isInteger(delegationDepth) || delegationDepth < 0 || delegationDepth > 4 || canDelegate && delegationDepth < 1) throw new HarnessError("INVALID_AGENT", "Delegation depth must be between 1 and 4 for an agent that can delegate.");
    const templateId = draft.templateId ?? "custom";
    if (typeof templateId !== "string" || templateId.length > 80 || /[\u0000-\u001f\u007f]/.test(templateId)) throw new HarnessError("INVALID_AGENT", "Agent template must be a valid identifier.");
    const outcome = draft.outcome ?? "";
    if (typeof outcome !== "string" || outcome.length > 2_000 || outcome.includes("\0")) throw new HarnessError("INVALID_AGENT", "Expected agent result must contain at most 2,000 valid characters.");
    const profile: AgentProfile = {
      id: profileId,
      name,
      description,
      instructions,
      toolAllowlist,
      ...(draft.skillAllowlist !== undefined ? { skillAllowlist: [...new Set(draft.skillAllowlist)] } : {}),
      templateId,
      outcome: outcome.trim(),
      autoAssign: draft.autoAssign === true,
      canDelegate,
      delegateAllowlist: canDelegate ? delegateAllowlist : [],
      delegationDepth: canDelegate ? delegationDepth : 0,
      enabled: draft.enabled,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return profile;
  }

  save(draft: AgentProfileDraft): AgentProfile {
    const profile = this.preview(draft);
    this.persistence.saveAgentProfile(profile);
    return profile;
  }

  delete(id: string): boolean {
    if (builtInIds.has(id) || !id.startsWith("custom_")) throw new HarnessError("INVALID_AGENT", "Built-in agents cannot be deleted.");
    return this.persistence.deleteAgentProfile(id);
  }
}
