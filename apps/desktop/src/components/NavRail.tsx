import { Activity, Boxes, Code2, FolderKanban, GitBranch, Puzzle, Settings, ShieldCheck, UsersRound } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Localized } from '../lib/localization';

const items = [
  { label: 'Workspace', icon: FolderKanban },
  { label: 'Sessions', icon: Activity },
  { label: 'Agents', icon: UsersRound },
  { label: 'Code Intelligence', icon: Code2 },
  { label: 'Extensions', icon: Puzzle },
  { label: 'Activity', icon: Boxes },
  { label: 'Release Center', icon: ShieldCheck },
];

export function NavRail({ active, onSelect }: { active: string; onSelect: (label: string) => void }) {
  const [dismissed, setDismissed] = useState(false);
  const item = (label: string, Icon: typeof Activity, accessibleLabel = label) => <motion.button key={label} type="button" className={`nav-item ${active === label ? 'is-active' : ''}`} aria-label={accessibleLabel} title={accessibleLabel} aria-current={active === label ? 'page' : undefined} onClick={(event) => { onSelect(label); if (event.detail > 0) { setDismissed(true); event.currentTarget.blur(); } }} whileTap={{ scale: .94 }}>
    {active === label && <motion.span className="nav-active-indicator" layoutId="navigation-selection" transition={{ type: 'spring', stiffness: 420, damping: 38 }} />}
    <Icon size={20} strokeWidth={1.6} /><span className="nav-item-label">{label}</span>
  </motion.button>;
  return <Localized><nav className={`nav-rail ${dismissed ? 'is-disclosure-dismissed' : ''}`} aria-label="Navegación principal" onPointerLeave={() => setDismissed(false)}><div className="nav-rail-main">{items.map(({ label, icon }) => item(label, icon))}</div><div className="nav-rail-bottom">{item('Git', GitBranch, 'Control de versiones')}{item('Settings', Settings)}</div></nav></Localized>;
}
