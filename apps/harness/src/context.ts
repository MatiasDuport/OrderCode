import type { BuiltContext, ContextInput, MessageRecord, ProviderRequest, ToolResult } from "./types.js";
import { compactOutput, measureContextReduction, readContextReduction } from "./logging.js";

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Internal accounting does not form part of a provider's request payload. */
export function estimateRequestTokens(request: Pick<ProviderRequest, "messages" | "tools">): number {
  return estimateTokens(JSON.stringify({ ...request, messages: request.messages.map(({ contextReduction: _reduction, ...message }) => message) }));
}

export function selectRelevantMarkdownSections(
  content: string,
  goal: string,
  options: { maxChars: number; pinnedHeadings?: string[]; relevantSections?: number },
): string {
  const maxChars = Math.max(0, options.maxChars);
  const headings = [...content.matchAll(/^##\s+(.+?)\s*$/gm)];
  if (!headings.length) return content.trim().slice(0, maxChars);

  const normalize = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/^\d+(?:\.\d+)*\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const stopWords = new Set(("about after again against all also and any are because before between both but can could did does doing down each few for from further had has have having here how into its itself just more most not now off once only other our out over own same should some such than that the their them then there these they this through too under until very was were what when where which while who why will with would you your a an as at be by do if in is it me my no of on or so to up we el ella ellas ellos en con de del la las los un una unos unas y o para por que su sus como cuando cual cuales quien donde es son fue ser estar este esta esto hay mas menos muy sin sobre tras entre desde hasta").split(/\s+/));
  const goalTerms = [...new Set((normalize(goal).match(/[a-z0-9]{3,}/g) ?? []).filter((term) => !stopWords.has(term)))].slice(0, 64);
  const sections = headings.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = headings[index + 1]?.index ?? content.length;
    const title = match[1] ?? "";
    const body = content.slice(start, end).trim();
    const titleTerms = new Set(normalize(title).split(/\s+/));
    const bodyTerms = new Set(normalize(body).split(/\s+/));
    const score = goalTerms.reduce((total, term) => total + (titleTerms.has(term) ? 4 : bodyTerms.has(term) ? 1 : 0), 0);
    const normalizedTitle = normalize(title);
    const pinned = (options.pinnedHeadings ?? []).some((heading) => normalizedTitle.includes(normalize(heading)));
    return { index, title, body, score, pinned, text: "## " + title + "\n" + body };
  });
  const introEnd = headings[0]?.index ?? 0;
  const intro = content.slice(0, introEnd).trim();
  const prefix = intro ? intro + "\n\n" : "";
  const pinned = sections.filter((section) => section.pinned);
  const pinnedSet = new Set(pinned.map((section) => section.index));
  const related = sections.filter((section) => !pinnedSet.has(section.index) && section.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, options.relevantSections ?? 2));
  const chosen = [...pinned, ...related].sort((left, right) => left.index - right.index);
  const coreLength = prefix.length + pinned.reduce((total, section) => total + section.text.length + 2, 0);
  let remaining = Math.max(0, maxChars - Math.min(maxChars, coreLength));
  const included = new Set(pinned.map((section) => section.index));
  for (const section of related) {
    const cost = section.text.length + 2;
    if (cost <= remaining) { included.add(section.index); remaining -= cost; }
  }
  let output = prefix.slice(0, maxChars);
  for (const section of chosen) {
    if (!included.has(section.index)) continue;
    const next = section.text + "\n\n";
    if (output.length + next.length <= maxChars) output += next;
    else if (section.pinned && output.length < maxChars) { output += next.slice(0, maxChars - output.length); break; }
  }
  return output.trim();
}

export function compactPriorToolResults(messages: ProviderRequest["messages"], retainRecent = 4, maxChars = 1_600): { messages: ProviderRequest["messages"]; compacted: boolean } {
  const budget = Math.max(128, Math.floor(maxChars));
  const toolIndexes = messages.flatMap((message, index) => message.role === "tool" ? [index] : []);
  const older = new Set(toolIndexes.slice(0, Math.max(0, toolIndexes.length - retainRecent)));
  let compacted = false;
  const next = messages.map((message, index) => {
    if (!older.has(index) || message.content.length <= budget * 1.25) return message;
    compacted = true;
    let previewBudget = Math.max(0, budget - 80);
    const render = () => JSON.stringify({ compacted: true, originalChars: message.content.length, preview: compactOutput(message.content, previewBudget) });
    let content = render();
    // JSON escaping can expand a preview. Bound the serialized result too, so unchanged
    // tool messages are not rewritten on every call and needlessly invalidate a cache prefix.
    while (content.length > budget && previewBudget > 0) {
      previewBudget = Math.max(0, Math.floor(previewBudget * budget / content.length) - 1);
      content = render();
    }
    return { ...message, content, contextReduction: measureContextReduction(message.content, content, message.contextReduction) };
  });
  return { messages: next, compacted };
}

