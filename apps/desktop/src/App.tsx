import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Activity, BookOpen, Bot, Code2, FolderOpen, GitBranch, Moon, PanelLeftClose, PanelLeftOpen, Puzzle, Server, Sun } from 'lucide-react';
import { ChatPanel } from './components/ChatPanel';
import { listen } from '@tauri-apps/api/event';
const CodeGraphView = lazy(() => import('./components/CodeGraphView').then((module) => ({ default: module.CodeGraphView })));
const AgentStudio = lazy(() => import('./components/AgentStudio').then((module) => ({ default: module.AgentStudio })));
const McpManager = lazy(() => import('./components/McpManager').then((module) => ({ default: module.McpManager })));
const McpMarketplace = lazy(() => import('./components/McpMarketplace').then((module) => ({ default: module.McpMarketplace })));
const SkillsManager = lazy(() => import('./components/SkillsManager').then((module) => ({ default: module.SkillsManager })));
const CommandPalette = lazy(() => import('./components/Overlays').then((module) => ({ default: module.CommandPalette })));
const ApprovalDialog = lazy(() => import('./components/Overlays').then((module) => ({ default: module.ApprovalDialog })));
import { NavRail } from './components/NavRail';
import { StatusBar } from './components/StatusBar';
const ReviewPanel = lazy(() => import('./components/ReviewPanel').then((module) => ({ default: module.ReviewPanel })));
const TerminalPanel = lazy(() => import('./components/ReviewPanel').then((module) => ({ default: module.TerminalPanel })));
import { TopBar } from './components/TopBar';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { activateSession, cancelSession, configureVercelDeployHook, invokeHarnessTool, isDesktopApp, listSessions, loadSession, openNativeTerminal, removeVercelDeployHook, resolvePermission, searchCode, searchCodeGraph, startHarness, vercelDeployHookStatus } from './lib/ipc';
import { useDesktopStore } from './lib/store';
import { followSessionOperation, watchSessionExecution } from './lib/sessionExecution';
import { checkForUpdates, downloadUpdate, initializeUpdater, installUpdate, reportUpdateProgress } from './lib/updater';
import { Localized } from './lib/localization';
const SettingsView = lazy(() => import('./components/SettingsView').then((module) => ({ default: module.SettingsView })));
const UsageOverview = lazy(() => import('./components/UsageOverview').then((module) => ({ default: module.UsageOverview })));
import type { SessionRecord } from './lib/contracts';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react';
import './styles.css';
import './workbench-theme.css';

const agents = [
  { id: 'general', name: 'General', detail: 'Coordina el trabajo y responde consultas generales.' },
  { id: 'explore', name: 'Explore', detail: 'Investiga el repositorio y reúne evidencias sin modificar archivos.' },
  { id: 'architect', name: 'Architect', detail: 'Analiza estructura, límites y opciones técnicas.' },
  { id: 'build', name: 'Build', detail: 'Implementa cambios autorizados y verifica su resultado.' },
  { id: 'debug', name: 'Debug', detail: 'Reproduce fallos y rastrea sus causas.' },
  { id: 'qa', name: 'QA', detail: 'Comprueba criterios de aceptación y casos límite.' },
  { id: 'security', name: 'Security', detail: 'Revisa rutas, permisos, secretos y efectos externos.' },
  { id: 'review', name: 'Review', detail: 'Revisa diffs, errores y regresiones.' },
];

function timeLabel(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }

