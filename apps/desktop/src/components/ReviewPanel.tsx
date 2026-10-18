import { Cpu, FileCode2, Image as ImageIcon, Save, TerminalSquare, Trash2, X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { BeforeMount } from '@monaco-editor/react';
import type { WorkspaceFileContent } from '../lib/contracts';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { IconButton, StatusDot } from './ui';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';
import { closeNativeTerminal, invokeHarnessTool, loadSession, openNativeTerminal, readWorkspaceFile, resizeNativeTerminal, writeNativeTerminal } from '../lib/ipc';

const MonacoEditor = lazy(async () => {
  const [reactMonaco, monaco, languageContributions, editorWorker, jsonWorker, cssWorker, htmlWorker, tsWorker] = await Promise.all([
    import('@monaco-editor/react'),
    import('monaco-editor/editor'),
    Promise.all([
      import('monaco-editor/features/register.all'),
      import('monaco-editor/languages/features/register.all'),
      import('monaco-editor/languages/definitions/typescript/register'),
      import('monaco-editor/languages/definitions/javascript/register'),
      import('monaco-editor/languages/definitions/css/register'),
      import('monaco-editor/languages/definitions/scss/register'),
      import('monaco-editor/languages/definitions/less/register'),
      import('monaco-editor/languages/definitions/html/register'),
      import('monaco-editor/languages/definitions/markdown/register'),
      import('monaco-editor/languages/definitions/mdx/register'),
      import('monaco-editor/languages/definitions/python/register'),
      import('monaco-editor/languages/definitions/rust/register'),
      import('monaco-editor/languages/definitions/xml/register'),
      import('monaco-editor/languages/definitions/yaml/register'),
      import('monaco-editor/languages/definitions/shell/register'),
      import('monaco-editor/languages/definitions/powershell/register'),
      import('monaco-editor/languages/definitions/sql/register'),
      import('monaco-editor/languages/definitions/ini/register'),
    ]),
    import('monaco-editor/editor/editor.worker?worker'),
    import('monaco-editor/languages/features/json/json.worker?worker'),
    import('monaco-editor/languages/features/css/css.worker?worker'),
    import('monaco-editor/languages/features/html/html.worker?worker'),
    import('monaco-editor/languages/features/typescript/ts.worker?worker'),
  ]);
  void languageContributions;
  (self as typeof self & { MonacoEnvironment: { getWorker: (_moduleId: string, label: string) => Worker } }).MonacoEnvironment = {
    getWorker: (_moduleId, label) => {
      if (label === 'json') return new jsonWorker.default();
      if (['css', 'scss', 'less'].includes(label)) return new cssWorker.default();
      if (['html', 'handlebars', 'razor'].includes(label)) return new htmlWorker.default();
      if (['typescript', 'javascript'].includes(label)) return new tsWorker.default();
      return new editorWorker.default();
    },
  };
  reactMonaco.loader.config({ monaco });
  return { default: reactMonaco.default };
});

const configureMonaco: BeforeMount = (monaco) => {
  monaco.editor.defineTheme('ordercode-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '71839A', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'C792EA' },
      { token: 'string', foreground: 'B8D99A' },
      { token: 'number', foreground: 'F2B880' },
    ],
    colors: {
      'editor.background': '#0A0F15', 'editor.foreground': '#C5D0DF',
      'editorLineNumber.foreground': '#526174', 'editorLineNumber.activeForeground': '#BDFB62',
      'editorCursor.foreground': '#BDFB62', 'editor.selectionBackground': '#36465D',
      'editor.lineHighlightBackground': '#111923', 'editorIndentGuide.background1': '#202B39',
      'editorIndentGuide.activeBackground1': '#53657A', 'editorWidget.background': '#111923',
    },
  });
  monaco.editor.defineTheme('ordercode-light', {
    base: 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: '68788E', fontStyle: 'italic' },
      { token: 'keyword', foreground: '7151BA' },
      { token: 'string', foreground: '28713F' },
      { token: 'number', foreground: '925A15' },
    ],
    colors: {
      'editor.background': '#F8FAFD', 'editor.foreground': '#17202E',
      'editorLineNumber.foreground': '#78879B', 'editorLineNumber.activeForeground': '#4F7812',
      'editorCursor.foreground': '#4F7812', 'editor.selectionBackground': '#C9D8EE',
      'editor.lineHighlightBackground': '#EEF3F8', 'editorIndentGuide.background1': '#DCE4EF',
      'editorIndentGuide.activeBackground1': '#9AABC1', 'editorWidget.background': '#FFFFFF',
      'editorWidget.border': '#C7D2E0',
    },
  });
};

