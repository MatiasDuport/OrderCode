import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bot, Check, Code2, Command, FileCode2, GitBranch, Puzzle, Search, ShieldAlert, Settings2, TerminalSquare, X } from 'lucide-react';
import { IconButton, Kbd } from './ui';
import type { PermissionDecision } from '../lib/contracts';
import { Localized } from '../lib/localization';

const actions = [
  { id: 'Workspace', label: 'Enfocar chat', icon: Command, shortcut: 'Ctrl L' },
  { id: 'Review', label: 'Revisar cambios', icon: FileCode2, shortcut: 'Ctrl ⇧ D' },
  { id: 'Terminal', label: 'Alternar terminal', icon: TerminalSquare, shortcut: 'Ctrl J' },
  { id: 'Sessions', label: 'Abrir sesiones', icon: Activity },
  { id: 'Agents', label: 'Abrir agentes', icon: Bot },
  { id: 'Code Intelligence', label: 'Buscar símbolos', icon: Code2 },
  { id: 'Extensions', label: 'Abrir extensiones', icon: Puzzle },
  { id: 'Git', label: 'Abrir Git', icon: GitBranch },
  { id: 'Release Center', label: 'Abrir Release Center', icon: GitBranch },
  { id: 'Settings', label: 'Abrir ajustes', icon: Settings2 },
];

export function CommandPalette({ open, onClose, onAction }: { open: boolean; onClose: () => void; onAction: (action: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const visible = useMemo(() => actions.filter((action) => `${action.label} ${action.id}`.toLowerCase().includes(query.trim().toLowerCase())), [query]);
  useEffect(() => { if (open) { setQuery(''); inputRef.current?.focus(); } }, [open]);
  if (!open) return null;
  return <Localized><div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="command-palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}><div className="palette-input"><Search size={16} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); if (event.key === 'Enter' && visible[0]) onAction(visible[0].id); }} placeholder="Buscar vistas y acciones..." aria-label="Buscar comandos" /><Kbd>Esc</Kbd></div><div className="palette-section"><span>Acciones</span>{visible.map(({ id, label, icon: Icon, shortcut }) => <button type="button" key={id} onClick={() => onAction(id)}><Icon size={14} /><strong>{label}</strong><span className="panel-title-spacer" />{shortcut && <Kbd>{shortcut}</Kbd>}</button>)}{!visible.length && <div className="dropdown-empty">No hay acciones coincidentes.</div>}</div></div></div></Localized>;
}

export function ApprovalDialog({ request, onApprove, onReject }: { request: Record<string, unknown>; onApprove: (decision: PermissionDecision) => void; onReject: () => void }) {
  const toolName = typeof request.toolName === 'string' ? request.toolName : 'herramienta';
  const action = typeof request.action === 'string' ? request.action : 'operación';
  const effect = typeof request.effect === 'string' ? request.effect : 'UNKNOWN';
  const resource = typeof request.resource === 'string' ? request.resource : typeof request.path === 'string' ? request.path : 'recurso no especificado';
  const destination = typeof request.destination === 'string' ? request.destination : null;
  const reason = typeof request.reason === 'string' ? request.reason : `${action} · ${effect}`;
  return <Localized><div className="overlay overlay--approval"><div className="approval-dialog" role="alertdialog" aria-modal="true" aria-labelledby="approval-title"><div className="approval-icon"><ShieldAlert size={20} /></div><div className="approval-copy"><h2 id="approval-title">Autoriza una operación concreta</h2><p><strong>{toolName}</strong> quiere ejecutar: {reason}</p><div className="approval-resource"><FileCode2 size={14} /><code>{resource}</code><span className="panel-title-spacer" /><span className="risk-label">{effect}</span></div>{destination && <div className="approval-destination"><strong>Destino externo</strong><code>{destination}</code></div>}<small>El permiso se limita a esta herramienta, acción, recurso y sesión.</small></div><IconButton icon={X} label="Rechazar autorización" onClick={onReject} /><div className="approval-actions"><button type="button" className="button-secondary" onClick={onReject}>Rechazar</button><button type="button" className="button-secondary" onClick={() => onApprove('session')}>Permitir en esta sesión</button><button type="button" className="button-secondary" onClick={() => onApprove('project')}>Regla del proyecto</button><button type="button" className="button-primary" onClick={() => onApprove('once')}>Permitir una vez</button></div></div></div></Localized>;
}
