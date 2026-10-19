import { Activity, Bot, ChevronDown, Code2, FolderOpen, GitBranch, History, MessageSquare, Plus, Puzzle, Rocket, Settings, TerminalSquare, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Localized } from '../lib/localization';

const tools = [
  { view: 'Git', label: 'Cambios y Git', icon: GitBranch },
  { view: 'Terminal', label: 'Terminal', icon: TerminalSquare },
  { view: 'Code Intelligence', label: 'Grafo y código', icon: Code2 },
  { view: 'Agents', label: 'Agentes', icon: Bot },
  { view: 'Extensions', label: 'Skills y MCP', icon: Puzzle },
  { view: 'Activity', label: 'Uso y actividad', icon: Activity },
  { view: 'Release Center', label: 'Publicar proyecto', icon: Rocket },
];

export function NavRail({ active, workspaceOpen, onSelect, onNewConversation, busy, motionDisabled }: { active: string; workspaceOpen: boolean; onSelect: (view: string) => void; onNewConversation: () => void; busy: boolean; motionDisabled: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [toolsOpen, setToolsOpen] = useState(() => window.innerWidth > 640 && tools.some((item) => item.view === active));
  useEffect(() => { if (window.innerWidth > 640 && tools.some((item) => item.view === active)) setToolsOpen(true); }, [active]);
  useEffect(() => {
    if (!toolsOpen) return;
    const closeOutside = (event: PointerEvent) => { if (window.innerWidth <= 640 && event.target instanceof Node && !root.current?.contains(event.target)) setToolsOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setToolsOpen(false); } };
    document.addEventListener('pointerdown', closeOutside); document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [toolsOpen]);
  const link = (view: string, label: string, Icon: typeof Activity, selected: boolean) => <button key={view} type="button" className={`simple-nav-link${selected ? ' is-active' : ''}`} aria-current={selected ? 'page' : undefined} aria-expanded={view === 'Workspace' ? workspaceOpen : undefined} aria-controls={view === 'Workspace' && workspaceOpen ? 'workspace-panel' : undefined} onClick={() => { onSelect(view); if (window.innerWidth <= 640) setToolsOpen(false); }}>{selected && <motion.span className="simple-nav-highlight" aria-hidden="true" layoutId={motionDisabled ? undefined : 'navigation-selection'} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}<Icon size={17} strokeWidth={1.7} /><span>{label}</span></button>;
  return <Localized><nav ref={root} className="simple-navigation" aria-label="Navegación principal">
    <button type="button" className="new-conversation-button" aria-label="Nueva conversación" onClick={() => { setToolsOpen(false); onNewConversation(); }} disabled={busy}><Plus size={17} /><span>Nueva conversación</span></button>
    <div className="simple-nav-primary">
      {link('Chat', 'Conversación', MessageSquare, active === 'Workspace' && !workspaceOpen)}
      {link('Workspace', 'Proyecto', FolderOpen, active === 'Workspace' && workspaceOpen)}
      {link('Sessions', 'Historial', History, active === 'Sessions')}
    </div>
    <div className="simple-nav-bottom">
      <button type="button" className={`simple-nav-link tools-disclosure${toolsOpen ? ' is-open' : ''}`} aria-expanded={toolsOpen} aria-controls="navigation-tools" onClick={() => setToolsOpen(!toolsOpen)}><Wrench size={17} strokeWidth={1.7} /><span>Herramientas</span><ChevronDown size={14} /></button>
      {toolsOpen && <div className="simple-nav-tools" id="navigation-tools">{tools.map(({ view, label, icon }) => link(view, label, icon, active === view))}</div>}
      {link('Settings', 'Ajustes', Settings, active === 'Settings')}
    </div>
  </nav></Localized>;
}