function editorLanguage(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  const languages: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    json: 'json', jsonc: 'json', md: 'markdown', mdx: 'markdown', py: 'python', rs: 'rust',
    html: 'html', css: 'css', scss: 'scss', less: 'less', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', sql: 'sql', toml: 'ini',
  };
  return extension ? languages[extension] ?? 'plaintext' : 'plaintext';
}

function lineDiff(before: string, after: string): string[] {
  const oldLines = before.split('\n'); const newLines = after.split('\n');
  let prefix = 0; while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0; while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;
  const removed = oldLines.slice(prefix, oldLines.length - suffix); const added = newLines.slice(prefix, newLines.length - suffix);
  return [...oldLines.slice(0, prefix).map((line) => `  ${line}`), ...removed.map((line) => `- ${line}`), ...added.map((line) => `+ ${line}`), ...(suffix ? oldLines.slice(-suffix).map((line) => `  ${line}`) : [])];
}

function FilePreview({ path, file }: { path: string; file: WorkspaceFileContent }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const image = file.kind === 'image' && !!file.dataUrl;
  const changeZoom = (delta: number) => setZoom((current) => Math.max(.25, Math.min(4, (current ?? 1) + delta)));
  return <Localized><section className="editor-panel file-preview" aria-label={`Vista previa: ${path}`}>
    <div className="editor-toolbar">{image ? <ImageIcon size={14} /> : <FileCode2 size={14} />}<code title={path}>{path}</code><span className="panel-title-spacer" />{image && <><IconButton icon={ZoomOut} label="Reducir imagen" disabled={zoom === .25} onClick={() => changeZoom(-.25)} /><span className="image-preview-scale">{zoom === null ? 'Ajustar' : `${Math.round(zoom * 100)}%`}</span><IconButton icon={ZoomIn} label="Ampliar imagen" disabled={zoom === 4} onClick={() => changeZoom(.25)} /><IconButton icon={Maximize2} label="Ajustar imagen" onClick={() => setZoom(null)} /></>}</div>
    {image && !failed ? <div className="image-preview-canvas"><div className={`image-preview-stage ${zoom === null ? 'is-fit' : ''}`} style={zoom !== null ? { width: dimensions.width * zoom + 48, height: dimensions.height * zoom + 48 } : undefined}><img src={file.dataUrl} alt={`Vista previa: ${path}`} draggable={false} style={zoom !== null ? { width: dimensions.width * zoom, height: dimensions.height * zoom } : undefined} onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} /></div></div> : <div className="file-preview-unavailable"><FileCode2 size={30} strokeWidth={1.4} /><strong>{failed ? 'No se pudo mostrar la imagen' : file.kind === 'too-large' ? 'Archivo demasiado grande' : 'Archivo binario'}</strong><p>{failed ? 'El archivo no es una imagen válida o usa un formato no compatible.' : file.kind === 'too-large' ? 'Este archivo supera el límite de vista previa.' : 'Este tipo de archivo no se puede editar como texto.'}</p></div>}
    <div className="file-preview-metadata"><span>{image ? file.mimeType : 'Solo lectura'}</span>{dimensions.width > 0 && <span>{dimensions.width} × {dimensions.height} px</span>}<span>{file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</span></div>
  </section></Localized>;
}