export function estimateCompactedToolResultSavings(messages: ProviderRequest["messages"]): number {
  return messages.reduce((total, message) => message.role === "tool" ? Math.min(Number.MAX_SAFE_INTEGER, total + readContextReduction(message.contextReduction)) : total, 0);
}

export class ContextBuilder {
  build(input: ContextInput): BuiltContext {
    const maxChars = Math.max(4_000, Math.min(input.maxChars ?? 80_000, 100_000));
    const parts: string[] = [];
    const baselineParts: string[] = [];
    const included: string[] = [];
    const omitted: string[] = [];
    let historySavings = 0;
    const add = (name: string, text: string | undefined, priority: number): void => {
      if (!text) return;
      const header = `\n## ${name}\n`;
      const content = text.trim();
      baselineParts.push(`${header}${content}\n`);
      const used = parts.reduce((total, part) => total + part.length, 0);
      const available = maxChars - used - header.length - 1;
      if (available <= 0 || (text.length > available && priority < 95)) { omitted.push(name); return; }
      const fitted = content.length <= available ? content : fitContent(content, available);
      parts.push(`${header}${fitted}\n`);
      included.push(name);
      if (fitted.length < content.length) omitted.push(`${name} (truncated)`);
    };
    if (input.includeGoal !== false) add("Goal", input.goal, 100);
    add("Runtime", `mode=${input.mode}\nstate=${input.state}\nproject=${input.projectPath}`, 100);
    add("Instructions", input.systemInstructions, 95);
    add("Decisions", input.decisions?.slice(-20).join("\n- "), 85);
    add("Compacted conversation history", input.historySummary, 82);
    const history = (input.history ?? []).slice(-20).map((message) => {
      const compacted = compactOutput(message.content, 8_000);
      historySavings += Math.max(0, estimateTokens(`${message.role}: ${message.content}`) - estimateTokens(`${message.role}: ${compacted}`));
      return `${message.role}: ${compacted}`;
    }).join("\n");
    add("Recent conversation", history, 81);
    for (const fragment of input.fileFragments ?? []) {
      const range = fragment.startLine === undefined ? "" : `:${fragment.startLine}-${fragment.endLine ?? fragment.startLine}`;
      add(`File ${fragment.path}${range}`, fragment.content, 70);
    }
    const text = parts.join("").trim();
    const builderSavings = Math.max(0, estimateTokens(baselineParts.join("").trim()) - estimateTokens(text));
    const documentSavings = (input.fileFragments ?? []).reduce((total, fragment) => total + Math.max(0, fragment.estimatedTokensSaved ?? 0), 0);
    return { text, included, omitted, estimatedTokens: estimateTokens(text), estimatedTokensSaved: builderSavings + historySavings + documentSavings };
  }
}

function fitContent(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const estimate = `\n… [${content.length} chars omitted] …\n`;
  if (limit <= estimate.length) return content.slice(0, limit);
  const omitted = content.length - limit + estimate.length;
  const marker = `\n… [${omitted} chars omitted] …\n`;
  const room = limit - marker.length;
  const head = Math.floor(room * 0.72);
  return `${content.slice(0, head)}${marker}${content.slice(-Math.max(0, room - head))}`;
}

export class ToolResultOptimizer {
  compact(result: ToolResult, maxChars = 8_000): ToolResult {
    const dataText = result.data === undefined ? undefined : JSON.stringify(result.data);
    const data = dataText && dataText.length > maxChars * 1.25 ? { compacted: compactOutput(dataText, maxChars), originalChars: dataText.length } : result.data;
    const contextReduction = dataText && data !== result.data ? measureContextReduction(dataText, JSON.stringify(data), result.contextReduction) : result.contextReduction;
    return { ...result, ...(data === undefined ? {} : { data }), ...(contextReduction ? { contextReduction } : {}), diagnostics: result.diagnostics ? compactOutput(result.diagnostics, 4_000) : result.diagnostics };
  }
}

export function messagesToContext(messages: MessageRecord[]): Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }> {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}
