import { CheckCheck, CloudDownload, Download, LoaderCircle, Search, Settings, TerminalSquare } from 'lucide-react';
import { IconButton, Logo } from './ui';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';

export function TopBar({ onToggleTerminal, onCommandPalette, onSettings, onUpdateAction }: { onToggleTerminal: () => void; onCommandPalette: () => void; onSettings: () => void; onUpdateAction: () => void }) {
  const update = useDesktopStore((state) => state.updateView);
  const isBusy = ['checking', 'downloading', 'installing'].includes(update.phase);
  const updateLabel = update.phase === 'available' ? `Descargar OrderCode ${update.version}` : update.phase === 'downloaded' ? `Instalar y reiniciar OrderCode ${update.version}` : update.phase === 'checking' ? 'Comprobando actualizaciones' : update.phase === 'downloading' ? 'Descargando actualización' : update.phase === 'installing' ? 'Instalando actualización' : update.phase === 'error' ? 'Reintentar búsqueda de actualizaciones' : 'Buscar actualizaciones';
  const UpdateIcon = isBusy ? LoaderCircle : update.phase === 'available' ? Download : update.phase === 'downloaded' ? CheckCheck : CloudDownload;
  return <Localized><header className="topbar">
    <Logo compact />
    <div className="topbar-spacer" />
    <IconButton icon={Search} label="Buscar comandos" title="Buscar comandos (Ctrl / ⌘ P)" onClick={onCommandPalette} />
    <IconButton icon={TerminalSquare} label="Alternar terminal" onClick={onToggleTerminal} />
    <button type="button" className={`update-center-button${update.phase === 'available' || update.phase === 'downloaded' ? ' has-update' : ''}${isBusy ? ' is-busy' : ''}`} aria-label={updateLabel} title={updateLabel} onClick={onUpdateAction} disabled={isBusy}><UpdateIcon size={15} strokeWidth={1.9} />{(update.phase === 'available' || update.phase === 'downloaded') && <span className="update-center-dot" aria-hidden="true" />}</button>
    <IconButton icon={Settings} label="Perfil y ajustes" onClick={onSettings} />
  </header></Localized>;
}
