import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, CircleHelp, LoaderCircle, Pause, ShieldCheck, X } from 'lucide-react';
import type { RuntimeState } from '../lib/contracts';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';
import { activeStates, activityDescription, activityStateLabels, activityTitle, taskActivity, type ActivityRow } from '../lib/taskActivity';

function TaskIcon({ state }: { state: RuntimeState }) {
  return state === 'COMPLETED' ? <Check size={13} /> : ['FAILED', 'CANCELLED'].includes(state) ? <X size={13} /> : state === 'WAITING_APPROVAL' ? <ShieldCheck size={14} /> : ['PAUSING', 'PAUSED'].includes(state) ? <Pause size={13} /> : activeStates.has(state) ? <LoaderCircle size={14} className="task-spinner" /> : <CircleHelp size={14} />;
}

function TaskDuration({ event }: { event: ActivityRow }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (event.state !== 'RUNNING' || !event.startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [event.state, event.startedAt]);
  const start = Date.parse(event.startedAt ?? '');
  const end = event.finishedAt ? Date.parse(event.finishedAt) : event.state === 'RUNNING' ? now : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const seconds = Math.floor((end - start) / 1000);
  return <span className="activity-duration">{seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`}</span>;
}

function TaskRow({ event, projectPath }: { event: ActivityRow; projectPath?: string }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const title = activityTitle(event);
  let description = activityDescription(event).replace(/^\\\\\?\\/, '');
  const normalizedProject = projectPath?.replace(/^\\\\\?\\/, '').replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedTarget = description.replace(/\\/g, '/');
  if (normalizedProject && normalizedTarget.toLowerCase().startsWith(normalizedProject.toLowerCase() + '/')) description = normalizedTarget.slice(normalizedProject.length + 1);
  const isAgent = !!event.agentRunId;
  const heading = <><span className={`activity-status activity-status--${event.state.toLowerCase()}`}><TaskIcon state={event.state} /></span><span className="activity-copy"><strong>{/^agent\./.test(event.type ?? '') && <Bot size={13} />}{title}</strong>{description && <small title={description}>{description}</small>}</span><span className="activity-row-meta"><span className="activity-result">{activityStateLabels[event.state]}</span><TaskDuration event={event} /></span>{event.detail && <ChevronDown className="activity-detail-chevron" size={12} />}</>;
  return <Localized><li className={`activity-item${isAgent ? ' activity-item--agent' : ''}`} data-state={event.state} style={isAgent ? { marginLeft: `${Math.min(event.delegationDepth ?? 1, 4) * 12}px` } : undefined}>
    {event.detail ? <details onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary className="activity-row-heading" aria-label={`Detalles de ${title}`}>{heading}</summary>{detailsOpen && <div className="activity-detail"><code>{event.toolName ?? event.type}</code><pre>{event.detail.slice(0, 8000)}{event.detail.length > 8000 ? '\n…' : ''}</pre>{event.terminalOutput && <pre>{event.terminalOutput.slice(-8000)}</pre>}</div>}</details> : <div className="activity-row-heading">{heading}</div>}
  </li></Localized>;
}

export function TaskActivity() {
  const events = useDesktopStore((state) => state.events);
  const runtimeState = useDesktopStore((state) => state.runtimeState);
  const session = useDesktopStore((state) => state.session);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [limit, setLimit] = useState(30);
  const itemsRef = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const contentId = useId();
  const active = activeStates.has(runtimeState);
  const latestRun = [...events].reverse().find((event) => event.runId)?.runId;
  const runEvents = useMemo(() => latestRun ? events.filter((event) => event.runId === latestRun) : events, [events, latestRun]);
  const preparingNext = runtimeState === 'PREPARING' && runEvents.some((event) => /^run\.(completed|failed|cancelled)$/.test(event.type ?? ''));
  const useful = useMemo(() => preparingNext ? [] : taskActivity(runEvents, runtimeState), [runEvents, runtimeState, preparingNext]);
  const primaryAgent = [...runEvents].reverse().find((event) => event.agentName && !event.agentRunId)?.agentName;
  const open = expanded ?? active;
  useEffect(() => { setExpanded(null); setLimit(30); following.current = true; }, [latestRun, session?.id, active]);
  useEffect(() => { if (open && following.current && itemsRef.current) itemsRef.current.scrollTop = itemsRef.current.scrollHeight; }, [useful.length, open]);
  if (!useful.length && !active) return null;
  const running = useful.filter((event) => event.state === 'RUNNING');
  const current = running.at(-1);
  const completed = useful.filter((event) => event.state === 'COMPLETED').length;
  const errors = useful.filter((event) => event.state === 'FAILED').length;
  const liveTitle = runtimeState === 'WAITING_APPROVAL' ? 'Esperando tu autorización' : runtimeState === 'PAUSING' ? 'Deteniendo la ejecución…' : preparingNext || runtimeState === 'PREPARING' ? 'Preparando la tarea…' : current ? activityTitle(current) : runEvents.at(-1)?.type === 'provider.chunk' ? 'Redactando la respuesta…' : 'Procesando la siguiente acción…';
  const visible = useful.filter((event, index) => index >= useful.length - limit || activeStates.has(event.state));
  const hidden = useful.length - visible.length;
  return <Localized><section className="activity-group" aria-label="Ejecución de tareas" data-state={runtimeState}>
    <button type="button" className={`activity-heading${open ? ' is-open' : ''}`} aria-label="Mostrar actividad de tareas" aria-expanded={open} aria-controls={contentId} onClick={() => setExpanded(!open)}>
      <span className={`activity-status activity-status--${runtimeState.toLowerCase()}`}><TaskIcon state={runtimeState} /></span><strong>Actividad de tareas</strong>{useful.length > 0 && <span className="activity-task-count">{useful.length}</span>}{primaryAgent && <span className="activity-primary-agent">{primaryAgent}</span>}<span className="activity-heading-state">{activityStateLabels[runtimeState]}</span><ChevronDown className="activity-heading-chevron" size={13} />
    </button>
    {active && <div className="activity-live" role="status" aria-live="polite" aria-atomic="true"><span className="activity-live-dot" /><span><strong>{liveTitle}</strong>{current?.target && <small>{activityDescription(current)}</small>}</span>{running.length > 1 && <span className="activity-parallel">+{running.length - 1}</span>}</div>}
    {open && <div id={contentId} className="activity-content">{hidden > 0 && <button type="button" className="activity-show-more" onClick={() => { following.current = false; setLimit((value) => value + 30); }}>Ver {Math.min(hidden, 30)} tareas anteriores</button>}{useful.length > 0 && <ol className="activity-items" aria-label="Historial de tareas" ref={itemsRef} onScroll={(event) => { const list = event.currentTarget; following.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48; }}>{visible.map((event) => <TaskRow event={event} key={event.id} projectPath={session?.projectPath} />)}</ol>}{useful.length > 0 && <div className="activity-summary"><span>{completed} de {useful.length} completadas</span>{errors > 0 && <span className="activity-error-count">{errors} con error</span>}</div>}</div>}
  </section></Localized>;
}
