import { Activity, Bot, ChartNoAxesCombined, ChevronDown, Code2, FolderOpen, GitBranch, History, MessageSquare, Plus, Puzzle, Rocket, Settings, SlidersHorizontal, TerminalSquare, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Localized } from '../lib/localization';

const tools = [
  { view: 'Git', label: 'Cambios', icon: GitBranch },
  { view: 'Visualizer', label: 'Vista previa', icon: ChartNoAxesCombined },
  { view: 'Terminal', label: 'Terminal', icon: TerminalSquare },
  { view: 'Agents', label: 'Agentes', icon: Bot },
];
const advancedTools = [
  { view: 'Extensions', label: 'Extensiones', icon: Puzzle },
  { view: 'Code Intelligence', label: 'Mapa del código', icon: Code2 },
  { view: 'Activity', label: 'Uso y actividad', icon: Activity },
  { view: 'Release Center', label: 'Publicar proyecto', icon: Rocket },
];

const isTool = (view: string) => [...tools, ...advancedTools].some((item) => item.view === view);

export function NavRail({ active, workspaceOpen, previewOpen, terminalOpen, onSelect, onNewConversation, busy, motionDisabled }: { active: string; workspaceOpen: boolean; previewOpen: boolean; terminalOpen: boolean; onSelect: (view: string) => void; onNewConversation: () => void; busy: boolean; motionDisabled: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [toolsOpen, setToolsOpen] = useState(() => window.innerWidth > 640 && (isTool(active) || previewOpen));
  const [advancedOpen, setAdvancedOpen] = useState(() => advancedTools.some((item) => item.view === active));
  useEffect(() => {
    if (window.innerWidth > 640 && (isTool(active) || previewOpen)) setToolsOpen(true);
    if (advancedTools.some((item) => item.view === active)) setAdvancedOpen(true);
  }, [active, previewOpen]);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 640px)');
    const closeOnLayoutChange = () => setToolsOpen(!mobile.matches && (isTool(active) || previewOpen));
    mobile.addEventListener('change', closeOnLayoutChange);
    return () => mobile.removeEventListener('change', closeOnLayoutChange);
  }, [active, previewOpen]);
  useEffect(() => {
    if (!toolsOpen) return;
    const closeOutside = (event: PointerEvent) => { if (window.innerWidth <= 640 && event.target instanceof Node && !root.current?.contains(event.target)) setToolsOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setToolsOpen(false); root.current?.querySelector<HTMLButtonElement>('[aria-controls="navigation-tools"]')?.focus(); } };
    document.addEventListener('pointerdown', closeOutside); document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [toolsOpen]);
  const link = (view: string, label: string, Icon: typeof Activity, selected: boolean) => <button key={view} type="button" className={`simple-nav-link${selected ? ' is-active' : ''}`} title={label} aria-label={label} aria-current={selected && view !== 'Terminal' && view !== 'Visualizer' ? 'page' : undefined} aria-expanded={view === 'Workspace' ? workspaceOpen : view === 'Terminal' ? terminalOpen : view === 'Visualizer' ? previewOpen : undefined} aria-controls={view === 'Workspace' && workspaceOpen ? 'workspace-panel' : view === 'Terminal' ? 'terminal-dock' : view === 'Visualizer' ? 'preview-context-panel' : undefined} onClick={() => { onSelect(view); if (window.innerWidth <= 640) setToolsOpen(false); }}>{selected && <motion.span className="simple-nav-highlight" aria-hidden="true" layoutId={motionDisabled || view === 'Terminal' || view === 'Visualizer' ? undefined : 'navigation-selection'} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}<Icon size={17} strokeWidth={1.7} /><span>{label}</span></button>;
  return <Localized><nav ref={root} className={`simple-navigation${active === 'Settings' ? ' simple-navigation--settings' : ''}${workspaceOpen ? ' simple-navigation--workspace-open' : ''}`} aria-label="Navegación principal">
    <div className="simple-navigation-content">
      <button type="button" className="new-conversation-button" aria-label="Nueva conversación" onClick={() => { setToolsOpen(false); onNewConversation(); }} disabled={busy}><Plus size={17} /><span>Nueva conversación</span></button>
      <div className="simple-nav-primary">
        {link('Chat', 'Conversación', MessageSquare, active === 'Workspace' && !workspaceOpen)}
        {link('Workspace', 'Proyecto', FolderOpen, active === 'Workspace' && workspaceOpen)}
        {link('Sessions', 'Historial', History, active === 'Sessions')}
      </div>
      <div className="simple-nav-bottom">
        <button type="button" className={`simple-nav-link tools-disclosure${toolsOpen ? ' is-open' : ''}`} aria-label="Herramientas" aria-expanded={toolsOpen} aria-controls="navigation-tools" onClick={() => setToolsOpen(!toolsOpen)}><Wrench size={17} strokeWidth={1.7} /><span>Herramientas</span><ChevronDown size={14} /></button>
        {toolsOpen && <div className="simple-nav-tools" id="navigation-tools">
          {tools.map(({ view, label, icon }) => link(view, label, icon, view === 'Terminal' ? terminalOpen : view === 'Visualizer' ? previewOpen : active === view))}
          <button type="button" className={`simple-nav-link tools-disclosure tools-advanced-toggle${advancedOpen ? ' is-open' : ''}`} title="Avanzado" aria-label="Herramientas avanzadas" aria-expanded={advancedOpen} aria-controls="navigation-advanced-tools" onClick={() => setAdvancedOpen(!advancedOpen)}><SlidersHorizontal size={14} /><span>Avanzado</span><ChevronDown size={12} /></button>
          {advancedOpen && <div className="simple-nav-advanced" id="navigation-advanced-tools">{advancedTools.map(({ view, label, icon }) => link(view, label, icon, active === view))}</div>}
        </div>}
        {link('Settings', 'Ajustes', Settings, active === 'Settings')}
      </div>
    </div>
  </nav></Localized>;
}
