import type { HarnessEvent, RuntimeState } from './contracts';

export const activityStateLabels: Record<RuntimeState, string> = { CREATED: 'Listo', PREPARING: 'Preparando', RUNNING: 'En curso', WAITING_APPROVAL: 'Pendiente de autorización', WAITING_USER: 'Esperando respuesta', PAUSING: 'Pausando', PAUSED: 'En pausa', COMPLETED: 'Completado', FAILED: 'Falló', CANCELLED: 'Cancelado', RECOVERY_REQUIRED: 'Sin resultado registrado' };
export const activeStates = new Set<RuntimeState>(['PREPARING', 'RUNNING', 'WAITING_APPROVAL', 'PAUSING']);

export interface ActivityRow extends HarnessEvent { startedAt?: string; finishedAt?: string }

// Pair by invocation, including parallel calls of the same tool. Legacy events use a FIFO queue.
export function taskActivity(events: HarnessEvent[], runtimeState: RuntimeState): ActivityRow[] {
  const rows: ActivityRow[] = [], identities = new Map<string, number>(), pending = new Map<string, number[]>(), agents = new Map<string, number>();
  const resolutions = new Map(events.filter((event) => event.type === 'permission.resolved' && event.permissionRequestId).map((event) => [event.permissionRequestId!, event]));
  for (const event of events) {
    const type = event.type ?? event.summary;
    if (type === 'agent.started' || type === 'agent.state' || type === 'agent.completed') {
      const identity = event.agentRunId;
      const index = identity ? agents.get(identity) : undefined;
      const next = { ...event, summary: event.agentName ?? event.summary };
      if (index !== undefined) rows[index] = { ...rows[index], ...next, id: rows[index]!.id, startedAt: rows[index].startedAt, ...(type === 'agent.completed' ? { finishedAt: event.createdAt } : {}) };
      else { if (identity) agents.set(identity, rows.length); rows.push({ ...next, startedAt: event.createdAt }); }
    } else if (type === 'tool.started' || type === 'tool.completed') {
      const tool = event.toolName ?? event.summary.split(' · ')[0];
      if (tool === 'agents.delegate' && (type === 'tool.started' || event.state === 'COMPLETED')) continue;
      if (!event.runId && /^git\.(status|diff|branches|remotes|history|tags)$/.test(tool)) continue;
      const group = `${event.agentRunId ?? event.runId ?? 'manual'}:${tool}`, identity = event.invocationId ? `${group}:${event.invocationId}` : undefined;
      const queue = pending.get(group) ?? [];
      if (type === 'tool.started') {
        if (identity && identities.has(identity)) continue;
        if (identity) identities.set(identity, rows.length);
        queue.push(rows.length); pending.set(group, queue);
        rows.push({ ...event, summary: tool, startedAt: event.createdAt });
      } else {
        while (queue.length && rows[queue[0]!]!.state !== 'RUNNING') queue.shift();
        const index = identity ? identities.get(identity) : queue.shift();
        if (index !== undefined) rows[index] = { ...rows[index], ...event, id: rows[index]!.id, summary: tool, target: event.target ?? rows[index]!.target, finishedAt: event.createdAt };
        else { if (identity) identities.set(identity, rows.length); rows.push({ ...event, summary: tool, finishedAt: event.createdAt }); }
      }
    } else if (type === 'permission.requested') {
      const resolution = event.permissionRequestId ? resolutions.get(event.permissionRequestId) : undefined;
      rows.push(resolution ? { ...event, state: resolution.state, summary: `Autorización ${resolution.permissionDecision === 'reject' ? 'rechazada' : 'concedida'}: ${event.toolName ?? event.summary.replace(/^Autorización: /, '')}`, detail: resolution.detail, permissionDecision: resolution.permissionDecision } : event);
    } else if (['run.failed', 'context.compacted', 'recovery.required'].includes(type)) rows.push(event);
  }
  return rows.map((event) => event.state !== 'RUNNING' || activeStates.has(runtimeState) ? event : { ...event, state: runtimeState === 'CANCELLED' ? 'CANCELLED' : runtimeState === 'PAUSED' ? 'PAUSED' : 'RECOVERY_REQUIRED', detail: event.detail ?? 'No se recibió un resultado para esta tarea.' });
}

const toolTitles: Record<string, [string, string]> = {
  'fs.read': ['Leer archivo', 'Leyendo archivo'], 'fs.write': ['Modificar archivo', 'Modificando archivo'],
  'fs.list': ['Explorar archivos', 'Explorando archivos'], 'code.search': ['Buscar en el proyecto', 'Buscando en el proyecto'],
  'code.symbols': ['Consultar símbolos', 'Consultando símbolos'], 'code.context': ['Consultar contexto', 'Consultando contexto'],
  'process.exec': ['Ejecutar comando', 'Ejecutando comando'], 'git.status': ['Revisar estado de Git', 'Revisando estado de Git'],
  'git.diff': ['Revisar cambios', 'Revisando cambios'], 'git.history': ['Consultar historial', 'Consultando historial'],
  'git.branches': ['Consultar ramas', 'Consultando ramas'], 'git.remotes': ['Consultar repositorios', 'Consultando repositorios'],
  'git.commit': ['Guardar versión', 'Guardando versión'], 'git.push': ['Publicar cambios', 'Publicando cambios'],
};

export function activityTitle(event: HarnessEvent): string {
  if (event.type === 'permission.requested') return event.summary;
  if (event.agentRunId && /^agent\./.test(event.type ?? '')) return event.agentName ?? event.summary;
  if (event.type === 'run.failed') return 'La ejecución se detuvo';
  return toolTitles[event.toolName ?? event.summary]?.[event.state === 'RUNNING' ? 1 : 0] ?? event.summary;
}

export function activityDescription(event: HarnessEvent): string {
  if (event.target) return event.target;
  const detail = event.detail?.split(/\r?\n/)[0]?.replace(/\s*[\[{][\s\S]*$/, '').trim() ?? '';
  // Full file contents and command output belong in the optional detail, never in the timeline.
  if (/^(?:[\w.]+ completed\.?|Git \w+ completed\.?|Code search completed)/i.test(detail)) return '';
  return detail.slice(0, 180);
}
