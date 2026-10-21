import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, LoaderCircle, Search, Star } from 'lucide-react';
import { listProviderModels, type ProviderInfo, type ProviderModel } from '../lib/ipc';
import { compareModels, groupModels, isFreeModel, matchesModel, modelKey, modelProviderLabel } from '../lib/modelCatalog';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';
import { ModelRow } from './ModelPicker';

export function ModelCatalogSettings({ providers }: { providers: ProviderInfo[] }) {
  const { favoriteModels, hiddenModelProviders, showAdvancedModels, recentModels, set } = useDesktopStore();
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState('openrouter');
  const [query, setQuery] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const [limit, setLimit] = useState(40);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map<string, ProviderModel[]>());
  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? providers.find((provider) => provider.configured) ?? providers[0];
  const selectedId = selectedProvider?.id;
  useEffect(() => { cache.current.clear(); }, [providers]);
  useEffect(() => {
    if (!open || !selectedId) return;
    const cached = cache.current.get(selectedId);
    if (cached) { setModels(cached); setBusy(false); setError(''); return; }
    let current = true;
    setBusy(true); setError(''); setModels([]);
    void listProviderModels(selectedId).then((found) => {
      if (!current) return;
      cache.current.set(selectedId, found);
      setModels(found);
    }).catch(() => { if (current) setError('No se pudo cargar este catálogo. Puedes reintentarlo.'); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [open, selectedId, providers, retry]);
  const matching = useMemo(() => models.filter((item) => (!onlyFree || isFreeModel(item)) && matchesModel(item, query)).sort(compareModels), [models, onlyFree, query]);
  const groups = groupModels(matching.slice(0, limit), providers, true);
  const toggleFavorite = (item: ProviderModel) => {
    const key = modelKey(item);
    set('favoriteModels', favoriteModels.includes(key) ? favoriteModels.filter((value) => value !== key) : [key, ...favoriteModels].slice(0, 100));
  };
  return <Localized><details className="settings-card settings-model-catalog model-library" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Personalizar el selector de modelos<span className="model-library-count"><Star size={12} />{favoriteModels.length}</span></summary>
    <p>Guarda con la estrella los modelos que quieras tener a mano. Los encontrarás en Favoritos dentro del chat.</p>
    <div className="model-library-toolbar"><select aria-label="Catálogo del proveedor" value={selectedId ?? ''} onChange={(event) => { setProviderId(event.target.value); setQuery(''); setLimit(40); }}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{modelProviderLabel(provider.id, providers)}</option>)}</select><label className="model-picker-search"><Search size={14} /><input value={query} aria-label="Buscar en el catálogo" placeholder="Buscar modelo o creador…" onChange={(event) => { setQuery(event.target.value); setLimit(40); }} /></label><button type="button" className={`model-library-free ${onlyFree ? 'is-active' : ''}`} aria-pressed={onlyFree} onClick={() => { setOnlyFree((value) => !value); setLimit(40); }}>{onlyFree && <Check size={12} />}Ver gratuitos</button></div>
    <div className="model-library-status"><span>{busy ? 'Cargando catálogo…' : `${matching.length} ${matching.length === 1 ? 'modelo' : 'modelos'}`}</span><span>Gratuitos primero</span></div>
    {selectedId && hiddenModelProviders.includes(selectedId) && <div className="model-library-notice"><span>Este proveedor está oculto en el chat.</span><button type="button" onClick={() => set('hiddenModelProviders', hiddenModelProviders.filter((id) => id !== selectedId))}>Mostrar proveedor</button></div>}
    <div className="model-library-list" aria-label="Catálogo para favoritos">{groups.map((group) => <section className="model-provider-group" key={group.id}><div className="model-provider-heading"><span>{group.label}</span><small>{group.models.length}</small></div>{group.models.map((item) => <ModelRow key={modelKey(item)} item={item} manage favorite={favoriteModels.includes(modelKey(item))} onFavorite={() => toggleFavorite(item)} onSelect={() => toggleFavorite(item)} />)}</section>)}
      {busy && <div className="model-library-empty" role="status"><LoaderCircle size={18} className="model-loading-icon" />Cargando modelos…</div>}
      {!busy && !matching.length && <div className="model-library-empty" role="status">{error || (!selectedProvider?.configured && !models.length ? 'Conecta este proveedor para consultar sus modelos.' : 'No hay modelos para estos filtros.')}{error && <button type="button" onClick={() => { if (selectedId) cache.current.delete(selectedId); setRetry((value) => value + 1); }}>Reintentar</button>}</div>}
      {matching.length > limit && <button type="button" className="model-picker-more" onClick={() => setLimit((value) => value + 40)}>Mostrar más modelos</button>}
    </div>
    <details className="model-library-preferences"><summary>Visibilidad y preferencias</summary><label className="model-library-preference"><input type="checkbox" checked={showAdvancedModels} onChange={(event) => set('showAdvancedModels', event.target.checked)} /><span>Abrir el catálogo completo por defecto<small>Desactivado: empieza con una selección breve de modelos listos.</small></span></label><strong>Proveedores visibles en el selector</strong><div className="settings-model-provider-list">{providers.map((provider) => <label className="settings-model-provider" key={provider.id}><input type="checkbox" checked={!hiddenModelProviders.includes(provider.id)} onChange={(event) => set('hiddenModelProviders', event.target.checked ? hiddenModelProviders.filter((id) => id !== provider.id) : [...hiddenModelProviders, provider.id])} /><span><strong>{modelProviderLabel(provider.id, providers)}</strong><small>{provider.configured ? 'Conectado' : 'Sin conectar'}</small></span></label>)}</div>
      <div className="settings-model-actions"><button type="button" className="settings-secondary-action" disabled={!recentModels.length} onClick={() => set('recentModels', [])}>Borrar modelos recientes</button><button type="button" className="settings-secondary-action" disabled={!favoriteModels.length} onClick={() => set('favoriteModels', [])}>Borrar favoritos</button></div>
    </details>
  </details></Localized>;
}
