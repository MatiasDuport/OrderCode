import { ArrowRight, Braces, ChevronDown, ChevronRight, ChevronsDownUp, Code2, FileCode2, FileJson2, FileText, Folder, FolderOpen, GitBranch, Image as ImageIcon, ListFilter, LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { IconButton } from './ui';
import { useDesktopStore } from '../lib/store';
import { createSession, gitStatus, health, pickWorkspaceFolder, readWorkspaceFile, workspaceTree } from '../lib/ipc';
import type { WorkspaceEntry } from '../lib/contracts';
import { Localized } from '../lib/localization';

interface TreeNode { path: string; name: string; kind: WorkspaceEntry['kind']; children: TreeNode[] }
interface TreeRow { node: TreeNode; level: number; parent: string }
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const auxiliaryDirectory = (name: string) => name.startsWith('.') || ['playwright-report', 'test-results', 'coverage'].includes(name);

function makeTree(entries: WorkspaceEntry[], showAuxiliary: boolean, query: string): TreeNode[] {
  const roots: TreeNode[] = [], index = new Map<string, TreeNode>();
  for (const entry of entries) {
    const parts = entry.path.replaceAll('\\', '/').split('/').filter(Boolean);
    if (!showAuxiliary && parts.some((part, i) => (i < parts.length - 1 || entry.kind === 'directory') && auxiliaryDirectory(part))) continue;
    if (query && !entry.path.toLocaleLowerCase().includes(query)) continue;
    let children = roots;
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let node = index.get(path);
      if (!node) {
        node = { path, name, kind: i === parts.length - 1 ? entry.kind : 'directory', children: [] };
        index.set(path, node); children.push(node);
      }
      children = node.children;
    });
  }
  const sort = (nodes: TreeNode[]) => { nodes.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || byName.compare(a.name, b.name)); nodes.forEach((node) => sort(node.children)); };
  sort(roots);
  return roots;
}

function FileGlyph({ name }: { name: string }) {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'].includes(extension ?? '')) return <ImageIcon className="workspace-file-icon is-style" size={14} />;
  if (extension === 'json') return <FileJson2 className="workspace-file-icon is-json" size={14} />;
  if (['css', 'scss'].includes(extension ?? '')) return <Braces className="workspace-file-icon is-style" size={14} />;
  if (['md', 'txt'].includes(extension ?? '')) return <FileText className="workspace-file-icon" size={14} />;
  return <FileCode2 className={`workspace-file-icon ${['ts', 'tsx', 'js', 'jsx', 'rs', 'py'].includes(extension ?? '') ? 'is-code' : ''}`} size={14} />;
}

