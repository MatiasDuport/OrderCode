import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Server, Trash2, X } from 'lucide-react';
import { configureMcpCredentials, connectMcpServer, deleteMcpServer, disconnectMcpServer, listMcpServers, mcpServerSecretStatus, removeMcpServerSecret, saveMcpServer, setMcpServerSecret } from '../lib/ipc';
import type { McpServer, McpServerStatus, McpTransport } from '../lib/contracts';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';

interface Draft {
  id?: string;
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  endpoint: string;
  environment: string;
  authorization: string;
  enabled: boolean;
  previousKeys: string[];
  marketplace?: McpServer['marketplace'];
}

const emptyDraft = (): Draft => ({ name: '', transport: 'stdio', command: '', args: '', endpoint: '', environment: '', authorization: '', enabled: true, previousKeys: [] });
const credentialName = /^[A-Z_][A-Z0-9_]{0,63}$/;

export function McpManager() {
  const session = useDesktopStore((state) => state.session);
  const connected = useDesktopStore((state) => state.health?.harnessConnected ?? false);
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [secretStatus, setSecretStatus] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    if (!session) { setServers([]); return; }
    setError('');
    try {
      const next = await listMcpServers(session.id);
      setServers(next);
      const statuses = await Promise.all(next.map(async ({ server }) => [server.id, await mcpServerSecretStatus(server.id, server.secretKeys)] as const));
      setSecretStatus(Object.fromEntries(statuses.map(([id, state]) => [id, Object.values(state).every(Boolean)])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    window.addEventListener('ordercode:mcp-updated', handler);
    return () => window.removeEventListener('ordercode:mcp-updated', handler);
  }, [session?.id, connected]);

  const edit = (server?: McpServer) => {
    setError(''); setNotice('');
    setDraft(server ? {
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command ?? '',
      args: server.args.join('\n'),
      endpoint: server.endpoint ?? '',
      environment: server.transport === 'stdio' ? server.secretKeys.filter((key) => key !== '__AUTHORIZATION__').map((key) => `${key}=`).join('\n') : '',
      authorization: '',
      enabled: server.enabled,
      previousKeys: [...server.secretKeys],
      marketplace: server.marketplace,
    } : emptyDraft());
  };

  const save = async () => {
    if (!session || !draft || busy) return;
    setBusy('save'); setError(''); setNotice('');
    try {
      const secrets: Record<string, string> = {};
      const envEntries = draft.transport === 'stdio' ? draft.environment.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
      for (const line of envEntries) {
        const equals = line.indexOf('=');
        const key = equals < 0 ? line : line.slice(0, equals).trim();
        const value = equals < 0 ? '' : line.slice(equals + 1);
        if (!credentialName.test(key)) throw new Error(`Nombre de variable inválido: ${key}`);
        if (value) secrets[key] = value;
      }
      if (draft.transport === 'streamable-http' && draft.authorization.trim()) secrets.__AUTHORIZATION__ = draft.authorization.trim();
      const retainedKeys = draft.previousKeys.filter((key) => draft.transport === 'streamable-http'
        ? key === '__AUTHORIZATION__'
        : key !== '__AUTHORIZATION__' && envEntries.some((line) => line.split('=', 1)[0]?.trim() === key));
      const secretKeys = [...new Set([...Object.keys(secrets), ...retainedKeys])];
      const server = await saveMcpServer({ id: draft.id, projectPath: session.projectPath, name: draft.name, transport: draft.transport, ...(draft.transport === 'stdio' ? { command: draft.command, args: draft.args.split(/\r?\n/).map((arg) => arg.trim()).filter(Boolean) } : { endpoint: draft.endpoint }), secretKeys, enabled: draft.enabled, marketplace: draft.marketplace });
      for (const key of draft.previousKeys) if (!secretKeys.includes(key)) await removeMcpServerSecret(server.id, key);
      for (const [key, value] of Object.entries(secrets)) await setMcpServerSecret(server.id, key, value);
      await configureMcpCredentials(server.id, secrets);
      await refresh();
      setDraft(null);
      setNotice(`“${server.name}” quedó guardado. Sus credenciales se almacenan de forma segura en este equipo.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const runAction = async (id: string, action: 'connect' | 'disconnect' | 'delete') => {
    if (busy) return;
    const current = servers.find((item) => item.server.id === id)?.server;
    if (!current) return;
    if (action === 'delete' && !window.confirm(`¿Eliminar “${current.name}” y sus credenciales guardadas en este equipo?`)) return;
    if (action === 'connect' && current.marketplace && !window.confirm(`OrderCode ejecutará ${current.command} ${current.args.join(' ')} en el workspace para descargar y ejecutar ${current.marketplace.packageIdentifier}@${current.marketplace.packageVersion}.\n\nPublicador: ${current.marketplace.publisher}\nRepositorio: ${current.marketplace.repository}\n\nEl servidor tendrá acceso al workspace y a las credenciales que configures. Continúa solo si confías en esta fuente.`)) return;
    setBusy(id); setError(''); setNotice('');
    try {
      if (action === 'connect') await connectMcpServer(id);
      else if (action === 'disconnect') await disconnectMcpServer(id);
      else {
        await deleteMcpServer(id);
        for (const key of current.secretKeys) await removeMcpServerSecret(id, key);
        if (draft?.id === id) setDraft(null);
      }
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  return <Localized><section className="extension-section mcp-manager">
    <div className="extension-section-heading"><strong>Servidores MCP</strong><span>{servers.filter((item) => item.connected).length} conectados</span><button type="button" className="inline-icon-button" aria-label="Actualizar servidores MCP" onClick={() => void refresh()} disabled={!session || !!busy}><RefreshCw size={13} /></button><button type="button" className="extension-add-button" onClick={() => edit()} disabled={!session || !connected || !!busy}><Plus size={12} />Agregar</button></div>
    {!session ? <div className="surface-empty extension-empty">Conecta un workspace para configurar servidores MCP.</div> : servers.length ? servers.map(({ server, connected: online, tools, error: serverError }) => <article className="mcp-server-card" key={server.id}>
      <div className="mcp-server-main"><span className={`mcp-server-icon ${online ? 'is-online' : ''}`}><Server size={14} /></span><div className="mcp-server-copy"><strong>{server.name}</strong><small>{server.transport === 'stdio' ? 'Conexión local' : 'Servicio remoto'}</small><small>{online ? `${tools.length} herramientas disponibles · protegidas por permisos` : serverError || (server.enabled ? 'Desconectado' : 'Desactivado')}</small></div><span className={`mcp-status-dot ${online ? 'is-online' : ''}`} title={online ? 'Conectado' : 'Desconectado'} /></div>
      {server.marketplace && <div className="mcp-origin"><span>Fuente oficial MCP Registry · {server.marketplace.packageIdentifier}@{server.marketplace.packageVersion}</span><small>{server.marketplace.publisher} · <a href={server.marketplace.repository} target="_blank" rel="noreferrer">Repositorio</a></small></div>}
      {online && tools.length > 0 && <details className="mcp-tool-list"><summary>Herramientas disponibles</summary>{tools.map((tool) => <div key={tool.name}><code>{tool.name}</code><small>{tool.description || 'Sin descripción'}{tool.readOnly ? ' · solo lectura' : ' · requiere aprobación reforzada'}</small></div>)}</details>}
      <div className="mcp-server-actions"><button type="button" onClick={() => edit(server)} disabled={!!busy}>Configurar</button><button type="button" onClick={() => void runAction(server.id, online ? 'disconnect' : 'connect')} disabled={!!busy || !server.enabled}>{busy === server.id ? 'Procesando…' : online ? 'Desconectar' : 'Conectar'}{!online && server.secretKeys.length > 0 && !secretStatus[server.id] ? ' · faltan credenciales' : ''}</button><button type="button" className="danger-action" onClick={() => void runAction(server.id, 'delete')} disabled={!!busy} aria-label={`Eliminar ${server.name}`}><Trash2 size={12} /></button></div>
    </article>) : <div className="surface-empty extension-empty">No hay servidores MCP configurados para este workspace.</div>}
    {draft && <div className="mcp-editor"><div className="mcp-editor-title"><strong>{draft.id ? 'Configurar servidor MCP' : 'Agregar servidor MCP'}</strong><button type="button" aria-label="Cerrar editor MCP" onClick={() => setDraft(null)}><X size={14} /></button></div>
      <label>Nombre<input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Servidor MCP" /></label>
      <label>Transporte<select value={draft.transport} onChange={(event) => setDraft({ ...draft, transport: event.target.value as McpTransport })}><option value="stdio">Proceso local (stdio)</option><option value="streamable-http">Servidor remoto (HTTPS)</option></select></label>
      {draft.transport === 'stdio' ? <><label>Ejecutable<input value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} placeholder="npx" autoComplete="off" /></label><label>Argumentos, uno por línea<textarea value={draft.args} onChange={(event) => setDraft({ ...draft, args: event.target.value })} rows={3} placeholder="-y\n@servidor/mcp" /></label><label>Variables seguras, una por línea<textarea value={draft.environment} onChange={(event) => setDraft({ ...draft, environment: event.target.value })} rows={3} placeholder="API_KEY=valor" autoComplete="off" />{draft.previousKeys.some((key) => key !== '__AUTHORIZATION__') && <small>Deja el valor vacío para conservar una credencial ya guardada. No se vuelve a mostrar.</small>}</label></> : <><label>Endpoint<input value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="https://mcp.example.com/mcp" /></label><label>Bearer token<input type="password" value={draft.authorization} onChange={(event) => setDraft({ ...draft, authorization: event.target.value })} placeholder={draft.previousKeys.includes('__AUTHORIZATION__') ? 'Deja vacío para conservar el token guardado' : 'Opcional'} autoComplete="new-password" /></label></>}
      <label className="mcp-enabled-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Habilitar al guardar</label>
      <div className="mcp-editor-actions"><button type="button" onClick={() => setDraft(null)} disabled={!!busy}>Cancelar</button><button type="button" onClick={() => void save()} disabled={!draft.name.trim() || !!busy || !connected}>{busy === 'save' ? 'Guardando…' : 'Guardar servidor'}</button></div>
    </div>}
    {error && <div className="surface-empty" role="alert">{error}</div>}{notice && <div className="surface-note" role="status">{notice}</div>}
  </section></Localized>;
}