function Editor() {
  const { session, openFile, filePreview, editorContent, editorOriginal, editorFontSize, tabSize, theme, set } = useDesktopStore();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty = editorContent !== editorOriginal;
  const save = async () => {
    if (!session || !openFile || filePreview || !dirty || saving) return;
    const revision = useDesktopStore.getState().sessionRevision;
    const isCurrent = () => useDesktopStore.getState().sessionRevision === revision && useDesktopStore.getState().openFile === openFile;
    setSaving(true); setError('');
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(editorOriginal));
      const expectedSha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const result = await invokeHarnessTool(session.id, 'fs.write', { path: openFile, content: editorContent, expectedSha256 });
      if (!isCurrent()) return;
      const pending = result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>).permissionRequest : undefined;
      if (pending && typeof pending === 'object') {
        set('pendingPermission', pending as Record<string, unknown>); set('runtimeState', 'WAITING_APPROVAL');
        return;
      }
      if (result.status !== 'completed') throw new Error(String(result.summary ?? 'No se pudo guardar el archivo.'));
      set('editorOriginal', editorContent);
      const saved = await loadSession(session.id);
      if (!isCurrent()) return;
      set('events', saved.events);
      set('session', saved.session);
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  if (!openFile) return <Localized><div className="editor-empty"><FileCode2 size={20} /><span>Selecciona un archivo del workspace para revisarlo o editarlo.</span></div></Localized>;
  if (filePreview) return <FilePreview key={openFile} path={openFile} file={filePreview} />;
  return <Localized><section className="editor-panel"><div className="editor-toolbar"><FileCode2 size={13} /><code title={openFile}>{openFile}</code><span className="panel-title-spacer" />{dirty && <span className="editor-dirty">Sin guardar</span>}<button type="button" disabled={!dirty || saving} onClick={() => void save()}><Save size={12} />{saving ? 'Guardando…' : 'Guardar'}</button><button type="button" disabled={!dirty} onClick={() => set('editorContent', editorOriginal)} aria-label="Descartar cambios"><Trash2 size={12} /></button></div><div className="monaco-editor-shell" role="region" aria-label={`Editor de código: ${openFile}`}><Suspense fallback={<div className="editor-loading">Cargando editor…</div>}><MonacoEditor key={openFile} language={editorLanguage(openFile)} theme={theme === 'light' ? 'ordercode-light' : 'ordercode-dark'} value={editorContent} beforeMount={configureMonaco} onChange={(value) => set('editorContent', value ?? '')} options={{ automaticLayout: true, minimap: { enabled: false }, fontFamily: 'JetBrains Mono Variable, Consolas, monospace', fontSize: editorFontSize, lineNumbers: 'on', renderLineHighlight: 'gutter', scrollBeyondLastLine: false, wordWrap: 'off', tabSize, insertSpaces: true, padding: { top: 8, bottom: 8 } }} /></Suspense></div>{error && <div className="editor-error" role="alert">{error}</div>}</section></Localized>;
}