export function WorkspaceSidebar({ onClose }: { onClose: () => void }) {
  const { session, runtimeState, openFile: selectedFile, set } = useDesktopStore(useShallow((state) => ({ session: state.session, runtimeState: state.runtimeState, openFile: state.openFile, set: state.set })));
  const [connecting, setConnecting] = useState(false);
  const busy = connecting || ['RUNNING', 'PREPARING', 'WAITING_APPROVAL'].includes(runtimeState);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [searchEntries, setSearchEntries] = useState<WorkspaceEntry[] | null>(null);
  const [git, setGit] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showAuxiliary, setShowAuxiliary] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedSearch, setCollapsedSearch] = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const loadedFolders = useRef(new Set<string>());
  const pendingFolders = useRef(new Set<string>());
  const treeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const openingFile = useRef(0);
  const generation = useRef(0);
  const workspaceName = session?.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Sin proyecto';
  const search = query.trim().toLocaleLowerCase();
  const tree = useMemo(() => makeTree(search ? searchEntries ?? [] : entries, showAuxiliary, search), [entries, searchEntries, showAuxiliary, search]);
  const rows = useMemo(() => {
    const result: TreeRow[] = [];
    const visit = (nodes: TreeNode[], level = 1, parent = '') => nodes.forEach((node) => {
      result.push({ node, level, parent });
      if (node.kind === 'directory' && (search ? !collapsedSearch.has(node.path) : expanded.has(node.path))) visit(node.children, level + 1, node.path);
    });
    visit(tree); return result;
  }, [tree, expanded, collapsedSearch, search]);
  const gitLines = git?.split(/\r?\n/) ?? [];
  const branch = gitLines[0]?.replace(/^## (?:No commits yet on |Initial commit on )?/, '').split('...')[0].replace(/ \[.*$/, '') || 'Git';
  const changes = gitLines.filter((line) => line && !line.startsWith('##')).length;
  const focusTarget = rows.some(({ node }) => node.path === focusedPath) ? focusedPath : rows[0]?.node.path;

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError(''); setEntries([]); setSearchEntries(null); setGit(null);
    setExpanded(new Set()); setFocusedPath(''); setLoadingFolders(new Set());
    loadedFolders.current = new Set(); pendingFolders.current = new Set();
    const [files, status] = await Promise.allSettled([workspaceTree(''), gitStatus()]);
    if (generation.current !== current) return;
    if (files.status === 'fulfilled') { setEntries(files.value); loadedFolders.current.add(''); }
    else setError(files.reason instanceof Error ? files.reason.message : String(files.reason));
    if (status.status === 'fulfilled') setGit(status.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    setQuery(''); setSearching(false);
    if (session) void reload();
    else { setEntries([]); setSearchEntries(null); setGit(null); setError(''); setLoading(false); }
    return () => { generation.current += 1; };
  }, [session?.id, session?.projectPath, reload]);

  useEffect(() => {
    if (!session || !search || loading) return;
    let current = true;
    setSearching(true); setSearchEntries(null);
    const timer = setTimeout(() => {
      void workspaceTree(undefined, showAuxiliary).then((value) => { if (current) setSearchEntries(value); })
        .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); })
        .finally(() => { if (current) setSearching(false); });
    }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [session?.id, session?.projectPath, !!search, showAuxiliary, loading]);

  const toggleFolder = async (path: string) => {
    if (search) { setCollapsedSearch((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; }); return; }
    if (expanded.has(path)) { setExpanded((current) => { const next = new Set(current); next.delete(path); return next; }); return; }
    setExpanded((current) => new Set(current).add(path));
    if (loadedFolders.current.has(path) || pendingFolders.current.has(path)) return;
    const current = generation.current;
    pendingFolders.current.add(path); setLoadingFolders(new Set(pendingFolders.current)); setError('');
    try {
      const children = await workspaceTree(path);
      if (generation.current !== current) return;
      const incoming = new Set(children.map((child) => child.path));
      setEntries((previous) => [...previous.filter((entry) => !incoming.has(entry.path)), ...children]);
      loadedFolders.current.add(path);
    } catch (cause) {
      if (generation.current !== current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setExpanded((previous) => { const next = new Set(previous); next.delete(path); return next; });
    } finally {
      if (generation.current === current) { pendingFolders.current.delete(path); setLoadingFolders(new Set(pendingFolders.current)); }
    }
  };

  const connectWorkspace = async () => {
    if (busy) return;
    const active = useDesktopStore.getState();
    if (active.editorContent !== active.editorOriginal) { setError('Guarda o descarta los cambios del editor antes de cambiar de workspace.'); return; }
    setError(''); setConnecting(true);
    try {
      const value = await pickWorkspaceFolder(session?.projectPath ?? undefined);
      if (!value) return;
      const next = await createSession({ projectPath: value, model: active.model, reasoningEffort: active.reasoningEffort, mode: active.mode, permission: active.permission, freeOnly: active.freeOnly });
      set('session', next);
      set('model', next.providerId && next.model ? `${next.providerId}::${next.model}` : next.model);
      set('freeOnly', next.freeOnly ?? false);
      set('sessions', [next, ...useDesktopStore.getState().sessions.filter((item) => item.id !== next.id)]);
      set('messages', []); set('events', []); set('runtimeState', next.state); set('streamingText', ''); set('pendingPermission', null);
      set('openFile', null); set('editorContent', ''); set('editorOriginal', '');
      set('health', await health());
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setConnecting(false); }
  };

  const openFile = async (path: string) => {
    if (!session) return;
    if (path === selectedFile) { set('reviewOpen', true); return; }
    const active = useDesktopStore.getState();
    if (active.editorContent !== active.editorOriginal) { setError('Guarda o descarta los cambios del editor antes de abrir otro archivo.'); return; }
    setError('');
    const request = ++openingFile.current, revision = active.sessionRevision;
    try {
      const data = await readWorkspaceFile(path);
      if (request !== openingFile.current || useDesktopStore.getState().sessionRevision !== revision) return;
      set('openFile', path); set('filePreview', data.kind === 'text' ? null : data);
      set('editorContent', data.content ?? ''); set('editorOriginal', data.content ?? ''); set('reviewOpen', true);
    } catch (cause) { if (request === openingFile.current && useDesktopStore.getState().sessionRevision === revision) setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const focusRow = (path?: string) => { if (path) [...(treeRef.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])].find((item) => item.dataset.path === path)?.focus(); };
  const onTreeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = rows.findIndex(({ node }) => node.path === focusTarget), row = rows[index];
    if (!row || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') focusRow(rows[Math.min(index + 1, rows.length - 1)]?.node.path);
    else if (event.key === 'ArrowUp') focusRow(rows[Math.max(0, index - 1)]?.node.path);
    else if (event.key === 'Home') focusRow(rows[0]?.node.path);
    else if (event.key === 'End') focusRow(rows.at(-1)?.node.path);
    else if (event.key === 'ArrowRight' && row.node.kind === 'directory') {
      if (search ? collapsedSearch.has(row.node.path) : !expanded.has(row.node.path)) void toggleFolder(row.node.path);
      else if (rows[index + 1]?.parent === row.node.path) focusRow(rows[index + 1].node.path);
    } else if (event.key === 'ArrowLeft') {
      if (row.node.kind === 'directory' && (search ? !collapsedSearch.has(row.node.path) : expanded.has(row.node.path))) void toggleFolder(row.node.path);
      else focusRow(row.parent);
    }
  };

  return <Localized><aside className="workspace-sidebar" aria-label="Proyecto">
    <header className="workspace-heading"><h2>Proyecto</h2><div className="workspace-panel-actions"><IconButton icon={Plus} label="Añadir proyecto" disabled={busy} onClick={() => void connectWorkspace()} /><IconButton icon={X} label="Cerrar proyecto" onClick={onClose} /></div></header>
    <button type="button" className="workspace-project" disabled={busy} onClick={() => void connectWorkspace()} title={session?.projectPath} aria-label="Cambiar proyecto"><span className="workspace-project-icon"><Code2 size={19} /></span><span className="workspace-project-copy"><strong>{connecting ? 'Conectando…' : workspaceName}</strong><small>{session ? 'Proyecto local' : 'Conecta una carpeta'}</small></span><ChevronDown size={13} className="workspace-project-caret" /></button>
    <div className="workspace-search-row"><label className="workspace-search"><Search size={14} /><input ref={searchRef} aria-label="Buscar archivos" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }} placeholder="Buscar archivos" disabled={!session} />{query && <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label="Limpiar búsqueda"><X size={12} /></button>}</label><button type="button" className={`workspace-filter ${showAuxiliary ? 'is-active' : ''}`} aria-label="Mostrar carpetas ocultas y auxiliares" title="Mostrar carpetas ocultas y auxiliares" aria-pressed={showAuxiliary} disabled={!session} onClick={() => setShowAuxiliary(!showAuxiliary)}><ListFilter size={15} /></button></div>
    <div className="workspace-files-heading"><span>{search ? 'Resultados' : 'Archivos'}</span>{!loading && session && <small>{search ? rows.filter(({ node }) => node.kind === 'file').length : tree.length}</small>}<span className="panel-title-spacer" />{search ? searching && <LoaderCircle className="workspace-spinner" size={13} /> : <IconButton icon={ChevronsDownUp} label="Contraer carpetas" disabled={!expanded.size} onClick={() => { setExpanded(new Set()); setFocusedPath(''); }} />}<IconButton icon={RefreshCw} label="Actualizar archivos" className={loading ? 'workspace-spinner' : ''} disabled={!session || loading} onClick={() => void reload()} /></div>
    {error && <div className="workspace-error" role="alert"><span>{error}</span><button type="button" aria-label="Cerrar aviso" onClick={() => setError('')}><X size={12} /></button></div>}
    <div className="workspace-tree-scroll" aria-busy={loading || (!!search && searching)}>
      {loading || (search && searching) ? <div className="workspace-loading" role="status"><LoaderCircle className="workspace-spinner" size={17} /><span>{search ? 'Buscando archivos…' : 'Cargando archivos…'}</span></div> : rows.length ? <div ref={treeRef} className="workspace-tree" role="tree" aria-label="Archivos del proyecto" onKeyDown={onTreeKey}>{rows.map(({ node, level }) => {
        const directory = node.kind === 'directory', opened = search ? !collapsedSearch.has(node.path) : expanded.has(node.path), pending = loadingFolders.has(node.path);
        return <button type="button" key={node.path} role="treeitem" data-path={node.path} aria-label={node.name} aria-level={level} aria-expanded={directory ? opened : undefined} aria-selected={selectedFile === node.path} tabIndex={focusTarget === node.path ? 0 : -1} title={node.path} className={`workspace-tree-row ${directory ? 'is-directory' : ''} ${selectedFile === node.path ? 'is-selected' : ''}`} style={{ paddingLeft: 8 + (level - 1) * 15 }} onFocus={() => setFocusedPath(node.path)} onClick={() => directory ? void toggleFolder(node.path) : void openFile(node.path)}>
          <span className="workspace-tree-caret">{directory && (pending ? <LoaderCircle className="workspace-spinner" size={12} /> : <ChevronRight size={12} className={opened ? 'is-open' : ''} />)}</span>{directory ? opened ? <FolderOpen size={14} className="workspace-folder-icon" /> : <Folder size={14} className="workspace-folder-icon" /> : <FileGlyph name={node.name} />}<span className="workspace-tree-name">{node.name}</span>
        </button>;
      })}</div> : <div className="workspace-tree-empty"><FolderOpen size={25} strokeWidth={1.3} /><strong>{!session ? 'Tu proyecto empieza aquí' : error ? 'No se pudo cargar el workspace' : search ? 'Sin archivos coincidentes' : 'Carpeta vacía'}</strong><span>{!session ? 'Conecta una carpeta para explorar sus archivos.' : search ? 'Prueba con otro nombre o ruta.' : error ? 'Actualiza para volver a intentarlo.' : 'Los archivos aparecerán aquí.'}</span>{!session && <button type="button" onClick={() => void connectWorkspace()} disabled={busy}><Plus size={13} />Abrir carpeta</button>}</div>}
      {search && (searchEntries?.length ?? 0) >= 500 && <p className="workspace-search-limit">Búsqueda limitada a 500 entradas. Explora las carpetas para ver más.</p>}
    </div>
    <button type="button" className="workspace-git" title={git ?? undefined} aria-label="Abrir control de versiones" onClick={() => { set('currentView', 'Git'); onClose(); }} disabled={!session}><GitBranch size={15} /><span className="workspace-git-branch">{session ? branch : 'Control de versiones'}</span>{session && <span className={`workspace-git-state ${git === null ? 'is-unavailable' : changes ? 'has-changes' : ''}`}><i />{git === null ? 'Sin Git' : changes ? `${changes} ${changes === 1 ? 'cambio' : 'cambios'}` : 'Sin cambios'}</span>}<ArrowRight size={13} /></button>
  </aside></Localized>;
}
