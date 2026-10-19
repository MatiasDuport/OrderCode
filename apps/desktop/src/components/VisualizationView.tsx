import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChartNoAxesCombined, FileImage, Globe, Image as ImageIcon, LoaderCircle, RefreshCw, RotateCw, Search } from 'lucide-react';
import type { HarnessEvent, WorkspaceEntry, WorkspaceFileContent } from '../lib/contracts';
import { isDesktopApp, readWorkspaceFile, workspaceTree } from '../lib/ipc';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';

const graphicExtension = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|html?)$/i;
const imageExtension = /\.(?:png|jpe?g|gif|webp|avif|bmp)$/i;

export function normalizeVisualizerUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return undefined;
  const localAddress = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(trimmed);
  const candidate = localAddress ? `http://${trimmed}` : /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    const loopback = url.hostname === 'localhost' || url.hostname === '::1' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) return undefined;
    return url.href;
  } catch { return undefined; }
}

function graphicFiles(events: HarnessEvent[], entries: WorkspaceEntry[]): string[] {
  const recent = events.slice().reverse().flatMap((event) => event.changedFiles ?? []).filter((path) => graphicExtension.test(path));
  return [...new Set([...recent, ...entries.filter((entry) => entry.kind === 'file' && graphicExtension.test(entry.path)).map((entry) => entry.path)])];
}