export function ReviewPanel({ onClose }: { onClose: () => void }) {
  const { events, openFile, filePreview, editorOriginal, editorContent, session, set } = useDesktopStore();
  const [selectionError, setSelectionError] = useState('');
  const selectionRequest = useRef(0);
  const files = [...new Set(events.flatMap((event) => event.changedFiles ?? []))];
  const latestDiff = useMemo(() => [...events].reverse().find((event) => event.diff && (!openFile || event.changedFiles?.includes(openFile)))?.diff, [events, openFile]);
  const diff = filePreview ? undefined : dirtyText(editorOriginal, editorContent) ? lineDiff(editorOriginal, editorContent).join('\n') : latestDiff;
  const selectFile = async (file: string) => {
    if (!session) return;
    const active = useDesktopStore.getState();
    if (active.editorContent !== active.editorOriginal) {
      setSelectionError('Guarda o descarta los cambios del editor antes de abrir otro archivo.');
      return;
    }
    setSelectionError('');
    const request = ++selectionRequest.current;
    const revision = active.sessionRevision;
    try {
      const data = await readWorkspaceFile(file);
      if (request !== selectionRequest.current || useDesktopStore.getState().sessionRevision !== revision) return;
      set('openFile', file); set('filePreview', data.kind === 'text' ? null : data); set('editorContent', data.content ?? ''); set('editorOriginal', data.content ?? '');
    } catch (cause) { if (request === selectionRequest.current && useDesktopStore.getState().sessionRevision === revision) setSelectionError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <Localized><aside className="review-panel" aria-label="Revisión de cambios">
    <div className="review-header"><strong>{filePreview?.kind === 'image' ? 'Vista previa' : !files.length && openFile ? 'Archivo' : 'Revisión'}</strong>{files.length > 0 && <span className="change-count">{files.length}</span>}<span className="panel-title-spacer" /><IconButton icon={X} label="Cerrar revisión" onClick={onClose} /></div>
    {files.length ? <div className="diff-files">{files.map((file) => <button className={`diff-file ${openFile === file ? 'is-active' : ''}`} type="button" key={file} onClick={() => void selectFile(file)}><FileCode2 size={14} /><span>{file}</span></button>)}</div> : !openFile && <div className="diff-empty"><FileCode2 size={22} /><strong>No hay cambios de agente</strong><p>Los cambios escritos por el runtime se mostrarán aquí con su diff guardado.</p></div>}
    {selectionError && <div className="editor-error" role="alert">{selectionError}</div>}
    {diff && <pre className="diff-preview" aria-label="Diff de cambios">{diff.split('\n').map((line, index) => <span className={line.startsWith('+') ? 'diff-added' : line.startsWith('-') ? 'diff-removed' : ''} key={`${index}:${line}`}>{line || ' '}</span>)}</pre>}
    <Editor />
  </aside></Localized>;
}

function dirtyText(before: string, after: string): boolean { return before !== after; }

export function TerminalPanel() {
  const { session, health, events, terminalSessions, terminalBuffers, activeTerminalId, terminalFontSize, theme, set } = useDesktopStore();
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'Terminal' | 'Processes' | 'Problems' | 'Output'>('Terminal');
  const [processClock, setProcessClock] = useState(Date.now());
  const [opening, setOpening] = useState(false);
  const [shell, setShell] = useState('default');
  const terminalHost = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<{ id: string; terminal: Terminal; fit: FitAddon; disposeInput: { dispose(): void } } | null>(null);
  const visibleTerminals = terminalSessions.filter((item) => item.sessionId === session?.id);
  const selectedTerminal = visibleTerminals.find((item) => item.terminalId === activeTerminalId) ?? visibleTerminals[0];
  const terminalEvents = events.filter((event) => event.terminalOutput || event.summary.startsWith('process.exec'));
  const problems = events.filter((event) => event.state === 'FAILED' && event.detail);
  const output = terminalEvents.map((event) => event.terminalOutput || String(event.detail ?? '')).filter(Boolean).join('\n');
  const canOpen = !!session && session.mode !== 'Plan' && session.permission !== 'Lectura' && !!health?.harnessConnected;
  const terminalPalette = theme === 'light'
    ? { background: '#f5f7fb', foreground: '#243247', cursor: '#4f7812', selectionBackground: '#c9d8ee' }
    : { background: '#0a0f15', foreground: '#c5d0df', cursor: '#bdfb62', selectionBackground: '#36465d' };

  useEffect(() => {
    if (tab !== 'Processes') return;
    const timer = window.setInterval(() => setProcessClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  useEffect(() => {
    if (!health?.harnessConnected) return;
    let unlistenOutput: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;
    let active = true;
    void listen<{ terminalId: string; sessionId: string; data: string }>('terminal-output', (event) => {
      const { terminalId, data } = event.payload;
      const state = useDesktopStore.getState();
      const prior = state.terminalBuffers[terminalId] ?? '';
      state.set('terminalBuffers', { ...state.terminalBuffers, [terminalId]: `${prior}${data}`.slice(-120_000) });
      if (terminalInstance.current?.id === terminalId) terminalInstance.current.terminal.write(data);
    }).then((unlisten) => { if (active) unlistenOutput = unlisten; else unlisten(); }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    void listen<{ terminalId: string; sessionId: string; code: number; success: boolean }>('terminal-exit', (event) => {
      const { terminalId, code } = event.payload;
      const state = useDesktopStore.getState();
      state.set('terminalSessions', state.terminalSessions.map((item) => item.terminalId === terminalId ? { ...item, exitCode: code, endedAt: Date.now() } : item));
    }).then((unlisten) => { if (active) unlistenExit = unlisten; else unlisten(); }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { active = false; unlistenOutput?.(); unlistenExit?.(); };
  }, [health?.harnessConnected]);

  useEffect(() => {
    const host = terminalHost.current;
    const current = terminalInstance.current;
    if (current && current.id !== selectedTerminal?.terminalId) {
      current.disposeInput.dispose(); current.terminal.dispose(); terminalInstance.current = null;
    }
    if (!host || !selectedTerminal || terminalInstance.current?.id === selectedTerminal.terminalId) return;
    let active = true;
    let terminal: Terminal | undefined;
    let disposeInput: { dispose(): void } | undefined;
    let observer: ResizeObserver | undefined;
    void Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/xterm/css/xterm.css'),
    ]).then(([xterm, fitAddon]) => {
      if (!active) return;
      terminal = new xterm.Terminal({
        allowProposedApi: false, convertEol: true, cursorBlink: true, fontSize: terminalFontSize,
        fontFamily: 'JetBrains Mono Variable, Consolas, monospace', scrollback: 3000,
        theme: terminalPalette,
      });
      const fit = new fitAddon.FitAddon(); terminal.loadAddon(fit); terminal.open(host);
      const initialBuffer = useDesktopStore.getState().terminalBuffers[selectedTerminal.terminalId];
      if (initialBuffer) terminal.write(initialBuffer);
      disposeInput = terminal.onData((data) => {
        if (session) void writeNativeTerminal(session.id, selectedTerminal.terminalId, data).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
      });
      terminalInstance.current = { id: selectedTerminal.terminalId, terminal, fit, disposeInput };
      const resize = () => {
        if (!host.clientWidth || !host.clientHeight) return;
        try { fit.fit(); void resizeNativeTerminal(selectedTerminal.sessionId, selectedTerminal.terminalId, terminal!.cols, terminal!.rows).catch(() => undefined); } catch { /* The host can be between layout passes. */ }
      };
      observer = new ResizeObserver(resize); observer.observe(host); requestAnimationFrame(resize);
      terminal.focus();
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      active = false;
      observer?.disconnect();
      disposeInput?.dispose();
      terminal?.dispose();
      if (terminalInstance.current?.id === selectedTerminal.terminalId) terminalInstance.current = null;
    };
  }, [selectedTerminal?.terminalId, session?.id]);

  useEffect(() => {
    const current = terminalInstance.current;
    if (!current) return;
    current.terminal.options.fontSize = terminalFontSize;
    requestAnimationFrame(() => { try { current.fit.fit(); } catch { /* The terminal may be between layout passes. */ } });
  }, [terminalFontSize]);

  useEffect(() => {
    const current = terminalInstance.current;
    if (current) current.terminal.options.theme = terminalPalette;
  }, [theme]);

  const openTerminal = async () => {
    if (!session || !canOpen || opening) return;
    setOpening(true); setError('');
    try {
      const result = await invokeHarnessTool(session.id, 'desktop.terminal.open', { shell });
      const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
      const pending = data.permissionRequest;
      if (pending && typeof pending === 'object') { set('pendingPermission', pending as Record<string, unknown>); set('runtimeState', 'WAITING_APPROVAL'); return; }
      if (result.status !== 'completed') throw new Error(String(result.summary ?? 'El Harness rechazó abrir la terminal.'));
      if (typeof data.authorizationId !== 'string') throw new Error('El Harness no devolvió una autorización de terminal válida.');
      const opened = { ...await openNativeTerminal(session.id, session.projectPath, data.authorizationId, shell), startedAt: Date.now() };
      const state = useDesktopStore.getState();
      set('terminalSessions', [...state.terminalSessions, opened]); set('activeTerminalId', opened.terminalId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setOpening(false); }
  };
  const closeTerminal = async (terminalId: string) => {
    if (!session) return;
    setError('');
    try {
      await closeNativeTerminal(session.id, terminalId);
      const state = useDesktopStore.getState();
      const remaining = state.terminalSessions.filter((item) => item.terminalId !== terminalId);
      const buffers = { ...state.terminalBuffers }; delete buffers[terminalId];
      set('terminalSessions', remaining); set('terminalBuffers', buffers);
      if (state.activeTerminalId === terminalId) set('activeTerminalId', remaining.find((item) => item.sessionId === session.id)?.terminalId ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const displayed = tab === 'Problems' ? problems.map((event) => String(event.detail ?? '')).join('\n') : output;
  const shellOptions = health?.platform === 'windows' ? [['default', 'PowerShell'], ['powershell', 'PowerShell'], ['cmd', 'Command Prompt']] : health?.platform === 'macos' ? [['default', 'Shell del sistema'], ['zsh', 'Zsh'], ['bash', 'Bash']] : [['default', 'Shell del sistema'], ['bash', 'Bash'], ['zsh', 'Zsh']];
  return <Localized><section className="terminal-panel"><div className="terminal-tabs">{(['Terminal', 'Processes', 'Problems', 'Output'] as const).map((item) => <button className={`terminal-tab ${tab === item ? 'is-active' : ''}`} type="button" key={item} onClick={() => setTab(item)}>{item === 'Terminal' && <TerminalSquare size={13} />}{item === 'Processes' && <Cpu size={13} />}{item}{item === 'Processes' && <span>{visibleTerminals.filter((process) => process.exitCode === undefined).length}</span>}{item === 'Problems' && <span>{problems.length}</span>}</button>)}<span className="panel-title-spacer" /><StatusDot color={visibleTerminals.some((item) => item.exitCode === undefined) ? 'green' : 'muted'} /><span className="muted">{visibleTerminals.filter((item) => item.exitCode === undefined).length} shells</span></div>
    {tab === 'Terminal' ? <><div className="terminal-session-bar"><div className="terminal-session-tabs">{visibleTerminals.map((item) => <div className={`terminal-session-tab ${selectedTerminal?.terminalId === item.terminalId ? 'is-active' : ''}`} key={item.terminalId}><button type="button" onClick={() => set('activeTerminalId', item.terminalId)}>{item.shell}{item.pid ? ` · ${item.pid}` : ''}{item.exitCode !== undefined ? ` · ${item.exitCode}` : ''}</button><button type="button" aria-label={`Cerrar terminal ${item.shell}`} onClick={() => void closeTerminal(item.terminalId)}>×</button></div>)}</div><span className="panel-title-spacer" /><select aria-label="Shell" value={shell} onChange={(event) => setShell(event.target.value)} disabled={!canOpen || opening}>{shellOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button type="button" className="terminal-new-button" onClick={() => void openTerminal()} disabled={!canOpen || opening}>{opening ? 'Abriendo…' : '+ Terminal'}</button></div><div className="terminal-xterm-host" ref={terminalHost} style={{ display: selectedTerminal ? 'block' : 'none' }} />{!selectedTerminal && <div className="terminal-empty"><strong>{session ? 'Terminal PTY interactiva' : 'Sin workspace activo'}</strong><span>{session ? 'Abre un shell para ejecutar comandos con entrada, salida y tamaño reales.' : 'Conecta un workspace para usar una terminal.'}</span><small>Los comandos se ejecutan en el workspace y están sujetos al perfil de permisos.</small></div>}</> : tab === 'Processes' ? <div className="terminal-process-list">{visibleTerminals.length ? visibleTerminals.map((process) => { const startedAt = process.startedAt ?? 0; const elapsed = Math.max(0, (process.endedAt ?? processClock) - startedAt); return <article className="terminal-process-row" key={process.terminalId}><Cpu size={14} /><div className="terminal-process-main"><strong>{process.shell}</strong><code>{process.pid ? `PID ${process.pid}` : 'PID no disponible'}</code><small title={process.cwd}>{process.cwd}</small></div><span className={`terminal-process-state ${process.exitCode === undefined ? 'is-running' : ''}`}>{process.exitCode === undefined ? 'ACTIVO' : `SALIDA ${process.exitCode}`}</span><small className="terminal-process-duration">{startedAt ? `${Math.floor(elapsed / 60_000)}m ${Math.floor(elapsed % 60_000 / 1_000)}s` : 'Duración no disponible'}</small>{process.exitCode === undefined && <button type="button" onClick={() => void closeTerminal(process.terminalId)} disabled={!session}>Terminar</button>}</article>; }) : <div className="terminal-empty"><strong>No hay procesos de terminal</strong><span>Las sesiones PTY que abras aparecerán aquí con su PID, carpeta, estado y duración.</span></div>}<p className="terminal-process-note">Se muestran shells administrados por OrderCode; los procesos externos y recursos del sistema no están incluidos.</p></div> : <div className={`terminal-output ${displayed ? '' : 'terminal-output--empty'}`}><code>{displayed || (tab === 'Problems' ? 'No hay diagnósticos de ejecuciones recientes.' : 'No hay salida de comandos guardada.')}</code></div>}
    {error && <div className="terminal-error" role="alert">{error}</div>}<div className="terminal-footer"><span>{tab === 'Processes' ? `${visibleTerminals.length} procesos administrados` : `${terminalEvents.length} comandos de una sola ejecución`}</span><span className="panel-title-spacer" /><span>{selectedTerminal?.cwd ?? session?.projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'sin workspace'}</span></div></section></Localized>;
}
