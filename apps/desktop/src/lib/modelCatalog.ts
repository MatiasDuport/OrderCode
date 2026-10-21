import type { ProviderInfo, ProviderModel } from './ipc';

export const modelKey = (model: ProviderModel) => `${model.providerId}::${model.id}`;
export const isFreeModel = (model: ProviderModel) => model.priceKind === 'free' || model.priceKind === 'local';
export const modelNeedsConnection = (model: ProviderModel) => !model.available && (!model.availabilityReason || /conecta|clave|cuenta|connect|api key/i.test(model.availabilityReason));

const providerNames: Record<string, string> = { opencode_zen: 'OpenCode', openai_chatgpt: 'ChatGPT', xai_plan: 'Grok', minimax_plan: 'MiniMax M Plan', openrouter: 'OpenRouter', ollama: 'Ollama', lmstudio: 'LM Studio', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', gemini: 'Gemini', xai: 'xAI' };
export function modelProviderLabel(id: string, providers: ProviderInfo[] = []): string {
  return providers.find((provider) => provider.id === id)?.label || providerNames[id] || id;
}

const authorNames: Record<string, string> = { 'meta-llama': 'Meta', 'nvidia': 'NVIDIA', 'qwen': 'Qwen', 'openai': 'OpenAI', 'google': 'Google', 'anthropic': 'Anthropic', 'deepseek': 'DeepSeek', 'cohere': 'Cohere', 'mistralai': 'Mistral', 'x-ai': 'xAI', 'minimax': 'MiniMax', 'z-ai': 'Z.ai', 'thudm': 'Z.ai', 'nousresearch': 'Nous Research', 'tngtech': 'TNG', 'microsoft': 'Microsoft', 'moonshotai': 'Moonshot AI' };
export function modelAuthor(model: ProviderModel): string {
  if (model.providerId !== 'openrouter') return modelProviderLabel(model.providerId);
  if (model.id.startsWith('openrouter/')) return 'OpenRouter';
  const id = model.id.split('/')[0]!;
  return authorNames[id.toLowerCase()] || model.label.match(/^([^:]+):\s/)?.[1] || id;
}

export function shortModelLabel(model: ProviderModel): string {
  const label = model.providerId === 'openrouter' ? model.label.replace(/^[^:]+:\s+/, '') : model.label;
  return label.replace(/\s*\(free\)\s*$/i, '').trim();
}

export function compareModels(left: ProviderModel, right: ProviderModel): number {
  const tier = (model: ProviderModel) => model.priceKind === 'free' ? 0 : model.priceKind === 'subscription' ? 1 : model.priceKind === 'local' ? 2 : model.priceKind === 'paid' ? 3 : 4;
  return Number(right.available) - Number(left.available) || tier(left) - tier(right) || Number(right.providerId === 'openrouter' && right.id === 'openrouter/free') - Number(left.providerId === 'openrouter' && left.id === 'openrouter/free') || (left.catalogRank ?? Number.MAX_SAFE_INTEGER) - (right.catalogRank ?? Number.MAX_SAFE_INTEGER) || left.label.localeCompare(right.label);
}

export function recommendedModels(models: ProviderModel[], selected: string, favorites: string[]): ProviderModel[] {
  const groups = new Map<string, ProviderModel[]>();
  const hasReadyModels = models.some((model) => model.available);
  for (const item of [...models].sort(compareModels)) {
    if (!item.available && modelKey(item) !== selected && (hasReadyModels || !modelNeedsConnection(item))) continue;
    groups.set(item.providerId, [...(groups.get(item.providerId) ?? []), item]);
  }
  return [...groups.values()].flatMap((items) => {
    const picked: ProviderModel[] = [];
    const cap = items[0]?.providerId === 'openrouter' ? 6 : 3;
    const add = (item: ProviderModel) => { if (picked.length < cap && !picked.includes(item)) picked.push(item); };
    items.filter((item) => modelKey(item) === selected || item.id === 'openrouter/free').forEach(add);
    items.filter((item) => favorites.includes(modelKey(item))).forEach(add);
    // Preserve the provider's coding ranking while avoiding six near-identical models from one author.
    for (const item of items) if (!picked.some((other) => modelAuthor(other) === modelAuthor(item) && other.priceKind === item.priceKind)) add(item);
    items.forEach(add);
    return picked.sort(compareModels);
  }).slice(0, 24);
}

export function groupModels(models: ProviderModel[], providers: ProviderInfo[], byAuthor = false): Array<{ id: string; label: string; models: ProviderModel[] }> {
  const groups = new Map<string, { id: string; label: string; models: ProviderModel[] }>();
  for (const model of models) {
    const author = byAuthor && model.providerId === 'openrouter' ? modelAuthor(model) : '';
    const id = `${model.providerId}:${author}`;
    const group = groups.get(id) ?? { id, label: `${modelProviderLabel(model.providerId, providers)}${author && author !== 'OpenRouter' ? ` / ${author}` : ''}`, models: [] };
    group.models.push(model);
    groups.set(id, group);
  }
  return [...groups.values()];
}

export function matchesModel(model: ProviderModel, query: string): boolean {
  const text = `${model.label} ${model.id} ${modelProviderLabel(model.providerId)} ${modelAuthor(model)}`.toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every((word) => text.includes(word));
}

export function modelPriceLabel(model: ProviderModel): string {
  if (model.priceKind === 'free') return 'Gratis';
  if (model.priceKind === 'subscription') return 'Tu plan';
  if (model.priceKind === 'local') return 'Local';
  return model.pricing ? 'API' : 'Sin verificar';
}

export function modelDetails(model: ProviderModel): string {
  const parts = [model.providerId === 'openrouter' ? modelAuthor(model) : modelProviderLabel(model.providerId)];
  if (model.id === 'openrouter/free') return 'Elige automáticamente un modelo gratuito';
  if (model.reasoningEfforts?.length) parts.push('Razonamiento');
  if (model.contextWindowTokens) {
    const n = model.contextWindowTokens;
    parts.push(`${Number((n / (n >= 1_000_000 ? 1_000_000 : 1_000)).toFixed(1))}${n >= 1_000_000 ? 'M' : 'k'}`);
  }
  return parts.join(' · ');
}

export function modelTooltip(model: ProviderModel): string {
  const price = model.pricing ? `$${Number(model.pricing.inputPerMillionUsd.toFixed(4))} / $${Number(model.pricing.outputPerMillionUsd.toFixed(4))} por 1M tokens (entrada / salida)` : model.priceKind === 'subscription' ? 'Uso de tu plan · sujeto a límites' : model.priceKind === 'local' ? 'Inferencia local · sin tarifa API' : 'Precio no verificado';
  return [model.id, model.availabilityReason || price, ...(model.reasoningEfforts?.length ? [`Razonamiento: ${model.reasoningEfforts.join(', ')}`] : [])].join('\n');
}
