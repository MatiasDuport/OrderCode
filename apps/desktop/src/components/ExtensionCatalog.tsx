import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, BookOpen, Check, ChevronDown, ExternalLink, FolderOpen, LoaderCircle, Plug, RefreshCw, Search } from 'lucide-react';
import type { ExtensionCatalogItem } from '../lib/contracts';
import { installExtension, isDesktopApp, listExtensionCatalog, openExternalUrl } from '../lib/ipc';
import { Localized } from '../lib/localization';
import { useDesktopStore } from '../lib/store';

const searchText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function ExtensionCatalog() {
  const { session, sessionRevision, mode, permission, health, runtimeState } = useDesktopStore();
  const [entries, setEntries] = useState<ExtensionCatalogItem[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'skill' | 'mcp'>('all');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const action = useRef('');
  const readOnly = mode === 'Plan' || permission === 'Lectura';
  const working = ['PREPARING', 'RUNNING', 'WAITING_APPROVAL', 'PAUSING'].includes(runtimeState);
  const desktop = isDesktopApp();

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!isDesktopApp()) { setEntries([]); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const next = await listExtensionCatalog(session?.id);
      if (request === generation.current) setEntries(next);
    } catch (cause) { if (request === generation.current) setError(message(cause)); }
    finally { if (request === generation.current) setLoading(false); }
  }, [session?.id, sessionRevision, health?.harnessConnected]);

  useEffect(() => {
    setEntries([]); setBusy(''); setNotice(''); setError(''); action.current = '';
    void refresh();
    return () => { generation.current += 1; action.current = ''; };
  }, [refresh]);

  useEffect(() => {
    const changed = () => { if (!action.current) void refresh(); };
    window.addEventListener('ordercode:mcp-updated', changed);
    window.addEventListener('ordercode:skills-updated', changed);
    window.addEventListener('ordercode:catalog-changed', changed);
    return () => { window.removeEventListener('ordercode:mcp-updated', changed); window.removeEventListener('ordercode:skills-updated', changed); window.removeEventListener('ordercode:catalog-changed', changed); };
  }, [refresh]);

  const install = async (entry: ExtensionCatalogItem) => {
    if (!session || action.current || readOnly || working) return;
    const operation = crypto.randomUUID();
    const revision = sessionRevision;
    action.current = operation; generation.current += 1;
    setBusy(entry.id); setLoading(false); setError(''); setNotice('');
    const current = () => action.current === operation && useDesktopStore.getState().sessionRevision === revision;
    try {
      const result = await installExtension(session.id, entry.id);
      if (!current()) return;
      setEntries((items) => items.map((item) => item.id === result.entry.id ? result.entry : item));
      const ready = result.status === 'ready' && (result.entry.kind === 'skill' ? result.entry.enabled : result.entry.connected);
      setNotice(result.message || (ready ? 'Lista para usar en tu próxima tarea.' : 'Se guardó la extensión. Revisa su estado antes de usarla.'));
      window.dispatchEvent(new Event(entry.kind === 'skill' ? 'ordercode:skills-updated' : 'ordercode:mcp-updated'));
    } catch (cause) { if (current()) setError(message(cause)); }
    finally { if (current()) { action.current = ''; setBusy(''); } }
  };

  const filtered = useMemo(() => {
    const needle = searchText(query.trim());
    return entries.filter((entry) => (kind === 'all' || entry.kind === kind) && (!needle || searchText(`${entry.name} ${entry.description} ${entry.publisher} ${entry.category}`).includes(needle)));
  }, [entries, kind, query]);
  const installing = entries.find((entry) => entry.id === busy);

  return <Localized><section className="extension-catalog" aria-label="Catálogo de extensiones">
    <div className="extension-catalog-toolbar">
      <label className="extension-catalog-search"><Search size={15} /><input type="search" aria-label="Buscar Skills y MCP" placeholder="Buscar Skills y MCP…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="extension-catalog-filters" role="group" aria-label="Filtrar extensiones">
        {([{ id: 'all', name: 'Todo' }, { id: 'skill', name: 'Skills' }, { id: 'mcp', name: 'MCP' }] as const).map((filter) => <button key={filter.id} type="button" aria-pressed={kind === filter.id} className={kind === filter.id ? 'is-active' : ''} onClick={() => setKind(filter.id)}>{filter.name}</button>)}
      </div>
      <button type="button" className="extension-catalog-refresh" aria-label="Actualizar catálogo" title="Actualizar catálogo" onClick={() => void refresh()} disabled={!desktop || loading || !!busy}><RefreshCw size={14} /></button>
    </div>
    {!desktop && <p className="surface-note">El catálogo y las instalaciones están disponibles en OrderCode Desktop.</p>}
    {desktop && !session && <div className="extension-catalog-project"><div><strong>Elige un proyecto para instalar</strong><p>Puedes explorar el catálogo. Las extensiones se añaden al proyecto que tengas abierto.</p></div><button type="button" onClick={() => useDesktopStore.setState({ currentView: 'Workspace', sidebarOpen: true })}><FolderOpen size={14} />Abrir proyecto</button></div>}
    {session && readOnly && <p className="surface-note">Para instalar, usa Auto o Build y permite cambios en el proyecto.</p>}
    {session && working && <p className="surface-note">Espera a que termine la tarea antes de cambiar las extensiones.</p>}
    {installing && <div className="extension-install-progress" role="status"><LoaderCircle size={15} className="visualizer-spinner" /><span>{installing.kind === 'skill' ? 'Instalando Skill…' : installing.transport === 'stdio' ? 'Descargando y conectando MCP…' : 'Conectando MCP…'} <strong>{installing.name}</strong></span><small>La primera conexión puede tardar un momento.</small></div>}
    {error && <div className="extension-catalog-feedback is-error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()} disabled={!!busy}>Reintentar</button></div>}
    {notice && <p className="extension-catalog-feedback" role="status">{notice}</p>}
    {loading && !entries.length && <div className="extension-catalog-empty" role="status"><LoaderCircle size={19} className="visualizer-spinner" />Cargando catálogo…</div>}
    {entries.length > 0 && <div className="extension-catalog-caption"><span>Una selección para empezar</span><small>{filtered.length} extensiones</small></div>}
    <div className="extension-catalog-grid">
      {filtered.map((entry) => {
        const ready = entry.kind === 'skill' ? entry.installed && entry.enabled : entry.installed && entry.connected;
        const actionLabel = ready ? entry.kind === 'skill' ? 'Activa' : 'Conectado'
          : entry.installed ? entry.kind === 'skill' ? 'Activar' : 'Conectar'
          : entry.kind === 'skill' ? 'Instalar' : entry.transport === 'stdio' ? 'Descargar' : 'Conectar';
        const Icon = entry.kind === 'skill' ? BookOpen : Plug;
        return <article key={entry.id} className={`extension-catalog-card${ready ? ' is-ready' : ''}`} aria-label={entry.name}>
          <div className="extension-catalog-card-top"><span className={`extension-catalog-icon is-${entry.kind}`}><Icon size={19} strokeWidth={1.6} /></span><span className="extension-catalog-kind">{entry.kind === 'skill' ? 'Skill' : 'MCP'}<span>·</span>{entry.category}</span>{ready && <Check size={14} className="extension-catalog-ready" aria-label="Lista para usar" />}</div>
          <h3>{entry.name}</h3><p>{entry.description}</p>
          <div className="extension-catalog-requirements"><span>{entry.kind === 'skill' ? 'Incluida en OrderCode' : entry.transport === 'stdio' ? 'Se ejecuta en tu equipo' : 'Servicio online'}</span></div>
          <div className="extension-catalog-card-bottom"><details><summary>{entry.publisher}<ChevronDown size={11} /></summary><div><span>{entry.version}{entry.license ? ` · ${entry.license}` : ''}</span><a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); void openExternalUrl(entry.sourceUrl).catch((cause) => setError(message(cause))); }}>Ver fuente<ExternalLink size={11} /></a><ul>{entry.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>{entry.kind === 'mcp' && <small>{entry.transport === 'stdio' ? 'Descarga y ejecuta un paquete con versión fijada en tu equipo. Sus herramientas siguen los permisos del proyecto.' : 'Conecta un servicio externo. Las consultas que autorices se envían a ese proveedor.'}</small>}</div></details><button type="button" className="extension-catalog-install" aria-label={`${actionLabel} ${entry.name}`} onClick={() => void install(entry)} disabled={!session || !!busy || loading || ready || readOnly || working}>{busy === entry.id ? <LoaderCircle size={13} className="visualizer-spinner" /> : ready ? <Check size={13} /> : <ArrowDownToLine size={13} />}{busy === entry.id ? 'Preparando…' : actionLabel}</button></div>
        </article>;
      })}
    </div>
    {!loading && entries.length > 0 && !filtered.length && <div className="extension-catalog-empty"><Search size={20} /><strong>No hay coincidencias</strong><p>Prueba otro nombre o cambia el filtro.</p><button type="button" onClick={() => { setQuery(''); setKind('all'); }}>Limpiar búsqueda</button></div>}
    {entries.length > 0 && <p className="extension-catalog-footnote">Las Skills se guardan en tu proyecto. Los MCP se conectan a herramientas externas y respetan tus permisos. Puedes gestionarlos en Instrucciones y Conexiones.</p>}
  </section></Localized>;
}
