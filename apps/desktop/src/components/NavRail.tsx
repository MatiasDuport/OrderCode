import { Activity, Boxes, Code2, FolderKanban, GitBranch, Puzzle, Settings, ShieldCheck, UsersRound } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Localized } from '../lib/localization';

const items = [
  { view: 'Workspace', label: 'Workspace', icon: FolderKanban },
  { view: 'Sessions', label: 'Sesiones', icon: Activity },
  { view: 'Agents', label: 'Agentes', icon: UsersRound },
  { view: 'Code Intelligence', label: 'Inteligencia de código', icon: Code2 },
  { view: 'Extensions', label: 'Extensiones', icon: Puzzle },
  { view: 'Activity', label: 'Actividad', icon: Boxes },
  { view: 'Release Center', label: 'Centro de versiones', icon: ShieldCheck },
];

export function NavRail({ active, workspaceOpen, onSelect }: { active: string; workspaceOpen: boolean; onSelect: (label: string) => void }) {
  const [dismissed, setDismissed] = useState(false);
  const item = (view: string, label: string, Icon: typeof Activity, accessibleLabel = label) => <motion.button key={view} type="button" className={`nav-item ${active === view ? 'is-active' : ''}`} aria-label={accessibleLabel} title={accessibleLabel} aria-current={active === view ? 'page' : undefined} aria-expanded={view === 'Workspace' ? workspaceOpen : undefined} aria-controls={view === 'Workspace' && workspaceOpen ? 'workspace-panel' : undefined} onClick={(event) => { onSelect(view); if (event.detail > 0) { setDismissed(true); event.currentTarget.blur(); } }} whileTap={{ scale: .94 }}>
    {active === view && <motion.span className="nav-active-indicator" layoutId="navigation-selection" transition={{ type: 'spring', stiffness: 420, damping: 38 }} />}
    <Icon size={20} strokeWidth={1.6} /><span className="nav-item-label">{label}</span>
  </motion.button>;
  return <Localized><nav className={`nav-rail ${dismissed ? 'is-disclosure-dismissed' : ''}`} aria-label="Navegación principal" onPointerLeave={() => setDismissed(false)}><div className="nav-rail-main">{items.map(({ view, label, icon }) => item(view, label, icon))}</div><div className="nav-rail-bottom">{item('Git', 'Git', GitBranch, 'Control de versiones')}{item('Settings', 'Ajustes', Settings)}</div></nav></Localized>;
}