function svgDataUrl(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

function prepareHtml(source: string): { document: string; blockedResources: boolean } {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  let blockedResources = parsed.querySelector('script') !== null;
  parsed.querySelectorAll('base, meta[http-equiv="refresh" i]').forEach((element) => element.remove());
  parsed.querySelectorAll('script').forEach((script) => script.remove());
  parsed.querySelectorAll('iframe, frame, object, embed, link[href]').forEach((element) => { element.remove(); blockedResources = true; });
  return { document: `<!doctype html>${parsed.documentElement.outerHTML}`, blockedResources };
}

function HtmlChart({ path, source }: { path: string; source: string }) {
  const preview = useMemo(() => prepareHtml(source), [source]);
  return <div className="visualizer-html-wrap">
    {preview.blockedResources && <p className="visualizer-security-note">Vista aislada: se omitieron los scripts y recursos externos. Para ver la página interactiva, inicia su servidor local en la pestaña Web.</p>}
    <iframe className="visualizer-frame visualizer-chart-frame" title={`Gráfica ${path}`} srcDoc={preview.document} sandbox="" referrerPolicy="no-referrer" />
  </div>;
}

export function VisualizationView() {
  const { session, sessionRevision, events, language } = useDesktopStore();
  const [tab, setTab] = useState<'web' | 'graphs'>('web');
  const [urlDraft, setUrlDraft] = useState('');
  const [activeUrl, setActiveUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [reloadCount, setReloadCount] = useState(0);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [selectedFile, setSelectedFile] = useState('');
  const [selectedContent, setSelectedContent] = useState<WorkspaceFileContent | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const fileRequest = useRef(0);
  const english = language === 'en';

  const loadFiles = useCallback(async () => {
    if (!session || !isDesktopApp()) { setEntries([]); return; }
    const revision = sessionRevision;
    setFilesLoading(true); setFilesError('');
    try {
      const result = await workspaceTree(undefined, false);
      if (useDesktopStore.getState().sessionRevision === revision) setEntries(result);
    } catch (cause) {
      if (useDesktopStore.getState().sessionRevision === revision) setFilesError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (useDesktopStore.getState().sessionRevision === revision) setFilesLoading(false); }
  }, [session?.id, sessionRevision]);

  useEffect(() => {
    setEntries([]); setSelectedFile(''); setSelectedContent(null); setSelectionError('');
    void loadFiles();
  }, [loadFiles]);

  const files = useMemo(() => graphicFiles(events, entries), [events, entries]);

  const openGraphic = async (path: string) => {
    if (!session || selectionLoading) return;
    const request = ++fileRequest.current;
    const revision = sessionRevision;
    setSelectedFile(path); setSelectedContent(null); setSelectionError(''); setSelectionLoading(true);
    try {
      const file = await readWorkspaceFile(path);
      if (request === fileRequest.current && useDesktopStore.getState().sessionRevision === revision) setSelectedContent(file);
    } catch (cause) {
      if (request === fileRequest.current && useDesktopStore.getState().sessionRevision === revision) setSelectionError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (request === fileRequest.current && useDesktopStore.getState().sessionRevision === revision) setSelectionLoading(false); }
  };

  const navigate = () => {
    const next = normalizeVisualizerUrl(urlDraft);
    if (!next) { setUrlError(english ? 'Use a valid HTTPS address or a local URL such as http://localhost:5173.' : 'Usa una dirección HTTPS válida o una URL local como http://localhost:5173.'); return; }
    setUrlError(''); setUrlDraft(next); setActiveUrl(next); setReloadCount((count) => count + 1);
  };

  const isSvg = selectedFile.toLowerCase().endsWith('.svg');
  const selectedImage = selectedContent?.kind === 'image' ? selectedContent.dataUrl : isSvg && selectedContent?.kind === 'text' ? svgDataUrl(selectedContent.content ?? '') : undefined;
  const selectedHtml = selectedFile && /\.html?$/i.test(selectedFile) && selectedContent?.kind === 'text' ? selectedContent.content : undefined;

  return <Localized><div className="surface-page visualizer-page">
    <header className="surface-heading"><Globe size={19} /><div><h2>Web y gráficas</h2><p>Previsualiza sitios, proyectos web y resultados visuales de tus tareas.</p></div></header>
    <div className="visualizer-tabs" role="tablist" aria-label="Visualizador">
      <button type="button" role="tab" aria-selected={tab === 'web'} className={tab === 'web' ? 'is-active' : ''} onClick={() => setTab('web')}><Globe size={14} />Web</button>
      <button type="button" role="tab" aria-selected={tab === 'graphs'} className={tab === 'graphs' ? 'is-active' : ''} onClick={() => { setTab('graphs'); if (!entries.length && session) void loadFiles(); }}><ChartNoAxesCombined size={14} />Gráficas{files.length > 0 && <span className="visualizer-count">{files.length}</span>}</button>
    </div>
    {tab === 'web' ? <section className="visualizer-browser" aria-label="Navegador web">
      <form className="visualizer-address-bar" onSubmit={(event) => { event.preventDefault(); navigate(); }}>
        <button type="button" className="visualizer-reload" aria-label={english ? 'Reload page' : 'Recargar página'} disabled={!activeUrl} onClick={() => setReloadCount((count) => count + 1)}><RotateCw size={15} /></button>
        <Search size={14} />
        <input type="text" inputMode="url" aria-label={english ? 'Web address' : 'Dirección web'} placeholder={english ? 'https://… or http://localhost:5173' : 'https://… o http://localhost:5173'} value={urlDraft} onChange={(event) => { setUrlDraft(event.target.value); setUrlError(''); }} />
        <button type="submit" className="visualizer-go" disabled={!urlDraft.trim()}>{english ? 'Open' : 'Abrir'}</button>
      </form>
      {urlError && <p className="visualizer-security-note" role="alert">{urlError}</p>}
      {activeUrl ? <iframe key={`${activeUrl}:${reloadCount}`} className="visualizer-frame" title={english ? 'Website preview' : 'Vista previa web'} src={activeUrl} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" /> : <div className="visualizer-welcome"><span className="visualizer-welcome-icon"><Globe size={23} /></span><strong>{english ? 'Preview a website' : 'Abre una página web'}</strong><p>{english ? 'Enter a public HTTPS address or the address of a local development server.' : 'Escribe una dirección HTTPS pública o la dirección de un servidor local de desarrollo.'}</p><small>{english ? 'Some sites block embedded previews. Local websites work best through their development server.' : 'Algunos sitios bloquean las vistas integradas. Los sitios locales funcionan mejor desde su servidor de desarrollo.'}</small></div>}
    </section> : <section className="visualizer-graphs" aria-label={english ? 'Project charts' : 'Gráficas del proyecto'}>
      {filesLoading && <div className="visualizer-welcome" role="status"><LoaderCircle size={19} className="visualizer-spinner" />{english ? 'Finding visual outputs…' : 'Buscando resultados visuales…'}</div>}
      {filesError && <p className="visualizer-security-note" role="alert">{filesError}</p>}
      {!filesLoading && files.length > 0 && <div className="visualizer-file-list" aria-label={english ? 'Graph files' : 'Archivos gráficos'}>{files.map((path) => <button type="button" key={path} className={`visualizer-file${selectedFile === path ? ' is-active' : ''}`} onClick={() => void openGraphic(path)}><FileImage size={14} /><span title={path}>{path}</span>{events.some((event) => event.changedFiles?.includes(path)) && <small>{english ? 'Recent' : 'Reciente'}</small>}</button>)}</div>}
      {files.length === 0 && !filesLoading && <div className="visualizer-welcome"><span className="visualizer-welcome-icon"><ChartNoAxesCombined size={23} /></span><strong>{session ? (english ? 'No charts found in this project' : 'Aún no hay gráficas en este proyecto') : (english ? 'Open a project to find its charts' : 'Abre un proyecto para encontrar sus gráficas')}</strong><p>{english ? 'Charts saved by Python, JavaScript, R, and other tools appear here.' : 'Aquí aparecen las gráficas guardadas por Python, JavaScript, R y otras herramientas.'}</p><small>{english ? 'Ask OrderCode to save charts as PNG or SVG. For interactive content, start a local server and open it in Web.' : 'Pídele a OrderCode que guarde las gráficas en archivos PNG o SVG. Para contenido interactivo, inicia un servidor local y ábrelo en Web.'}</small>{session && <button type="button" className="visualizer-refresh" onClick={() => void loadFiles()}><RefreshCw size={13} />{english ? 'Refresh project files' : 'Actualizar archivos del proyecto'}</button>}</div>}
      {files.length > 0 && <button type="button" className="visualizer-refresh" onClick={() => void loadFiles()} disabled={filesLoading}><RefreshCw size={13} />{english ? 'Refresh files' : 'Actualizar archivos'}</button>}
      {files.length > 0 && !selectedFile && <div className="visualizer-output"><div className="visualizer-output-empty"><ChartNoAxesCombined size={22} /><strong>{english ? 'Choose a chart to preview it' : 'Elige una gráfica para verla'}</strong><small>{english ? 'Recent chart outputs appear at the top of this list.' : 'Los resultados recientes aparecen al principio de la lista.'}</small></div></div>}
      {selectedFile && <div className="visualizer-output">
        <div className="visualizer-output-heading"><ImageIcon size={14} /><code title={selectedFile}>{selectedFile}</code><span />{selectedContent?.size != null && <small>{selectedContent.size < 1024 * 1024 ? `${(selectedContent.size / 1024).toFixed(1)} KB` : `${(selectedContent.size / 1024 / 1024).toFixed(1)} MB`}</small>}</div>
        {selectionError && <div className="visualizer-output-empty" role="alert">{selectionError}</div>}
        {selectionLoading && <div className="visualizer-output-empty" role="status"><LoaderCircle size={17} className="visualizer-spinner" />{english ? 'Loading preview…' : 'Cargando vista previa…'}</div>}
        {!selectionLoading && selectedImage && <div className="visualizer-image-canvas"><img src={selectedImage} alt={`${english ? 'Chart' : 'Gráfica'}: ${selectedFile}`} /></div>}
        {!selectionLoading && selectedHtml && <HtmlChart path={selectedFile} source={selectedHtml} />}
        {!selectionLoading && selectedContent && (selectedContent.kind === 'too-large' || selectedContent.kind === 'binary' || (!selectedImage && !selectedHtml)) && <div className="visualizer-output-empty"><FileImage size={21} /><strong>{selectedContent.kind === 'too-large' ? (english ? 'File is too large to preview' : 'El archivo supera el límite de vista previa') : selectedContent.kind === 'binary' ? (english ? 'This format cannot be previewed' : 'Este formato no se puede previsualizar') : (english ? 'No preview is available' : 'No hay vista previa disponible')}</strong><small>{english ? 'Try saving the chart as PNG or SVG. For interactive content, start a local server and open it in Web.' : 'Prueba guardando la gráfica como PNG o SVG. Para contenido interactivo, inicia un servidor local y ábrelo en Web.'}</small></div>}
      </div>}
    </section>}
  </div></Localized>;
}
