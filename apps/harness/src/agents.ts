import { randomUUID } from "node:crypto";
import { HarnessError } from "./errors.js";
import type { Persistence } from "./persistence.js";
import type { AgentProfile, AgentProfileDraft } from "./types.js";

const builtInIds = new Set(["general", "explore", "architect", "build", "debug", "qa", "security", "review"]);

export class AgentRegistry {
  constructor(private readonly persistence: Persistence) {}

  list(): AgentProfile[] { return this.persistence.listAgentProfiles(); }

  get(id: string): AgentProfile | undefined { return this.persistence.getAgentProfile(id); }

  save(draft: AgentProfileDraft): AgentProfile {
    if (!draft || typeof draft !== "object") throw new HarnessError("INVALID_AGENT", "Agent profile data is required.");
    const name = typeof draft.name === "string" ? draft.name.trim() : "";
    const description = typeof draft.description === "string" ? draft.description.trim() : "";
    const instructions = typeof draft.instructions === "string" ? draft.instructions.trim() : "";
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new HarnessError("INVALID_AGENT", "Agent name must contain 1–80 printable characters.");
    if (description.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) throw new HarnessError("INVALID_AGENT", "Agent description must be at most 500 characters and contain no control characters.");
    if (!instructions || instructions.length > 20_000 || instructions.includes("\0")) throw new HarnessError("INVALID_AGENT", "Agent instructions must contain 1–20,000 valid characters.");
    if (!Array.isArray(draft.toolAllowlist) || draft.toolAllowlist.length > 128 || draft.toolAllowlist.some((name) => typeof name !== "string" || !name.trim() || name.length > 160)) throw new HarnessError("INVALID_AGENT", "Agent tools must be a list of at most 128 valid tool names.");
    if (typeof draft.enabled !== "boolean") throw new HarnessError("INVALID_AGENT", "Agent enabled state must be explicit.");
    const toolAllowlist = [...new Set(draft.toolAllowlist.map((name) => name.trim()))];
    const existing = draft.id ? this.persistence.getAgentProfile(draft.id) : undefined;
    if (draft.id && (builtInIds.has(draft.id) || !draft.id.startsWith("custom_") || !existing)) throw new HarnessError("INVALID_AGENT", "Only existing custom agent profiles can be updated.");
    const now = new Date().toISOString();
    const profile: AgentProfile = {
      id: existing?.id ?? `custom_${randomUUID()}`,
      name,
      description,
      instructions,
      toolAllowlist,
      enabled: draft.enabled,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.persistence.saveAgentProfile(profile);
    return profile;
  }

  delete(id: string): boolean {
    if (builtInIds.has(id) || !id.startsWith("custom_")) throw new HarnessError("INVALID_AGENT", "Built-in agents cannot be deleted.");
    return this.persistence.deleteAgentProfile(id);
  }
}
