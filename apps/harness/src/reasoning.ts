import { HarnessError } from "./errors.js";

export const reasoningEffortValues = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Only documented native model families; unknown models keep the provider default. */
export function nativeReasoningEfforts(providerId: string, model: string): string[] {
  if (providerId === "openai" || providerId === "openai_chatgpt") {
    // https://developers.openai.com/api/docs/models and /guides/latest-model
    if (/^(?:gpt-6-astra|gpt-6\.1-sol)(?:$|-\d{4}-)/.test(model)) return ["low", "medium", "high", "xhigh", "max"];
    if (/^gpt-6-(?:sol|luna)(?:$|-\d{4}-)/.test(model)) return ["none", "low", "medium", "high", "xhigh", "max"];
    if (/^gpt-5\.[23]-codex(?:$|-\d{4}-)/.test(model) || /^gpt-5\.1-codex-max(?:$|-\d{4}-)/.test(model)) return ["low", "medium", "high", "xhigh"];
    if (/^gpt-5(?:\.1)?-codex(?:-mini)?(?:$|-\d{4}-)/.test(model)) return ["low", "medium", "high"];
    if (/^gpt-5\.6(?:-(?:sol|terra|luna))?(?:$|-\d{4}-)/.test(model)) return ["none", "low", "medium", "high", "xhigh", "max"];
    if (/^gpt-5\.[245](?:$|-\d{4}-)/.test(model)) return ["none", "low", "medium", "high", "xhigh"];
    if (/^gpt-5\.1(?:$|-\d{4}-)/.test(model)) return ["none", "low", "medium", "high"];
    if (/^gpt-5(?:-(?:mini|nano))?(?:$|-\d{4}-)/.test(model)) return ["minimal", "low", "medium", "high"];
    if (/^(?:o1|o3(?:-mini)?|o4-mini)(?:$|-\d{4}-)/.test(model)) return ["low", "medium", "high"];
  }
  if (providerId === "anthropic") {
    // https://platform.claude.com/docs/en/build-with-claude/effort
    if (/^claude-(?:(?:fable|mythos)-5(?:-1)?|mythos-preview|opus-(?:4-[78]|5(?:-5)?)|sonnet-5(?:-5)?|haiku-5-5)(?:$|-\d{8})/.test(model)) return ["low", "medium", "high", "xhigh", "max"];
    if (/^claude-(?:opus|sonnet)-4-6(?:$|-\d{8})/.test(model)) return ["low", "medium", "high", "max"];
    if (/^claude-opus-4-5(?:$|-\d{8})/.test(model)) return ["low", "medium", "high"];
  }
  if (providerId === "gemini") {
    // https://ai.google.dev/gemini-api/docs/generate-content/thinking
    if (/^gemini-3\.1-pro(?:$|-)/.test(model)) return ["low", "medium", "high"];
    if (/^gemini-3-pro(?:$|-)/.test(model)) return ["low", "high"];
    if (/^gemini-(?:4-argon|3\.[78]-flash)(?:$|-)/.test(model)) return ["low", "medium", "high"];
    if (/^gemini-3\.1-flash-lite-image(?:$|-)/.test(model)) return ["minimal", "high"];
    if (/^gemini-(?:3(?:\.[156])?-flash(?:-lite)?|robotics-er-2)(?:$|-)/.test(model)) return ["minimal", "low", "medium", "high"];
  }
  if (providerId === "xai" || providerId === "xai_plan") {
    // https://docs.x.ai/developers/model-capabilities/text/reasoning
    if (/^grok-4\.[67](?:$|-)/.test(model)) return ["low", "medium", "high", "xhigh"];
    if (/^grok-4\.5(?:$|-)/.test(model)) return ["low", "medium", "high"];
  }
  return [];
}

export function normalizeReasoningEffort(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !reasoningEffortValues.includes(value as typeof reasoningEffortValues[number])) throw new HarnessError("INVALID_REASONING_EFFORT", "Choose a supported reasoning effort, or Auto.");
  return value;
}

export function validateReasoningEffort(value: unknown, options: readonly string[] | undefined, model: string): string | undefined {
  const effort = normalizeReasoningEffort(value);
  if (effort && !options?.includes(effort)) throw new HarnessError("UNSUPPORTED_REASONING_EFFORT", `The model ${model} does not support reasoning effort '${effort}'. Choose Auto or a level listed for this model.`);
  return effort;
}

export function catalogReasoningEfforts(value: { supported_efforts?: unknown; mandatory?: boolean } | undefined): string[] {
  const allowed = value?.supported_efforts;
  const values = allowed === null ? [...reasoningEffortValues] : Array.isArray(allowed) ? reasoningEffortValues.filter((effort) => allowed.includes(effort)) : [];
  return value?.mandatory ? values.filter((effort) => effort !== "none") : values;
}
