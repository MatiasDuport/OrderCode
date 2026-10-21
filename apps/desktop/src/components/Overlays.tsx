import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Activity, Bot, ChartNoAxesCombined, Check, Code2, Command, FileCode2, GitBranch, Puzzle, Search, ShieldAlert, Settings2, TerminalSquare, X } from 'lucide-react';
import { IconButton, Kbd } from './ui';
import type { PermissionDecision } from '../lib/contracts';
import { Localized, translate } from '../lib/localization';
import { useDesktopStore } from '../lib/store';

const actions = [
  { id: 'Chat', label: 'Enfocar chat', icon: Command, shortcut: 'Ctrl L' },
  { id: 'Review', label: 'Revisar cambios', icon: FileCode2, shortcut: 'Ctrl ⇧ D' },
  { id: 'Terminal', label: 'Alternar terminal', icon: TerminalSquare, shortcut: 'Ctrl J' },
  { id: 'Sessions', label: 'Abrir sesiones', icon: Activity },
  { id: 'Agents', label: 'Abrir agentes', icon: Bot },
  { id: 'Code Intelligence', label: 'Abrir mapa del código', icon: Code2 },
  { id: 'Extensions', label: 'Abrir extensiones', icon: Puzzle },
  { id: 'Git', label: 'Abrir cambios', icon: GitBranch },
  { id: 'Visualizer', label: 'Abrir vista previa', icon: ChartNoAxesCombined },
  { id: 'Activity', label: 'Ver uso y actividad', icon: Activity },
  { id: 'Release Center', label: 'Publicar proyecto', icon: GitBranch },
  { id: 'Settings', label: 'Abrir ajustes', icon: Settings2 },
];

function useModalFocus(root: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])];
    controls()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const options = controls();
      const first = options[0], last = options.at(-1);
      if (!first || !last) return;
      if (!root.current?.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, [root]);
}

export function CommandPalette({ open, onClose, onAction }: { open: boolean; onClose: () => void; onAction: (action: string) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const language = useDesktopStore((state) => state.language);
  const visible = useMemo(() => actions.filter((action) => `${translate(action.label, language)} ${action.label} ${action.id}`.toLowerCase().includes(query.trim().toLowerCase())), [query, language]);
  useEffect(() => { if (open) { setQuery(''); inputRef.current?.focus(); } }, [open]);
  if (!open) return null;
  return <Localized><div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}><div className="palette-input"><Search size={16} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); if (event.key === 'Enter' && visible[0]) onAction(visible[0].id); }} placeholder="Buscar vistas y acciones..." aria-label="Buscar comandos" /><Kbd>Esc</Kbd></div><div className="palette-section"><span>Acciones</span>{visible.map(({ id, label, icon: Icon, shortcut }) => <button type="button" key={id} onClick={() => onAction(id)}><Icon size={14} /><strong>{label}</strong><span className="panel-title-spacer" />{shortcut && <Kbd>{shortcut}</Kbd>}</button>)}{!visible.length && <div className="dropdown-empty">No hay acciones coincidentes.</div>}</div></div></div></Localized>;
}

export function ApprovalDialog({ request, onApprove, onReject }: { request: Record<string, unknown>; onApprove: (decision: PermissionDecision) => void; onReject: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);
  const toolName = typeof request.toolName === 'string' ? request.toolName : 'herramienta';
  const action = typeof request.action === 'string' ? request.action : 'operación';
  const effect = typeof request.effect === 'string' ? request.effect : 'UNKNOWN';
  const resource = typeof request.resource === 'string' ? request.resource : typeof request.path === 'string' ? request.path : 'recurso no especificado';
  const destination = typeof request.destination === 'string' ? request.destination : null;
  const reason = typeof request.reason === 'string' ? request.reason : `${action} · ${effect}`;
  return <Localized><div className="overlay overlay--approval"><div ref={dialogRef} className="approval-dialog" role="alertdialog" aria-modal="true" aria-labelledby="approval-title"><div className="approval-icon"><ShieldAlert size={20} /></div><div className="approval-copy"><h2 id="approval-title">Autoriza una operación concreta</h2><p><strong>{toolName}</strong> quiere ejecutar: {reason}</p><div className="approval-resource"><FileCode2 size={14} /><code>{resource}</code><span className="panel-title-spacer" /><span className="risk-label">{effect}</span></div>{destination && <div className="approval-destination"><strong>Destino externo</strong><code>{destination}</code></div>}<small>El permiso se limita a esta herramienta, acción, recurso y sesión.</small></div><IconButton icon={X} label="Rechazar autorización" onClick={onReject} /><div className="approval-actions"><button type="button" className="button-secondary" onClick={onReject}>Rechazar</button><button type="button" className="button-secondary" onClick={() => onApprove('session')}>Permitir en esta sesión</button><button type="button" className="button-secondary" onClick={() => onApprove('project')}>Regla del proyecto</button><button type="button" className="button-primary" onClick={() => onApprove('once')}>Permitir una vez</button></div></div></div></Localized>;
}
