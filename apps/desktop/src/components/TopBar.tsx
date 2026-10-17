import { CheckCheck, ChevronDown, CloudDownload, Download, Folder, LayoutPanelTop, LoaderCircle, Search, Settings, TerminalSquare } from 'lucide-react';
import { IconButton, Kbd, Logo } from './ui';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';

export function TopBar({ onToggleSidebar, onToggleTerminal, onCommandPalette, onOpenWorkspace, onSettings, onUpdateAction }: { onToggleSidebar: () => void; onToggleTerminal: () => void; onCommandPalette: () => void; onOpenWorkspace: () => void; onSettings: () => void; onUpdateAction: () => void }) {
  const session = useDesktopStore((state) => state.session);
  const update = useDesktopStore((state) => state.updateView);
  const workspaceName = session?.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Sin workspace';
  const isBusy = ['checking', 'downloading', 'installing'].includes(update.phase);
  const updateLabel = update.phase === 'available' ? `Descargar OrderCode ${update.version}` : update.phase === 'downloaded' ? `Instalar y reiniciar OrderCode ${update.version}` : update.phase === 'checking' ? 'Comprobando actualizaciones' : update.phase === 'downloading' ? 'Descargando actualización' : update.phase === 'installing' ? 'Instalando actualización' : update.phase === 'error' ? 'Reintentar búsqueda de actualizaciones' : 'Buscar actualizaciones';
  const UpdateIcon = isBusy ? LoaderCircle : update.phase === 'available' ? Download : update.phase === 'downloaded' ? CheckCheck : CloudDownload;
  return <Localized><header className="topbar">
    <Logo />
    <button className="project-selector" type="button" onClick={onOpenWorkspace}><Folder size={15} /><span><strong>{workspaceName}</strong></span><ChevronDown size={13} /></button>
    <div className="topbar-spacer" />
    <button className="command-trigger" type="button" onClick={onCommandPalette}><Search size={14} /><span>Buscar comandos...</span><Kbd>Ctrl / ⌘ P</Kbd></button>
    <div className="window-actions"><IconButton icon={LayoutPanelTop} label="Alternar paneles" onClick={onToggleSidebar} /><IconButton icon={TerminalSquare} label="Alternar terminal" onClick={onToggleTerminal} /></div>
    <button type="button" className={`update-center-button${update.phase === 'available' || update.phase === 'downloaded' ? ' has-update' : ''}${isBusy ? ' is-busy' : ''}`} aria-label={updateLabel} title={updateLabel} onClick={onUpdateAction} disabled={isBusy}><UpdateIcon size={15} strokeWidth={1.9} />{(update.phase === 'available' || update.phase === 'downloaded') && <span className="update-center-dot" aria-hidden="true" />}</button>
    <IconButton icon={Settings} label="Perfil y ajustes" onClick={onSettings} />
  </header></Localized>;
}
