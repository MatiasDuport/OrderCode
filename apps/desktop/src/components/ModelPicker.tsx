import { useMemo, useState } from 'react';
import { Check, ChevronRight, LoaderCircle, Search, Settings2, Star, X } from 'lucide-react';
import type { ProviderInfo, ProviderModel } from '../lib/ipc';
import { compareModels, groupModels, isFreeModel, matchesModel, modelDetails, modelKey, modelNeedsConnection, modelPriceLabel, modelProviderLabel, modelTooltip, recommendedModels, shortModelLabel } from '../lib/modelCatalog';
import { useDesktopStore } from '../lib/store';
import { Localized, translate } from '../lib/localization';

export function ModelRow({ item, selected = false, favorite, onFavorite, onSelect, manage = false }: { item: ProviderModel; selected?: boolean; favorite: boolean; onFavorite: () => void; onSelect: () => void; manage?: boolean }) {
  const language = useDesktopStore((state) => state.language);
  const blocked = !manage && !item.available && !modelNeedsConnection(item);
  return <Localized><div className={`model-option-row model-choice ${selected ? 'is-selected' : ''} ${!item.available ? 'needs-connection' : ''}`}>
    <button type="button" role={manage ? undefined : 'option'} aria-selected={manage ? undefined : selected} aria-pressed={manage ? favorite : undefined} disabled={blocked} className="model-choice-main" title={modelTooltip(item).split('\n').map((line) => translate(line, language)).join('\n')} onClick={onSelect}>
      <span className="model-choice-check" aria-hidden="true">{(manage ? favorite : selected) && <Check size={13} />}</span>
      <span className="model-choice-copy"><strong>{shortModelLabel(item)}</strong><small>{!item.available ? item.availabilityReason || 'Conecta este proveedor en Ajustes' : modelDetails(item)}</small></span>
      <span className={`model-price model-price--${item.priceKind}`}>{modelPriceLabel(item)}</span>
    </button>
    <button type="button" className={`model-favorite-button ${favorite ? 'is-active' : ''}`} aria-label={`${favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}: ${item.label}`} aria-pressed={favorite} title={favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'} onClick={onFavorite}><Star size={14} /></button>
  </div></Localized>;
}

type Props = { models: ProviderModel[]; providers: ProviderInfo[]; selected: string; freeOnly: boolean; busy: boolean; error: boolean; discovery: string; onSelect: (model: ProviderModel) => void; onFreeOnlyChange: () => void; onRetry: () => void; onSettings: () => void };

export function ModelPicker({ models, providers, selected, freeOnly, busy, error, discovery, onSelect, onFreeOnlyChange, onRetry, onSettings }: Props) {
  const { favoriteModels, recentModels, hiddenModelProviders, showAdvancedModels, set } = useDesktopStore();
  const [view, setView] = useState<'recommended' | 'favorites' | 'catalog'>(showAdvancedModels ? 'catalog' : 'recommended');
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('');
  const [limit, setLimit] = useState(40);
  const visibleProviders = providers.filter((item) => !hiddenModelProviders.includes(item.id) && (item.configured || models.some((model) => model.providerId === item.id)));
  const effectiveProvider = visibleProviders.some((item) => item.id === provider) ? provider : '';
  const matches = useMemo(() => models.filter((item) => !hiddenModelProviders.includes(item.providerId) && (!effectiveProvider || effectiveProvider === item.providerId) && (!freeOnly || isFreeModel(item)) && matchesModel(item, query)).sort(compareModels), [models, hiddenModelProviders, effectiveProvider, freeOnly, query]);
  const searching = Boolean(query.trim());
  const candidates = useMemo(() => view === 'favorites' ? matches.filter((item) => favoriteModels.includes(modelKey(item))) : view === 'catalog' || searching ? matches : recommendedModels(matches, selected, favoriteModels), [matches, view, searching, selected, favoriteModels]);
  const shown = candidates.slice(0, limit);
  const groups = groupModels(shown, providers, view === 'catalog' || searching);
  const recent = view === 'recommended' && !searching ? matches.filter((item) => item.available && recentModels.includes(modelKey(item)) && !shown.some((other) => modelKey(other) === modelKey(item))).slice(0, 2) : [];
  const toggleFavorite = (item: ProviderModel) => {
    const key = modelKey(item);
    set('favoriteModels', favoriteModels.includes(key) ? favoriteModels.filter((value) => value !== key) : [key, ...favoriteModels].slice(0, 100));
  };
  const row = (item: ProviderModel) => <ModelRow key={modelKey(item)} item={item} selected={selected === modelKey(item)} favorite={favoriteModels.includes(modelKey(item))} onFavorite={() => toggleFavorite(item)} onSelect={() => onSelect(item)} />;
  return <Localized><div className="model-picker">
    <div className="model-picker-header">
      <div className="model-picker-title"><strong>Elegir modelo</strong><span>{busy ? <LoaderCircle size={13} className="model-loading-icon" /> : 'IA para tu proyecto'}</span></div>
      <label className="model-picker-search"><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(40); }} placeholder="Buscar modelo o creador…" aria-label="Buscar modelos" />{query && <button type="button" aria-label="Borrar búsqueda" onClick={() => { setQuery(''); setLimit(40); }}><X size={13} /></button>}</label>
      <div className="model-picker-tabs" role="group" aria-label="Vista del catálogo">{([['recommended', 'Recomendados'], ['favorites', 'Favoritos'], ['catalog', 'Catálogo']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={view === id} onClick={() => { setView(id); setLimit(40); }}>{label}{id === 'favorites' && favoriteModels.length > 0 && <span>{favoriteModels.length}</span>}</button>)}</div>
      <div className="model-picker-filters"><select aria-label="Filtrar por proveedor" value={visibleProviders.some((item) => item.id === provider) ? provider : ''} onChange={(event) => { setProvider(event.target.value); setLimit(40); }}><option value="">Todos los proveedores</option>{visibleProviders.map((item) => <option value={item.id} key={item.id}>{modelProviderLabel(item.id, providers)}</option>)}</select><button type="button" className={`free-only-toggle ${freeOnly ? 'is-active' : ''}`} aria-pressed={freeOnly} title="Solo modelos gratuitos o locales" onClick={onFreeOnlyChange}><span className="free-only-check">{freeOnly && <Check size={10} />}</span>Solo gratuitos</button></div>
    </div>
    <div className="model-picker-body" key={`${view}:${provider}:${query}:${freeOnly}`}>
      <div role="listbox" aria-label="Modelos disponibles">{groups.map((group) => <section className="model-provider-group" key={group.id} role="group" aria-label={group.label}><div className="model-provider-heading"><span>{group.label}</span><small>{group.models.length}</small></div>{group.models.map(row)}</section>)}{recent.length > 0 && <section className="model-provider-group" role="group" aria-label="Recientes"><div className="model-provider-heading"><span>Recientes</span></div>{recent.map(row)}</section>}</div>
      {!shown.length && <div className="model-picker-empty"><Search size={22} /><strong>{view === 'favorites' ? 'Guarda tus modelos favoritos' : busy ? 'Buscando modelos…' : 'No hay modelos para estos filtros'}</strong><p>{view === 'favorites' ? 'Pulsa la estrella de un modelo para encontrarlo aquí.' : query || provider ? 'Prueba otro nombre o cambia los filtros.' : freeOnly ? 'Los gratuitos requieren acceso disponible. También puedes conectar un modelo local.' : discovery || 'Conecta un proveedor para empezar.'}</p>{(query || provider) && <button type="button" onClick={() => { setQuery(''); setProvider(''); }}>Limpiar filtros</button>}</div>}
      {candidates.length > limit && <button type="button" className="model-picker-more" onClick={() => setLimit((value) => value + 40)}>Mostrar más modelos<ChevronRight size={13} /></button>}
      {view === 'recommended' && !searching && matches.length > candidates.length && <button type="button" className="model-picker-more" onClick={() => { setView('catalog'); setLimit(40); }}>Explorar catálogo<ChevronRight size={13} /></button>}
    </div>
    <div className="model-picker-footer"><button type="button" onClick={onSettings}><Settings2 size={13} />Gestionar modelos</button>{error ? <button type="button" className="model-picker-retry" onClick={onRetry}>Reintentar catálogo</button> : <span>{busy ? 'Actualizando…' : freeOnly ? 'Solo gratuitos o locales' : 'Gratuitos primero'}</span>}</div>
  </div></Localized>;
}
