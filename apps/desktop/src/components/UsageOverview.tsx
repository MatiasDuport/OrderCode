import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CalendarDays, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { loadUsageAnalytics } from '../lib/ipc';
import { useDesktopStore } from '../lib/store';
import type { SessionRecord, UsageAnalytics } from '../lib/contracts';

type Range = 7 | 30 | 90 | 0;
type UsagePoint = UsageAnalytics['points'][number];

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDays(count: number): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (count - index - 1));
    return dayKey(date);
  });
}

function dayOrdinal(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function shortProjectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

export function UsageOverview({ sessions, activeSession, refreshKey }: { sessions: SessionRecord[]; activeSession: SessionRecord | null; refreshKey?: string }) {
  const language = useDesktopStore((state) => state.language);
  const english = language === 'en' || (language === 'system' && typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('en'));
  const locale = english ? 'en-US' : 'es-ES';
  const copy = english ? {
    title: 'Usage & savings', subtitle: 'OrderCode activity and model usage for your workspace.', project: 'Workspace', period: 'Period', allSessions: 'All sessions', allModels: 'All models', refresh: 'Refresh usage', days: 'Days since first activity', activeDays: 'days with model calls', first: 'First recorded call', consumed: 'Provider reported tokens', input: 'Input', output: 'Output', cache: 'Cached (included in input)', tracked: 'complete usage reports', legacy: 'from older run summaries', saved: 'Estimated tokens saved', savedHint: 'Context removed before sending to the model', savingsRate: 'estimated reduction', coverage: 'tracked savings estimates', chart: 'Daily tokens', chartHint: 'Reported usage and estimated context savings', heatmap: 'Work days', heatmapHint: 'Days with at least one model call', noData: 'No model calls recorded for this selection yet.', connect: 'Open a workspace and run a task to start collecting usage.', loading: 'Loading usage…', unavailable: 'Usage data could not be loaded.', reportNote: 'Input and output are provider reported. Savings use OrderCode’s approximate character based token estimator and only count context reduced before a request.', historyNote: 'Older totals are recovered from saved completed runs and may be partial. Their token savings cannot be reconstructed.', last90: 'Showing the last 90 days for lifetime history.', dayTip: 'model calls', monthLabels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ranges: [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['0', 'All time']], noReported: 'Not reported', retry: 'Try again', day: 'day', daysWord: 'days', of: 'of', est: 'est.'
  } : {
    title: 'Uso y ahorro', subtitle: 'Actividad de OrderCode y uso de modelos en tu workspace.', project: 'Workspace', period: 'Periodo', allSessions: 'Todas las sesiones', allModels: 'Todos los modelos', refresh: 'Actualizar uso', days: 'Días desde la primera actividad', activeDays: 'días con llamadas al modelo', first: 'Primera llamada registrada', consumed: 'Tokens informados por proveedor', input: 'Entrada', output: 'Salida', cache: 'En caché (incluidos en entrada)', tracked: 'informes completos de uso', legacy: 'de resúmenes de ejecuciones anteriores', saved: 'Tokens ahorrados (estimación)', savedHint: 'Contexto reducido antes de enviarlo al modelo', savingsRate: 'reducción estimada', coverage: 'estimaciones de ahorro registradas', chart: 'Tokens por día', chartHint: 'Uso reportado y ahorro estimado de contexto', heatmap: 'Días de trabajo', heatmapHint: 'Días con al menos una llamada al modelo', noData: 'Aún no hay llamadas registradas para esta selección.', connect: 'Abre un workspace y ejecuta una tarea para empezar a registrar uso.', loading: 'Cargando uso…', unavailable: 'No se pudieron cargar los datos de uso.', reportNote: 'Entrada y salida son datos del proveedor. El ahorro usa el estimador aproximado de tokens por caracteres de OrderCode y cuenta solo el contexto reducido antes de una solicitud.', historyNote: 'Los totales anteriores se recuperan de ejecuciones guardadas y podrían ser parciales. No es posible reconstruir su ahorro en tokens.', last90: 'El historial completo muestra aquí sus últimos 90 días.', dayTip: 'llamadas al modelo', monthLabels: ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'], ranges: [['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['0', 'Todo']], noReported: 'Sin métricas', retry: 'Reintentar', day: 'día', daysWord: 'días', of: 'de', est: 'est.'
  };

  const projectOptions = useMemo(() => [...new Map(sessions.map((item) => [item.projectPath, item.projectPath])).values()], [sessions]);
  const activeProjectRef = useRef(activeSession?.projectPath);
  const [projectPath, setProjectPath] = useState(activeSession?.projectPath ?? projectOptions[0] ?? '');
  const [range, setRange] = useState<Range>(30);
  const [sessionId, setSessionId] = useState('');
  const [modelId, setModelId] = useState('');
  const [analytics, setAnalytics] = useState<UsageAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (activeSession?.projectPath && activeSession.projectPath !== activeProjectRef.current) {
      activeProjectRef.current = activeSession.projectPath;
      setProjectPath(activeSession.projectPath);
      setSessionId('');
      setModelId('');
    } else if (!projectPath && projectOptions[0]) setProjectPath(projectOptions[0]);
  }, [activeSession?.projectPath, projectOptions, projectPath]);

  useEffect(() => {
    setSessionId('');
    setModelId('');
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) { setAnalytics(null); setError(''); return; }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    setAnalytics(null);
    void loadUsageAnalytics({ projectPath, days: range, ...(sessionId ? { sessionId } : {}), ...(modelId ? { modelId } : {}) })
      .then((result) => { if (requestId.current === currentRequest) setAnalytics(result); })
      .catch(() => { if (requestId.current === currentRequest) setError(copy.unavailable); })
      .finally(() => { if (requestId.current === currentRequest) setLoading(false); });
  }, [projectPath, range, sessionId, modelId, refreshKey, reload]);

  useEffect(() => {
    if (modelId && analytics && !analytics.models.includes(modelId)) setModelId('');
  }, [analytics?.models, modelId]);

  const chartDays = range === 0 ? 90 : range;
  const dates = useMemo(() => localDays(chartDays), [chartDays, analytics?.points]);
  const points = useMemo(() => {
    const byDay = new Map((analytics?.points ?? []).map((point) => [point.day, point]));
    return dates.map((day) => byDay.get(day) ?? { day, providerCalls: 0, measuredCalls: 0, inputTokens: 0, outputTokens: 0, estimatedSentTokens: 0, estimatedSavedTokens: 0, savingsCalls: 0 });
  }, [dates, analytics?.points]);
  const maxChartValue = Math.max(1, ...points.map((point) => point.inputTokens + point.outputTokens), ...points.map((point) => point.estimatedSavedTokens));
  const consumedTokens = (analytics?.inputTokens ?? 0) + (analytics?.outputTokens ?? 0);
  const hasTokenData = (analytics?.reportedTokenRecords ?? 0) > 0;
  const daysSinceFirst = analytics?.firstActivityAt ? Math.max(1, dayOrdinal(new Date()) - dayOrdinal(new Date(analytics.firstActivityAt)) + 1) : 0;
  const savingsBase = (analytics?.estimatedSentTokens ?? 0) + (analytics?.estimatedSavedTokens ?? 0);
  const savingsPercent = savingsBase > 0 ? (analytics!.estimatedSavedTokens / savingsBase) * 100 : 0;
  const firstDate = analytics?.firstActivityAt ? new Date(analytics.firstActivityAt).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const hasActivity = (analytics?.providerCalls ?? 0) > 0;
  const heatmapStartPad = dates.length ? new Date(`${dates[0]}T12:00:00`).getDay() : 0;
  const heatmapCells: Array<UsagePoint | null> = [...Array.from({ length: heatmapStartPad }, () => null), ...points];
  const maximumDailyCalls = Math.max(1, ...points.map((point) => point.providerCalls));

  return <div className="usage-page">
    <header className="surface-heading usage-heading">
      <span className="usage-heading-icon"><Activity size={17} /></span>
      <div><h2>{copy.title}</h2><p>{copy.subtitle}</p></div>
      <button type="button" className="usage-refresh" aria-label={copy.refresh} title={copy.refresh} disabled={loading || !projectPath} onClick={() => setReload((value) => value + 1)}><RefreshCw size={14} className={loading ? 'is-spinning' : ''} /></button>
    </header>

    <section className="usage-toolbar" aria-label={copy.title + ' filters'}>
      <label><span>{copy.project}</span><select value={projectPath} onChange={(event) => setProjectPath(event.target.value)} disabled={!projectOptions.length}>{!projectOptions.length && <option value="">{english ? 'No workspace' : 'Sin workspace'}</option>}{projectOptions.map((path) => <option key={path} value={path}>{shortProjectName(path)}</option>)}</select></label>
      <label><span>{copy.period}</span><select value={range} onChange={(event) => setRange(Number(event.target.value) as Range)}>{copy.ranges.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>{english ? 'Session' : 'Sesión'}</span><select value={sessionId} onChange={(event) => { setSessionId(event.target.value); setModelId(''); }} disabled={!analytics?.sessions.length}><option value="">{copy.allSessions}</option>{analytics?.sessions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label><span>{english ? 'Model' : 'Modelo'}</span><select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!analytics?.models.length}><option value="">{copy.allModels}</option>{analytics?.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
    </section>

    {error && <div className="usage-error" role="alert"><span>{error}</span><button type="button" onClick={() => setReload((value) => value + 1)}>{copy.retry}</button></div>}
    {!projectPath ? <div className="usage-empty"><span><CalendarDays size={20} /></span><strong>{copy.connect}</strong></div> : null}

    {projectPath && <>
      <section className="usage-metrics" aria-label={copy.title}>
        <article className="usage-metric usage-metric--days">
          <div className="usage-metric-top"><span className="usage-metric-icon"><CalendarDays size={15} /></span><span>{copy.days}</span><small>01 / TIME</small></div>
          <strong className="usage-metric-value">{loading && !analytics ? '…' : hasActivity ? `${formatCount(daysSinceFirst, locale)} ${daysSinceFirst === 1 ? copy.day : copy.daysWord}` : '—'}</strong>
          <div className="usage-metric-foot"><span>{formatCount(analytics?.activeDays ?? 0, locale)} {copy.activeDays}</span><small>{copy.first}: {firstDate}</small></div>
        </article>

        <article className="usage-metric usage-metric--consumed">
          <div className="usage-metric-top"><span className="usage-metric-icon"><Zap size={15} /></span><span>{copy.consumed}</span><small>02 / INPUT</small></div>
          <strong className="usage-metric-value">{loading && !analytics ? '…' : hasTokenData ? formatCount(consumedTokens, locale) : hasActivity ? copy.noReported : '—'}</strong>
          <div className="usage-metric-foot"><span>{copy.input}: {analytics?.inputTokenRecords ? formatCount(analytics.inputTokens, locale) : hasActivity ? copy.noReported : '—'} · {copy.output}: {analytics?.outputTokenRecords ? formatCount(analytics.outputTokens, locale) : hasActivity ? copy.noReported : '—'}</span><small>{copy.cache}: {analytics?.cachedTokenRecords ? formatCount(analytics.cachedTokens, locale) : '—'}</small></div>
          {hasActivity && <div className="usage-coverage">{formatCount(analytics?.measuredCalls ?? 0, locale)} {copy.of} {formatCount(analytics?.providerCalls ?? 0, locale)} {copy.tracked}</div>}
        </article>

        <article className="usage-metric usage-metric--saved">
          <div className="usage-metric-top"><span className="usage-metric-icon"><Sparkles size={15} /></span><span>{copy.saved}</span><small>03 / CONTEXT</small></div>
          <strong className="usage-metric-value">{loading && !analytics ? '…' : analytics?.savingsCalls ? `≈ ${formatCount(analytics.estimatedSavedTokens, locale)}` : hasActivity ? '—' : '0'}</strong>
          <div className="usage-metric-foot"><span>{copy.savedHint}</span><small>{copy.est} {savingsPercent.toLocaleString(locale, { maximumFractionDigits: 1 })}% {copy.savingsRate}</small></div>
          <div className="usage-coverage">{formatCount(analytics?.savingsCalls ?? 0, locale)} {copy.of} {formatCount(analytics?.providerCalls ?? 0, locale)} {copy.coverage}</div>
        </article>
      </section>

      <section className="usage-visual-grid">
        <article className="usage-panel usage-chart-panel">
          <header className="usage-panel-heading"><div><span className="usage-eyebrow">01 / TOKENS</span><h3>{copy.chart}</h3><p>{copy.chartHint}</p></div><div className="usage-legend"><span><i className="usage-legend-used" />{english ? 'Used' : 'Usados'}</span><span><i className="usage-legend-saved" />{english ? 'Saved est.' : 'Ahorro est.'}</span></div></header>
          {hasActivity ? <>
            <div className="usage-chart" role="img" aria-label={copy.chart}>
              <div className="usage-chart-gridline usage-chart-gridline--top"><span>{formatCount(maxChartValue, locale)}</span></div>
              <div className="usage-chart-gridline usage-chart-gridline--middle"><span>{formatCount(maxChartValue / 2, locale)}</span></div>
              <div className="usage-chart-columns" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(2px, 1fr))` }}>{points.map((point) => {
                const used = point.inputTokens + point.outputTokens;
                const usedHeight = used ? Math.max(3, used / maxChartValue * 100) : 0;
                const savedHeight = point.estimatedSavedTokens ? Math.max(3, point.estimatedSavedTokens / maxChartValue * 100) : 0;
                const label = new Date(`${point.day}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
                return <div className="usage-chart-day" key={point.day} title={`${label} · ${formatCount(used, locale)} ${copy.consumed.toLowerCase()} · ≈${formatCount(point.estimatedSavedTokens, locale)} ${copy.saved.toLowerCase()}`}>
                  <div className="usage-chart-bars"><i className="usage-chart-bar usage-chart-bar--used" style={{ height: `${usedHeight}%` }} /><i className="usage-chart-bar usage-chart-bar--saved" style={{ height: `${savedHeight}%` }} /></div>
                </div>;
              })}</div>
            </div>
            <div className="usage-chart-axis"><span>{new Date(`${points[0]?.day ?? dayKey(new Date())}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span>{range === 0 && <span>{copy.last90}</span>}<span>{new Date(`${points.at(-1)?.day ?? dayKey(new Date())}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span></div>
          </> : <div className="usage-chart-empty">{copy.noData}</div>}
        </article>

        <article className="usage-panel usage-heatmap-panel">
          <header className="usage-panel-heading"><div><span className="usage-eyebrow">02 / ACTIVITY</span><h3>{copy.heatmap}</h3><p>{copy.heatmapHint}{range === 0 ? ` · ${copy.last90}` : ''}</p></div></header>
          <div className="usage-heatmap-months"><span>{new Date(`${dates[0] ?? dayKey(new Date())}T12:00:00`).toLocaleDateString(locale, { month: 'short' })}</span><span>{new Date(`${dates.at(-1) ?? dayKey(new Date())}T12:00:00`).toLocaleDateString(locale, { month: 'short' })}</span></div>
          <div className="usage-heatmap-wrap"><div className="usage-weekdays">{copy.monthLabels.map((label) => <span key={label}>{label}</span>)}</div><div className="usage-heatmap-grid">{heatmapCells.map((point, index) => {
            const intensity = point ? point.providerCalls ? Math.min(4, Math.ceil(point.providerCalls / maximumDailyCalls * 4)) : 0 : -1;
            return <i key={point?.day ?? `pad-${index}`} className={`usage-heat-cell${intensity < 0 ? ' is-pad' : ` level-${intensity}`}`} title={point ? `${point.day} · ${formatCount(point.providerCalls, locale)} ${copy.dayTip}` : undefined} />;
          })}</div></div>
          <div className="usage-heatmap-scale"><span>{english ? 'Less' : 'Menos'}</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`usage-heat-cell level-${level}`} />)}<span>{english ? 'More' : 'Más'}</span></div>
        </article>
      </section>

      <div className="usage-footnotes">
        <p>{copy.reportNote}</p>
        {!!analytics?.legacyCalls && <p className="usage-history-note">{copy.historyNote} ({formatCount(analytics.legacyCalls, locale)} {copy.legacy}).</p>}
      </div>
      {loading && analytics && <span className="usage-refreshing" role="status">{copy.loading}</span>}
    </>}
  </div>;
}
