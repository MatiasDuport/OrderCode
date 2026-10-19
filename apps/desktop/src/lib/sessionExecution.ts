import { loadSession, loadSessionEvents } from './ipc';
import { useDesktopStore } from './store';

const followedOperations = new Set<string>();
const operationKey = (sessionId: string, revision: number) => `${sessionId}:${revision}`;

export function watchSessionExecution(sessionId: string, revision: number): () => void {
  let stopped = false;
  let inFlight = false;
  const initial = useDesktopStore.getState();
  let cursor = Math.max(initial.session?.sequence ?? 0, ...initial.events.map((event) => event.sequence));
  const isCurrent = () => !stopped && useDesktopStore.getState().session?.id === sessionId && useDesktopStore.getState().sessionRevision === revision;
  const poll = async () => {
    if (!isCurrent() || inFlight || followedOperations.has(operationKey(sessionId, revision))) return;
    inFlight = true;
    try {
      const events = await loadSessionEvents(sessionId, cursor);
      if (!isCurrent()) return;
      if (events.some((event) => /^(run\.(completed|failed|cancelled)|session\.state|permission\.(requested|resolved))$/.test(event.type ?? event.summary) && ['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_APPROVAL', 'WAITING_USER', 'PAUSED', 'RECOVERY_REQUIRED'].includes(event.state))) {
        const saved = await loadSession(sessionId);
        if (isCurrent()) { applySessionSnapshot(saved); cursor = Math.max(cursor, saved.session.sequence, ...saved.events.map((event) => event.sequence)); }
      } else for (const event of events) { useDesktopStore.getState().addEvent(event); cursor = Math.max(cursor, event.sequence); }
    } catch { /* A temporary transport interruption is retried on the next tick. */ }
    finally { inFlight = false; }
  };
  const timer = window.setInterval(() => { void poll(); }, 250);
  void poll();
  return () => { stopped = true; window.clearInterval(timer); };
}

function applySessionSnapshot(saved: Awaited<ReturnType<typeof loadSession>>): void {
  useDesktopStore.setState((state) => ({
    session: saved.session,
    sessions: [saved.session, ...state.sessions.filter((session) => session.id !== saved.session.id)].sort((left, right) => (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt)),
    messages: saved.messages.map((message) => ({ id: message.id, role: message.role, content: message.content, timestamp: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })),
    events: saved.events, streamingText: '',
    runtimeState: saved.pendingPermissions.length ? 'WAITING_APPROVAL' : saved.session.state,
    pendingPermission: saved.pendingPermissions[0] ?? null,
  }));
}

/** Follow one operation without overlapping polls or writing into another session view. */
export async function followSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const initial = useDesktopStore.getState();
  const revision = initial.sessionRevision;
  const key = operationKey(sessionId, revision);
  followedOperations.add(key);
  const isCurrent = () => {
    const state = useDesktopStore.getState();
    return state.session?.id === sessionId && state.sessionRevision === revision;
  };
  let cursor = Math.max(initial.session?.sequence ?? 0, ...initial.events.filter((event) => event.sessionId === sessionId).map((event) => event.sequence));
  let inFlight: Promise<void> | undefined;
  const poll = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (!isCurrent()) return Promise.resolve();
    inFlight = loadSessionEvents(sessionId, cursor).then((events) => {
      if (!isCurrent()) return;
      for (const event of events) {
        useDesktopStore.getState().addEvent(event);
        cursor = Math.max(cursor, event.sequence);
      }
    }).catch(() => { /* The final reload reports persistent connection errors. */ }).finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const timer = window.setInterval(() => { void poll(); }, 250);
  try {
    const result = await operation();
    window.clearInterval(timer);
    await poll();
    // A poll already in flight may have started before the last event was persisted.
    await poll();
    if (isCurrent()) {
      const saved = await loadSession(sessionId);
      if (isCurrent()) applySessionSnapshot(saved);
    }
    return result;
  } finally {
    window.clearInterval(timer);
    await inFlight;
    followedOperations.delete(key);
  }
}
