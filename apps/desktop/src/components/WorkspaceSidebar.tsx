import { Code2, FileCode2, FileText, FolderOpen, GitBranch, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Divider, IconButton, Kbd, PanelTitle } from './ui';
import { useDesktopStore } from '../lib/store';
import { createSession, gitStatus, health, invokeHarnessTool, pickWorkspaceFolder, workspaceTree } from '../lib/ipc';
import type { WorkspaceEntry } from '../lib/contracts';
import { Localized } from '../lib/localization';

export function WorkspaceSidebar() {
  const { session, model, mode, permission, freeOnly, openFile: selectedFile, set } = useDesktopStore();
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [git, setGit] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const openingFile = useRef(0);
  const workspaceName = session?.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Sin workspace';
  const visibleEntries = useMemo(() => entries.filter((entry) => entry.path.toLowerCase().includes(query.trim().toLowerCase())), [entries, query]);
  useEffect(() => {
    if (!session) { setEntries([]); setGit(''); return; }
    let current = true;
    setError('');
    setEntries([]); setGit('');
    void Promise.all([workspaceTree(), gitStatus()]).then(([tree, status]) => { if (current) { setEntries(tree); setGit(status); } }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { current = false; };
  }, [session?.id, session?.projectPath]);

  const connectWorkspace = async () => {
    const active = useDesktopStore.getState();
    if (active.editorContent !== active.editorOriginal) {
      setError('Guarda o descarta los cambios del editor antes de cambiar de workspace.');
      return;
    }
    setError('');
    try {
      const value = await pickWorkspaceFolder(session?.projectPath ?? undefined);
      if (!value) return;
      const next = await createSession({ projectPath: value, model, mode, permission, freeOnly });
      set('session', next);
      set('model', next.providerId && next.model ? `${next.providerId}::${next.model}` : next.model);
      set('freeOnly', next.freeOnly ?? false);
      set('sessions', [next, ...useDesktopStore.getState().sessions.filter((item) => item.id !== next.id)]);
      set('messages', []); set('events', []); set('runtimeState', next.state); set('streamingText', ''); set('pendingPermission', null);
      set('openFile', null); set('editorContent', ''); set('editorOriginal', '');
      set('health', await health());
      setEntries(await workspaceTree()); setGit(await gitStatus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const openFile = async (path: string) => {
    if (!session) return;
    const active = useDesktopStore.getState();
    if (active.editorContent !== active.editorOriginal) {
      setError('Guarda o descarta los cambios del editor antes de abrir otro archivo.');
      return;
    }
    setError('');
    const request = ++openingFile.current;
    const revision = active.sessionRevision;
    try {
      const result = await invokeHarnessTool(session.id, 'fs.read', { path });
      if (request !== openingFile.current || useDesktopStore.getState().sessionRevision !== revision) return;
      if (result.status !== 'completed' || !result.data || typeof result.data !== 'object') throw new Error(String(result.summary ?? 'No se pudo leer el archivo.'));
      const data = result.data as Record<string, unknown>;
      if (typeof data.content !== 'string') throw new Error('El contenido no está disponible en el resultado compacto.');
      set('openFile', path); set('editorContent', data.content); set('editorOriginal', data.content); set('reviewOpen', true);
    } catch (cause) { if (request === openingFile.current && useDesktopStore.getState().sessionRevision === revision) setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <Localized><aside className="workspace-sidebar" aria-label="Workspace">
    <PanelTitle title="WORKSPACE" action={<IconButton icon={Plus} label="Añadir workspace" onClick={() => void connectWorkspace()} />} />
    <button type="button" className="workspace-root" onClick={() => void connectWorkspace()}><span className="workspace-root-icon"><Code2 size={14} /></span><span>{workspaceName}</span></button>
    <label className="file-search"><Search size={14} /><input aria-label="Buscar archivos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={session ? 'Buscar archivos...' : 'Abre un workspace'} disabled={!session} />{session && <Kbd>Ctrl P</Kbd>}</label>
    {session && visibleEntries.length ? <div className="tree tree-files" role="tree" aria-label="Archivos del proyecto">{visibleEntries.map((entry) => entry.kind === 'directory' ? <div className="tree-entry tree-entry--directory" key={entry.path} title={entry.path}><FolderOpen size={13} /><span>{entry.path}</span></div> : <button type="button" className={`tree-entry tree-entry--file ${selectedFile === entry.path ? 'is-active' : ''}`} key={entry.path} title={entry.path} onClick={() => void openFile(entry.path)}><FileCode2 size={13} /><span>{entry.path}</span></button>)}</div> : <div className="tree tree-empty" role="tree" aria-label="Archivos del proyecto"><FolderOpen size={22} /><strong>{error ? 'No se pudo cargar el workspace' : session ? 'Sin archivos coincidentes' : 'Sin workspace abierto'}</strong><span>{error || (session ? 'Prueba con otra búsqueda.' : 'Pulsa + para conectar una carpeta.')}</span></div>}
    <div className="sidebar-bottom"><Divider /><div className="git-header"><GitBranch size={13} /><strong>Git</strong><span className="panel-title-spacer" /><span className="muted">{session ? (git || 'Sin cambios') : 'Sin workspace'}</span></div><button type="button" className="sidebar-git-link" onClick={() => set('currentView', 'Git')} disabled={!session}>Abrir control de versiones</button></div>
  </aside></Localized>;
}