function CodeSurface() {
  const session = useDesktopStore((state) => state.session);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ name: string; kind: string; path: string; line: number; excerpt?: string; source?: 'ripgrep' | 'fts5' }>>([]);
  const [graph, setGraph] = useState<Awaited<ReturnType<typeof searchCodeGraph>> | null>(null);
  const [activeTab, setActiveTab] = useState<'search' | 'graph'>('search');
  const [error, setError] = useState('');
  const [graphLoading, setGraphLoading] = useState(false);
  const runSearch = async () => {
    if (!session || !query.trim()) return;
    setError('');
    try { setActiveTab('search'); setResults(await searchCode(session.id, query)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const runGraph = async () => {
    if (!session) return;
    setError('');
    setGraphLoading(true);
    try { setGraph(await searchCodeGraph(session.id, query)); setActiveTab('graph'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setGraphLoading(false); }
  };
  const openGraph = () => { if (!session) return; setActiveTab('graph'); if (!graph || graph.query !== query.trim()) void runGraph(); };
  return <Localized><div className={`surface-page code-surface ${activeTab === 'graph' ? 'code-surface--graph' : ''}`}>
    <div className="surface-heading"><Code2 size={18} /><div><h2>Inteligencia de código</h2><p>Análisis sintáctico local, búsqueda con ripgrep y respaldo FTS5; relaciones persistentes.</p></div></div>
    <div className="code-search"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void (activeTab === 'graph' ? runGraph() : runSearch()); }} placeholder={session ? 'Buscar funciones, clases o archivos…' : 'Conecta un workspace para buscar'} disabled={!session} aria-label="Buscar símbolos" /><button type="button" onClick={() => void runSearch()} disabled={!session || !query.trim()}>Buscar</button><button type="button" onClick={() => void runGraph()} disabled={!session}>{graphLoading ? 'Indexando…' : 'Abrir grafo'}</button></div>
    <div className="code-index-tabs"><button type="button" className={activeTab === 'search' ? 'is-active' : ''} onClick={() => setActiveTab('search')}>Símbolos y texto</button><button type="button" className={activeTab === 'graph' ? 'is-active' : ''} disabled={!session} onClick={openGraph}>Grafo</button></div>
    {error && <p className="inline-error">{error}</p>}
    {activeTab === 'graph' ? graph ? <Suspense fallback={<div className="code-graph-loading" role="status">Cargando grafo…</div>}><CodeGraphView graph={graph} loading={graphLoading} onRefresh={() => void runGraph()} /></Suspense> : <div className="code-graph-loading" role="status"><span className="code-graph-loading-spinner" />{graphLoading ? 'Indexando archivos y preparando relaciones…' : 'Preparando grafo…'}</div> : results.length ? <div className="surface-list">{results.map((item) => <div className="surface-row" key={`${item.path}:${item.line}:${item.name}`}><strong>{item.name}</strong><span>{item.kind === 'text' ? ('Texto' + (item.source ? ' · ' + item.source : '')) : item.kind}</span><small>{item.path}:{item.line}</small>{item.excerpt && <code className="code-search-excerpt">{item.excerpt}</code>}</div>)}</div> : <div className="surface-empty">{session ? 'Escribe una consulta para buscar símbolos y texto del proyecto.' : 'Conecta un workspace para iniciar una búsqueda local.'}</div>}
  </div></Localized>;
}

function toolText(result: Record<string, unknown>): string {
  const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
  return typeof data.stdout === 'string' ? data.stdout : '';
}

function parseGitChanges(output: string): Array<{ code: string; path: string }> {
  const entries = output.split('\0');
  const changes: Array<{ code: string; path: string }> = [];
  for (let index = 1; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (path) changes.push({ code, path });
    if (code.includes('R') || code.includes('C')) index += 1;
  }
  return changes;
}

function GitSurface() {
  const { session, set } = useDesktopStore();
  const [status, setStatus] = useState('');
  const [changes, setChanges] = useState<Array<{ code: string; path: string }>>([]);
  const [unstagedDiff, setUnstagedDiff] = useState('');
  const [stagedDiff, setStagedDiff] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [remotes, setRemotes] = useState<Array<{ name: string; url: string }>>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedRemote, setSelectedRemote] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const currentBranch = branches.find((branch) => branch.startsWith('* '))?.slice(2).trim() ?? '';
  const canWrite = !!session && session.mode !== 'Plan' && session.permission !== 'Lectura';

  const refresh = async () => {
    if (!session) return;
    setError('');
    try {
      const [statusResult, unstagedResult, stagedResult, branchesResult, historyResult, remotesResult] = await Promise.all([
        invokeHarnessTool(session.id, 'git.status', {}),
        invokeHarnessTool(session.id, 'git.diff', { staged: false }),
        invokeHarnessTool(session.id, 'git.diff', { staged: true }),
        invokeHarnessTool(session.id, 'git.branches', {}),
        invokeHarnessTool(session.id, 'git.history', { limit: 25 }),
        invokeHarnessTool(session.id, 'git.remotes', {}),
      ]);
      const failure = [statusResult, unstagedResult, stagedResult, branchesResult].find((item) => item.status !== 'completed');
      if (failure) throw new Error(String(failure.summary ?? 'No se pudo consultar el estado Git.'));
      const statusParts = toolText(statusResult).split('\0');
      setStatus(statusParts[0] ?? '');
      setChanges(parseGitChanges(toolText(statusResult)));
      setUnstagedDiff(toolText(unstagedResult));
      setStagedDiff(toolText(stagedResult));
      setBranches(toolText(branchesResult).split(/\r?\n/).filter(Boolean));
      setHistory(historyResult.status === 'completed' ? toolText(historyResult).split(/\r?\n/).filter(Boolean) : []);
      const nextRemotes = toolText(remotesResult).split(/\r?\n/).filter(Boolean).map((line) => { const [name, ...urlParts] = line.split('\t'); return { name: name ?? '', url: urlParts.join('\t') }; }).filter((item) => item.name && item.url);
      setRemotes(nextRemotes);
      if (!selectedRemote && nextRemotes.length) setSelectedRemote(nextRemotes.find((item) => item.name === 'origin')?.name ?? nextRemotes[0]!.name);
      if (!selectedBranch) setSelectedBranch(currentBranch || toolText(branchesResult).split(/\r?\n/).find((item) => item.startsWith('* '))?.slice(2).trim() || '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  useEffect(() => { void refresh(); }, [session?.id, session?.updatedAt, session?.state]);

  const runGitAction = async (name: string, input: Record<string, unknown>) => {
    if (!session || busy) return;
    setBusy(name); setError('');
    try {
      const result = await invokeHarnessTool(session.id, name, input);
      const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
      if (data.permissionRequest && typeof data.permissionRequest === 'object') {
        set('pendingPermission', data.permissionRequest as Record<string, unknown>);
        set('runtimeState', 'WAITING_APPROVAL');
        return;
      }
      if (result.status !== 'completed') throw new Error(String(result.summary ?? `Falló ${name}.`));
      if (name === 'git.commit') setCommitMessage('');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const changed = changes;
  const stageAll = () => void runGitAction('git.stage', { all: true });
  const unstageAll = () => void runGitAction('git.unstage', { all: true });

  return <Localized><div className="surface-page git-surface">
    <div className="surface-heading"><GitBranch size={18} /><div><h2>Git</h2><p>Revisa y administra cambios locales con autorización del Harness.</p></div><button type="button" className="surface-refresh" onClick={() => void refresh()} disabled={!session || !!busy}>Actualizar</button></div>
    {!session ? <div className="surface-empty">Conecta un workspace para usar Git.</div> : <>
      <div className="git-toolbar"><span className="git-branch-label"><GitBranch size={13} />{currentBranch || 'Sin rama activa'}</span><select aria-label="Cambiar rama" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}><option value="">Seleccionar rama…</option>{branches.map((branch) => { const name = branch.replace(/^\*\s*/, '').trim(); return <option key={name} value={name}>{name}</option>; })}</select><button type="button" disabled={!canWrite || !selectedBranch || selectedBranch === currentBranch || !!busy} onClick={() => void runGitAction('git.branch.switch', { name: selectedBranch })}>Cambiar</button><input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="Nueva rama" aria-label="Nombre de nueva rama" maxLength={240} /><button type="button" disabled={!canWrite || !newBranch.trim() || !!busy} onClick={() => void runGitAction('git.branch.create', { name: newBranch.trim() }).then(() => setNewBranch(''))}>Crear rama</button></div>
      <div className="git-changes-heading"><strong>Cambios</strong><span>{changed.length} archivo{changed.length === 1 ? '' : 's'}</span><span className="panel-title-spacer" /><button type="button" disabled={!canWrite || !changed.length || !!busy} onClick={stageAll}>Preparar todos</button><button type="button" disabled={!canWrite || !stagedDiff || !!busy} onClick={unstageAll}>Quitar preparación</button></div>
      <pre className="git-output git-status-output">{status || 'El repositorio está limpio.'}</pre>
      {changed.length > 0 && <div className="git-file-list">{changed.map((file) => { const staged = file.code[0] !== ' ' && file.code[0] !== '?'; const unstaged = file.code[1] !== ' ' || file.code === '??'; return <div className="git-file-row" key={`${file.code}:${file.path}`}><code>{file.code}</code><span title={file.path}>{file.path}</span>{unstaged && <button type="button" aria-label={`Preparar ${file.path}`} disabled={!canWrite || !!busy} onClick={() => void runGitAction('git.stage', { paths: [file.path] })}>Preparar</button>}{staged && <button type="button" aria-label={`Quitar preparación de ${file.path}`} disabled={!canWrite || !!busy} onClick={() => void runGitAction('git.unstage', { paths: [file.path] })}>Quitar</button>}</div>; })}</div>}
      <div className="git-diff-grid"><section><h3>Sin preparar</h3><pre className="git-output git-diff-output">{unstagedDiff || 'No hay cambios sin preparar.'}</pre></section><section><h3>Preparados</h3><pre className="git-output git-diff-output">{stagedDiff || 'No hay cambios preparados.'}</pre></section></div>
      <div className="git-commit-row"><input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} maxLength={500} placeholder="Mensaje del commit" aria-label="Mensaje del commit" /><button type="button" disabled={!canWrite || !commitMessage.trim() || !stagedDiff || !!busy} onClick={() => void runGitAction('git.commit', { message: commitMessage.trim() })}>{busy === 'git.commit' ? 'Creando…' : 'Crear commit'}</button><select aria-label="Destino remoto" value={selectedRemote} onChange={(event) => setSelectedRemote(event.target.value)}><option value="">Seleccionar remoto…</option>{remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name} · {remote.url}</option>)}</select><button type="button" disabled={!canWrite || !currentBranch || !selectedRemote || !!busy} onClick={() => { const remote = remotes.find((item) => item.name === selectedRemote); if (remote) void runGitAction('git.push', { remote: remote.name, branch: currentBranch, destination: remote.url }); }}>Publicar rama</button></div>
      <section className="git-history"><h3>Historial reciente</h3>{history.length ? history.map((line, index) => { const [hash, date, author, subject] = line.split('\u001f'); return <div className="git-history-row" key={`${hash}:${index}`}><code>{hash?.slice(0, 8)}</code><strong>{subject || line}</strong><span>{author}{date ? ` · ${new Date(date).toLocaleDateString()}` : ''}</span></div>; }) : <p className="surface-empty">Todavía no hay commits en este repositorio.</p>}</section>
    </>}
    {error && <div className="surface-empty" role="alert">{error}</div>}
    {!canWrite && session && <p className="surface-note">Las operaciones de escritura requieren Build o Auto y un perfil que permita solicitar autorización.</p>}
  </div></Localized>;
}

function ReleaseSurface() {
  const { session, set, events } = useDesktopStore();
  const [branch, setBranch] = useState('');
  const [clean, setClean] = useState(false);
  const [remotes, setRemotes] = useState<Array<{ name: string; url: string }>>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [remoteName, setRemoteName] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  const [command, setCommand] = useState('');
  const [verification, setVerification] = useState('NOT_RUN');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [deployHookDraft, setDeployHookDraft] = useState('');
  const [deployHookConfigured, setDeployHookConfigured] = useState(false);
  const [deployHookBusy, setDeployHookBusy] = useState(false);
  const canWrite = !!session && session.mode !== 'Plan' && session.permission !== 'Lectura';
  const readyToTag = !!session && !!branch && clean;
  const readyToPublish = readyToTag && !!remoteName;
  const latestDeploy = events.slice().reverse().find((event) => event.summary.startsWith('release.deploy'));

  useEffect(() => {
    if (!session) { setDeployHookConfigured(false); return; }
    void vercelDeployHookStatus(session.projectPath).then(setDeployHookConfigured).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [session?.id]);

  const saveDeployHook = async () => {
    const value = deployHookDraft.trim();
    if (!value || deployHookBusy || !session) return;
    setDeployHookBusy(true); setError('');
    try { await configureVercelDeployHook(session.projectPath, value); setDeployHookConfigured(true); setDeployHookDraft(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setDeployHookBusy(false); }
  };

  const removeDeployHook = async () => {
    if (deployHookBusy || !session) return;
    setDeployHookBusy(true); setError('');
    try { await removeVercelDeployHook(session.projectPath); setDeployHookConfigured(false); setDeployHookDraft(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setDeployHookBusy(false); }
  };

  const refresh = async () => {
    if (!session) return;
    setError('');
    try {
      const [statusResult, remotesResult, tagsResult] = await Promise.all([
        invokeHarnessTool(session.id, 'git.status', {}),
        invokeHarnessTool(session.id, 'git.remotes', {}),
        invokeHarnessTool(session.id, 'git.tags', {}),
      ]);
      if (statusResult.status !== 'completed') throw new Error(String(statusResult.summary ?? 'No se pudo consultar Git.'));
      const rawStatus = toolText(statusResult);
      const statusHeader = rawStatus.split('\0')[0] ?? '';
      const currentBranch = statusHeader.replace(/^##\s*/, '').split('...')[0]?.replace(/\s+\[.*$/, '') ?? '';
      setBranch(currentBranch);
      setClean(parseGitChanges(rawStatus).length === 0);
      const nextRemotes = toolText(remotesResult).split(/\r?\n/).filter(Boolean).map((line) => { const [name, ...urlParts] = line.split('\t'); return { name: name ?? '', url: urlParts.join('\t') }; }).filter((item) => item.name && item.url);
      setRemotes(nextRemotes);
      setTags(tagsResult.status === 'completed' ? toolText(tagsResult).split(/\r?\n/).filter(Boolean) : []);
      if (!remoteName && nextRemotes.length) setRemoteName(nextRemotes.find((item) => item.name === 'origin')?.name ?? nextRemotes[0]!.name);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  useEffect(() => { void refresh(); }, [session?.id, session?.updatedAt, session?.state]);

  const runAction = async (name: string, input: Record<string, unknown>) => {
    if (!session || busy) return;
    setBusy(name); setError('');
    if (name === 'process.exec') { setVerification('RUNNING'); setOutput(''); }
    try {
      const result = await invokeHarnessTool(session.id, name, input);
      const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
      if (data.permissionRequest && typeof data.permissionRequest === 'object') {
        set('pendingPermission', data.permissionRequest as Record<string, unknown>);
        set('runtimeState', 'WAITING_APPROVAL');
        return;
      }
      if (name === 'process.exec') {
        setOutput([data.stdout, data.stderr].filter((part): part is string => typeof part === 'string' && !!part).join('\n'));
        setVerification(result.status === 'completed' ? 'PASS' : 'FAIL');
      }
      if (name === 'release.deploy') {
        const job = data.job && typeof data.job === 'object' ? data.job as Record<string, unknown> : data;
        setOutput(`Vercel aceptó el trabajo ${String(job.jobId ?? job.id ?? 'sin identificador')} · ${String(job.state ?? 'estado desconocido')}. El build sigue en Vercel.`);
        const saved = await loadSession(session.id);
        set('events', saved.events);
        set('session', saved.session);
      }
      if (result.status !== 'completed') throw new Error(String(result.summary ?? `Falló ${name}.`));
      if (name === 'git.tag.create') { setTagName(''); setTagMessage(''); }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      if (name === 'process.exec') setVerification('FAIL');
    } finally { setBusy(''); }
  };

  const selectedRemote = remotes.find((item) => item.name === remoteName);
  return <Localized><div className="surface-page release-surface">
    <div className="surface-heading"><GitBranch size={18} /><div><h2>Centro de versiones</h2><p>Verifica el estado local y prepara tags y publicaciones con autorización explícita.</p></div><button type="button" className="surface-refresh" onClick={() => void refresh()} disabled={!session || !!busy}>Actualizar</button></div>
    {!session ? <div className="surface-empty">Conecta un workspace para preparar una versión.</div> : <>
      <div className="release-checks">
        <div className="release-check"><span className={branch ? 'is-pass' : 'is-fail'}>{branch ? 'PASS' : 'FAIL'}</span><strong>Rama</strong><small>{branch || 'No hay una rama disponible.'}</small></div>
        <div className="release-check"><span className={clean ? 'is-pass' : 'is-warn'}>{clean ? 'PASS' : 'WARN'}</span><strong>Workspace limpio</strong><small>{clean ? 'Sin cambios sin confirmar.' : 'Confirma o revisa los cambios antes de crear el tag.'}</small></div>
        <div className="release-check"><span className={remotes.length ? 'is-pass' : 'is-warn'}>{remotes.length ? 'PASS' : 'WARN'}</span><strong>Destino remoto</strong><small>{selectedRemote?.url || 'No hay un remoto de publicación configurado.'}</small></div>
        <div className="release-check"><span className={verification === 'PASS' ? 'is-pass' : verification === 'FAIL' ? 'is-fail' : 'is-muted'}>{verification}</span><strong>Verificación</strong><small>{verification === 'NOT_RUN' ? 'Ejecuta un comando de comprobación para registrar evidencia.' : verification === 'RUNNING' ? 'El comando sigue ejecutándose.' : 'Resultado del último comando ejecutado.'}</small></div>
      </div>
      <div className="release-actions"><label><span>Comando de comprobación</span><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Ej.: pnpm test" aria-label="Comando de verificación" /></label><button type="button" disabled={!canWrite || !command.trim() || !!busy} onClick={() => void runAction('process.exec', { command: command.trim(), timeoutMs: 600000 })}>{busy === 'process.exec' ? 'Ejecutando…' : 'Ejecutar comprobación'}</button></div>
      {output && <pre className="git-output release-output">{output}</pre>}
      <div className="release-actions release-tag-actions"><label><span>Tag</span><input value={tagName} onChange={(event) => setTagName(event.target.value)} maxLength={240} placeholder="v1.0.0" aria-label="Nombre de tag" /></label><label><span>Mensaje</span><input value={tagMessage} onChange={(event) => setTagMessage(event.target.value)} maxLength={500} placeholder="Release 1.0.0" aria-label="Mensaje del tag" /></label><button type="button" disabled={!canWrite || !readyToTag || !tagName.trim() || !tagMessage.trim() || !!busy} onClick={() => void runAction('git.tag.create', { name: tagName.trim(), message: tagMessage.trim() })}>Crear tag anotado</button><select aria-label="Tag para publicar" value={tags.includes(tagName) ? tagName : ''} onChange={(event) => setTagName(event.target.value)}><option value="">Tags locales…</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select><button type="button" disabled={!canWrite || !readyToPublish || !tags.includes(tagName) || !!busy} onClick={() => { if (selectedRemote) void runAction('git.tag.push', { remote: selectedRemote.name, tag: tagName, destination: selectedRemote.url }); }}>Publicar tag</button></div>
      {tags.length > 0 && <div className="release-tags"><strong>Tags locales</strong>{tags.slice(0, 10).map((tag) => <button type="button" key={tag} onClick={() => setTagName(tag)}>{tag}</button>)}</div>}
      <section className="release-deploy-panel"><div className="release-deploy-heading"><strong>Despliegue en Vercel</strong><span className={deployHookConfigured ? 'is-pass' : 'is-muted'}>{deployHookConfigured ? 'CREDENCIAL GUARDADA' : 'SIN CONFIGURAR'}</span></div><p>La URL del Deploy Hook se guarda en el almacén seguro del sistema y activa la rama configurada en Vercel. Asegúrate de haber publicado el commit local antes de activarlo.</p><div className="release-actions"><label><span>URL secreta del Deploy Hook</span><input type="password" autoComplete="new-password" value={deployHookDraft} onChange={(event) => setDeployHookDraft(event.target.value)} placeholder={deployHookConfigured ? 'Hook guardado; se puede reemplazar' : 'https://api.vercel.com/v1/integrations/deploy/…'} aria-label="URL secreta del Deploy Hook" /></label><button type="button" onClick={() => void saveDeployHook()} disabled={!deployHookDraft.trim() || deployHookBusy || !session}>{deployHookBusy ? 'Guardando…' : 'Guardar Hook'}</button>{deployHookConfigured && <button type="button" onClick={() => void removeDeployHook()} disabled={deployHookBusy}>Eliminar</button>}</div><button type="button" className="release-deploy-button" onClick={() => void runAction('release.deploy', {})} disabled={!canWrite || !readyToTag || !deployHookConfigured || !!busy}>{busy === 'release.deploy' ? 'Solicitando autorización…' : 'Activar despliegue remoto'}</button>{latestDeploy && <div className="release-deploy-result"><strong>{latestDeploy.summary}</strong><small>{latestDeploy.detail ?? 'Vercel recibió la solicitud; consulta el panel de Vercel para el resultado del build.'}</small></div>}</section>
    </>}
    {error && <div className="surface-empty" role="alert">{error}</div>}
    {!canWrite && session && <p className="surface-note">Las operaciones de Release requieren Build o Auto y un perfil que permita solicitar autorización.</p>}
  </div></Localized>;
}

function ExtensionsSurface() {
  const session = useDesktopStore((state) => state.session);
  const [activeTab, setActiveTab] = useState<'skills' | 'mcps'>('skills');
  const [loadedTabs, setLoadedTabs] = useState({ skills: true, mcps: false });
  const activateTab = (tab: 'skills' | 'mcps') => {
    setActiveTab(tab);
    setLoadedTabs((loaded) => loaded[tab] ? loaded : { ...loaded, [tab]: true });
  };
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const currentIndex = tabs.indexOf(event.currentTarget);
    let nextIndex: number;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else return;
    event.preventDefault();
    tabs[nextIndex]?.focus();
    activateTab(nextIndex === 0 ? 'skills' : 'mcps');
  };

  return <Localized><div className="surface-page extension-surface">
    <div className="surface-heading"><Puzzle size={18} /><div><h2>Extensiones</h2><p>Agrega y administra Skills y servidores MCP del workspace.</p></div></div>
    <div className="extension-tabs" role="tablist" aria-label="Tipos de extensiones">
      <button id="extensions-tab-skills" type="button" role="tab" aria-selected={activeTab === 'skills'} aria-controls="extensions-panel-skills" tabIndex={activeTab === 'skills' ? 0 : -1} className={activeTab === 'skills' ? 'is-active' : ''} onClick={() => activateTab('skills')} onKeyDown={handleTabKeyDown}>
        <span className="extension-tab-icon"><BookOpen size={15} /></span><span className="extension-tab-copy"><strong>Skills</strong><small>Instrucciones reutilizables del proyecto</small></span>
      </button>
      <button id="extensions-tab-mcps" type="button" role="tab" aria-selected={activeTab === 'mcps'} aria-controls="extensions-panel-mcps" tabIndex={activeTab === 'mcps' ? 0 : -1} className={activeTab === 'mcps' ? 'is-active' : ''} onClick={() => activateTab('mcps')} onKeyDown={handleTabKeyDown}>
        <span className="extension-tab-icon"><Server size={15} /></span><span className="extension-tab-copy"><strong>MCPs</strong><small>Servidores, herramientas y catálogo</small></span>
      </button>
    </div>
    <section id="extensions-panel-skills" className="extension-tab-panel" role="tabpanel" aria-labelledby="extensions-tab-skills" tabIndex={0} hidden={activeTab !== 'skills'}>
      {loadedTabs.skills && <Suspense fallback={<div className="surface-empty" role="status">Cargando Skills…</div>}><SkillsManager sessionId={session?.id} /></Suspense>}
    </section>
    <section id="extensions-panel-mcps" className="extension-tab-panel" role="tabpanel" aria-labelledby="extensions-tab-mcps" tabIndex={0} hidden={activeTab !== 'mcps'}>
      {loadedTabs.mcps && <Suspense fallback={<div className="surface-empty" role="status">Cargando MCPs…</div>}><McpManager /><McpMarketplace /></Suspense>}
    </section>
  </div></Localized>;
}

function Surface({ view, onSelectSession, onOpenSettings }: { view: string; onSelectSession: (session: SessionRecord) => void; onOpenSettings: () => void }) {
  const { sessions, session, set, events } = useDesktopStore();
  const [activityTab, setActivityTab] = useState<'usage' | 'events'>('usage');
  const usageRefreshKey = events.slice().reverse().find((event) => event.summary === 'run.completed' || event.summary === 'run.failed' || event.state === 'CANCELLED')?.id;
  if (view === 'Sessions') return <Localized><div className="surface-page"><div className="surface-heading"><Activity size={18} /><div><h2>Sesiones</h2><p>Sesiones guardadas en la base local del Harness.</p></div></div>{sessions.length ? <div className="surface-list">{sessions.map((item) => <button type="button" className={`surface-row surface-row--button ${item.id === session?.id ? 'is-active' : ''}`} key={item.id} onClick={() => onSelectSession(item)}><strong>{item.projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Sesión'}</strong><span>{item.mode} · {item.state.toLowerCase()}</span><small>{timeLabel(item.updatedAt ?? item.createdAt)}</small></button>)}</div> : <div className="surface-empty">No hay sesiones guardadas. Conecta un workspace para empezar.</div>}</div></Localized>;
  if (view === 'Agents') return <Suspense fallback={<div className="surface-empty" role="status">Cargando agentes…</div>}><AgentStudio officialAgents={agents} /></Suspense>;
  if (view === 'Extensions') return <ExtensionsSurface />;
  if (view === 'Settings') return <Suspense fallback={<div className="surface-empty" role="status">Cargando ajustes…</div>}><SettingsView onOpenWorkspace={onOpenSettings} /></Suspense>;
  if (view === 'Code Intelligence') return <CodeSurface />;
  if (view === 'Git') return <GitSurface />;
  if (view === 'Release Center') return <ReleaseSurface />;
  if (view === 'Activity') return <Localized><div className="surface-page activity-page"><div className="surface-heading"><Activity size={18} /><div><h2>Actividad</h2><p>Uso de modelos, ahorro estimado y eventos del Harness.</p></div></div><div className="activity-tabs" role="tablist" aria-label="Actividad del Harness"><button type="button" role="tab" aria-selected={activityTab === 'usage'} className={activityTab === 'usage' ? 'is-active' : ''} onClick={() => setActivityTab('usage')}>Uso y ahorro</button><button type="button" role="tab" aria-selected={activityTab === 'events'} className={activityTab === 'events' ? 'is-active' : ''} onClick={() => setActivityTab('events')}>Eventos de sesión</button></div>{activityTab === 'usage' ? <Suspense fallback={<div className="surface-empty" role="status">Cargando métricas…</div>}><UsageOverview sessions={sessions} activeSession={session} refreshKey={usageRefreshKey} /></Suspense> : events.length ? <div className="surface-list">{events.slice().reverse().map((event) => <div className="surface-row" key={event.id}><strong>{event.summary}</strong><span>{event.state}</span><small>{event.detail ?? event.runId ?? `Evento ${event.sequence}`}</small></div>)}</div> : <div className="surface-empty">Sin eventos guardados para la sesión activa.</div>}</div></Localized>;
  return <Localized><div className="empty-surface"><span className="empty-icon"><FolderOpen size={24} /></span><h2>{view}</h2><p>Conecta un workspace para abrir esta superficie.</p></div></Localized>;
}

export default function App() {
  const { theme, themePreference, language, density, reducedMotion, currentView, sidebarOpen, reviewOpen, terminalOpen, runtimeState, pendingPermission, session, set } = useDesktopStore();
  const terminalSessions = useDesktopStore((state) => state.terminalSessions);
  const autoCheckUpdates = useDesktopStore((state) => state.autoCheckUpdates);
  const sessionRevision = useDesktopStore((state) => state.sessionRevision);
  const executing = runtimeState === 'RUNNING' || runtimeState === 'PREPARING';
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [bootstrapError, setBootstrapError] = useState('');
  const openingSession = useRef(0);
  const resolvingPermission = useRef<string | null>(null);
  useEffect(() => {
    if (!session || !executing) return;
    return watchSessionExecution(session.id, sessionRevision);
  }, [session?.id, sessionRevision, executing]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    root.dataset.reducedMotion = String(reducedMotion);
    root.lang = language === 'system' ? (navigator.language.toLowerCase().startsWith('en') ? 'en' : 'es') : language;
  }, [theme, density, reducedMotion, language]);
  useEffect(() => {
    if (themePreference !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => useDesktopStore.setState({ theme: media.matches ? 'light' : 'dark' });
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [themePreference]);
  useEffect(() => {
    let mounted = true;
    const handleViewportChange = () => { if (window.innerWidth <= 960) set('sidebarOpen', false); };
    window.addEventListener('resize', handleViewportChange);
    void startHarness().then((value) => {
      if (!mounted) return;
      set('health', value);
      return listSessions().then(async (items) => {
        if (!mounted) return;
        set('sessions', items);
        const candidate = items[0];
        if (candidate) await openSession(candidate);
      });
    }).catch((error) => { if (mounted) setBootstrapError(error instanceof Error ? error.message : String(error)); });
    handleViewportChange();
    return () => { mounted = false; window.removeEventListener('resize', handleViewportChange); };
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let mounted = true;
    let checkTimer = 0;
    void initializeUpdater().then((available) => {
      if (mounted && autoCheckUpdates && available) checkTimer = window.setTimeout(() => { void checkForUpdates().catch(() => undefined); }, 10_000);
    });
    const interval = autoCheckUpdates ? window.setInterval(() => {
      const update = useDesktopStore.getState().updateView;
      if (!['checking', 'downloading', 'installing'].includes(update.phase)) void checkForUpdates().catch(() => undefined);
    }, 6 * 60 * 60 * 1000) : undefined;
    return () => { mounted = false; window.clearTimeout(checkTimer); if (interval !== undefined) window.clearInterval(interval); };
  }, [autoCheckUpdates]);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<{ downloadedBytes: number; contentLength: number | null; complete: boolean }>('ordercode-update-progress', (event) => reportUpdateProgress(event.payload)).then((stop) => {
      if (cancelled) stop(); else unlisten = stop;
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  const navigateTo = (view: string) => {
    set('currentView', view);
    if (window.innerWidth <= 960) set('sidebarOpen', false);
  };

  const handleUpdateAction = () => {
    const update = useDesktopStore.getState().updateView;
    if (update.phase === 'available') void downloadUpdate().catch(() => undefined);
    else if (update.phase === 'downloaded') void installUpdate().catch(() => undefined);
    else void checkForUpdates().catch(() => undefined);
  };

  const openSession = async (item: SessionRecord) => {
    try {
      const active = useDesktopStore.getState();
      if (active.session?.id !== item.id && active.editorContent !== active.editorOriginal) {
        setBootstrapError('Guarda o descarta los cambios del editor antes de cambiar de sesión.');
        return;
      }
      const request = ++openingSession.current;
      if (active.session?.id !== item.id) useDesktopStore.setState({ sessionRevision: active.sessionRevision + 1 });
      const data = await loadSession(item.id);
      if (request !== openingSession.current) return;
      await activateSession(item);
      if (request !== openingSession.current) return;
      set('session', data.session);
      set('streamingText', '');
      set('openFile', null); set('editorContent', ''); set('editorOriginal', '');
      set('model', data.session.providerId && data.session.model ? `${data.session.providerId}::${data.session.model}` : data.session.model);
      set('freeOnly', data.session.freeOnly ?? false);
      set('mode', data.session.mode);
      set('permission', data.session.permission);
      set('runtimeState', data.pendingPermissions.length ? 'WAITING_APPROVAL' : data.session.state);
      set('messages', data.messages.map((message) => ({ id: message.id, role: message.role, content: message.content, timestamp: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })));
      set('events', data.events);
      set('pendingPermission', data.pendingPermissions[0] ?? null);
      set('currentView', 'Workspace');
    } catch (error) { setBootstrapError(error instanceof Error ? error.message : String(error)); }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); setCommandPaletteOpen(true); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); set('currentView', 'Workspace'); document.querySelector<HTMLTextAreaElement>('[aria-label="Mensaje para OrderCode"]')?.focus(); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'd') { event.preventDefault(); set('reviewOpen', !useDesktopStore.getState().reviewOpen); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); set('terminalOpen', !useDesktopStore.getState().terminalOpen); }
      if (event.key === 'Escape') {
        setCommandPaletteOpen(false);
        const active = useDesktopStore.getState();
        if (active.session && ['RUNNING', 'PREPARING'].includes(active.runtimeState)) void cancelSession(active.session.id).catch((error) => setBootstrapError(String(error)));
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const approvePermission = async (decision: 'reject' | 'once' | 'session' | 'project') => {
    const pending = useDesktopStore.getState().pendingPermission;
    if (!pending || typeof pending.id !== 'string' || typeof pending.sessionId !== 'string' || resolvingPermission.current) return;
    const sessionId = pending.sessionId;
    const revision = useDesktopStore.getState().sessionRevision;
    const isCurrent = () => useDesktopStore.getState().sessionRevision === revision && useDesktopStore.getState().session?.id === sessionId;
    resolvingPermission.current = pending.id;
    set('runtimeState', 'PREPARING');
    set('streamingText', '');
    try {
      let openedTerminal: Awaited<ReturnType<typeof openNativeTerminal>> | undefined;
      await followSessionOperation(sessionId, async () => {
      await resolvePermission(pending.id as string, decision);
      if (decision !== 'reject' && !pending.runId && typeof pending.toolName === 'string' && pending.arguments && typeof pending.arguments === 'object') {
        const result = await invokeHarnessTool(sessionId, pending.toolName, pending.arguments as Record<string, unknown>);
        if (result.status !== 'completed') throw new Error(String(result.summary ?? 'La operación autorizada no se completó.'));
        const current = useDesktopStore.getState();
        const args = pending.arguments as Record<string, unknown>;
        if (pending.toolName === 'desktop.terminal.open') {
          const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
          if (typeof data.authorizationId !== 'string') throw new Error('El Harness no devolvió una autorización de terminal válida.');
          const savedSession = await loadSession(sessionId);
          openedTerminal = { ...await openNativeTerminal(sessionId, savedSession.session.projectPath, data.authorizationId, typeof args.shell === 'string' ? args.shell : 'default'), startedAt: Date.now() };
        }
        if (isCurrent() && pending.toolName === 'fs.write' && typeof args.content === 'string' && typeof args.path === 'string' && current.openFile === args.path) {
          set('editorContent', args.content);
          set('editorOriginal', args.content);
        }
      }
      });
      if (openedTerminal) {
        const currentTerminals = useDesktopStore.getState().terminalSessions;
        set('terminalSessions', [...currentTerminals, openedTerminal]);
        set('terminalOpen', true);
      }
    } catch (error) {
      if (isCurrent()) {
        setBootstrapError(error instanceof Error ? error.message : String(error));
        try {
          const saved = await loadSession(sessionId);
          if (isCurrent()) { set('pendingPermission', saved.pendingPermissions[0] ?? null); set('runtimeState', saved.pendingPermissions.length ? 'WAITING_APPROVAL' : saved.session.state); }
        } catch { if (isCurrent()) set('runtimeState', 'FAILED'); }
      }
    } finally { resolvingPermission.current = null; }
  };

  const systemReducedMotion = useReducedMotion();
  const motionDisabled = reducedMotion || systemReducedMotion;
  const isApproval = runtimeState === 'WAITING_APPROVAL' && !!pendingPermission;
  return <MotionConfig reducedMotion={motionDisabled ? 'always' : 'never'} transition={{ duration: motionDisabled ? 0 : .2, ease: [.2, .7, .2, 1] }}><div className="app-shell"><TopBar onToggleSidebar={() => set('sidebarOpen', !sidebarOpen)} onToggleTerminal={() => set('terminalOpen', !terminalOpen)} onCommandPalette={() => setCommandPaletteOpen(true)} onOpenWorkspace={() => { set('currentView', 'Workspace'); set('sidebarOpen', true); }} onSettings={() => navigateTo('Settings')} onUpdateAction={handleUpdateAction} /><div className="app-body"><NavRail active={currentView} onSelect={navigateTo} /><AnimatePresence initial={false}>{sidebarOpen && <motion.div className="sidebar-motion" initial={motionDisabled ? false : { width: 0, opacity: 0 }} animate={{ width: 240, opacity: 1 }} exit={{ width: 0, opacity: 0 }}><WorkspaceSidebar /></motion.div>}</AnimatePresence><div className="work-stack"><section className={`work-area ${reviewOpen ? 'has-review' : ''}`}>
    <motion.div className="view-transition" key={currentView} initial={motionDisabled ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
    {currentView === 'Workspace' ? <ChatPanel onOpenReview={() => set('reviewOpen', true)} onOpenSettings={() => set('currentView', 'Settings')} /> : <Surface view={currentView} onSelectSession={openSession} onOpenSettings={() => set('currentView', 'Workspace')} />}
    </motion.div>
    {reviewOpen && <Suspense fallback={<div className="surface-empty" role="status">Cargando revisión…</div>}><ReviewPanel onClose={() => set('reviewOpen', false)} /></Suspense>}
  </section><div className={`terminal-dock ${terminalOpen ? '' : 'is-closed'}`}>{(terminalOpen || terminalSessions.length > 0) && <Suspense fallback={null}><TerminalPanel /></Suspense>}</div></div></div><StatusBar />{bootstrapError && <div className="bootstrap-alert" role="status"><span>{bootstrapError}</span><button type="button" onClick={() => setBootstrapError('')}>Cerrar</button></div>}<Localized><div className="theme-switch"><button type="button" className={theme === 'dark' ? 'is-active' : ''} onClick={() => set('theme', 'dark')} aria-label="Tema oscuro"><Moon size={13} /></button><button type="button" className={theme === 'light' ? 'is-active' : ''} onClick={() => set('theme', 'light')} aria-label="Tema claro"><Sun size={13} /></button></div></Localized>{commandPaletteOpen && <Suspense fallback={null}><CommandPalette open onClose={() => setCommandPaletteOpen(false)} onAction={(action) => { setCommandPaletteOpen(false); if (action === 'Workspace') navigateTo('Workspace'); else if (action === 'Review') set('reviewOpen', true); else if (action === 'Terminal') set('terminalOpen', true); else navigateTo(action); }} /></Suspense>}{isApproval && <Suspense fallback={null}><ApprovalDialog request={pendingPermission} onReject={() => void approvePermission('reject')} onApprove={(decision) => void approvePermission(decision)} /></Suspense>}<Localized><div className="mobile-panel-toggle"><button type="button" onClick={() => set('sidebarOpen', !sidebarOpen)} aria-label="Alternar sidebar">{sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button></div></Localized></div></MotionConfig>;
}
