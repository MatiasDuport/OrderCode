import { useState } from 'react';
import { ArrowDownToLine, Search } from 'lucide-react';
import { installMcpMarketplaceEntry, searchMcpMarketplace } from '../lib/ipc';
import type { McpCatalogEntry } from '../lib/contracts';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';

export function McpMarketplace() {
  const session = useDesktopStore((state) => state.session);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<McpCatalogEntry[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const search = async () => {
    if (!session || busy) return;
    setBusy('search'); setError(''); setNotice('');
    try { setEntries(await searchMcpMarketplace(session.id, query)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const add = async (entry: McpCatalogEntry) => {
    if (!session || busy) return;
    const action = entry.updateAvailable ? 'actualizar' : entry.installedVersion ? 'reinstalar' : 'agregar';
    const confirmation = `¿Deseas ${action} ${entry.name} (${entry.packageIdentifier}@${entry.packageVersion})?\n\nOrigen: MCP Registry oficial\nPublicador: ${entry.publisher}\nRepositorio: ${entry.repository}\n\nEsto guarda su configuración. Al conectarlo, OrderCode descargará y ejecutará el paquete en el workspace. El servidor podrá acceder al workspace y a las credenciales que configures.`;
    if (!window.confirm(confirmation)) return;
    setBusy(entry.serverName); setError(''); setNotice('');
    try {
      const server = await installMcpMarketplaceEntry(session.id, entry.serverName, entry.packageVersion);
      window.dispatchEvent(new Event('ordercode:mcp-updated'));
      setNotice(`“${server.name}” se agregó al workspace. Configura las variables seguras necesarias en Servidores MCP y conecta el servidor cuando estés listo.`);
      await searchMcpMarketplace(session.id, query).then(setEntries);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  return <Localized><section className="extension-section marketplace-panel">
    <div className="marketplace-heading"><strong>Marketplace MCP</strong><span>Catálogo oficial · paquetes npm con versión fijada</span></div>
    <div className="marketplace-search"><input aria-label="Buscar servidores MCP en el Marketplace" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} placeholder="Buscar por nombre, por ejemplo filesystem" disabled={!session || !!busy} /><button type="button" onClick={() => void search()} disabled={!session || !!busy}>{busy === 'search' ? 'Buscando…' : <><Search size={12} />Buscar</>}</button></div>
    {!session && <div className="surface-empty extension-empty">Conecta un workspace para buscar e instalar servidores MCP.</div>}
    {session && !entries.length && !error && <div className="surface-empty extension-empty">Busca servidores publicados en el MCP Registry. La vista previa muestra origen, versión y repositorio antes de agregar un servidor.</div>}
    {entries.map((entry) => <article className="marketplace-card" key={`${entry.serverName}:${entry.packageIdentifier}`}>
      <div className="marketplace-card-title"><strong>{entry.name}</strong><span>{entry.installedVersion ? `Instalado ${entry.installedVersion}` : 'Disponible'}</span></div>
      <p>{entry.description}</p>
      <div className="marketplace-meta"><span>Publicador <b>{entry.publisher}</b></span><span>Servidor <code>{entry.version}</code></span><span>npm <code>{entry.packageIdentifier}@{entry.packageVersion}</code></span><span>Repositorio <code>{entry.repository}</code></span></div>
      <div className="marketplace-risk">Al conectar, el paquete se descargará y ejecutará localmente con acceso al workspace y a las credenciales configuradas.</div>
      <button type="button" className="marketplace-install" onClick={() => void add(entry)} disabled={!!busy || (!entry.updateAvailable && entry.installedVersion === entry.packageVersion)}>{busy === entry.serverName ? 'Guardando…' : <><ArrowDownToLine size={12} />{entry.updateAvailable ? `Actualizar a ${entry.packageVersion}` : entry.installedVersion ? 'Ya está actualizado' : 'Agregar al workspace'}</>}</button>
    </article>)}
    {error && <div className="surface-empty" role="alert">{error}</div>}{notice && <div className="surface-note" role="status">{notice}</div>}
  </section></Localized>;
}
