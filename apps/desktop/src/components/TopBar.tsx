import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { CheckCheck, CloudDownload, Copy, Download, LoaderCircle, Minus, Search, Square, X } from 'lucide-react';
import { Logo } from './ui';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';
import { isDesktopApp } from '../lib/ipc';

export function TopBar({ onCommandPalette, onUpdateAction }: { onCommandPalette: () => void; onUpdateAction: () => void }) {
  const desktop = isDesktopApp();
  const [maximized, setMaximized] = useState(false);
  const update = useDesktopStore((state) => state.updateView);
  const isBusy = ['checking', 'downloading', 'installing'].includes(update.phase);
  const updateLabel = update.phase === 'available' ? `Descargar OrderCode ${update.version}` : update.phase === 'downloaded' ? `Instalar y reiniciar OrderCode ${update.version}` : update.phase === 'checking' ? 'Comprobando actualizaciones' : update.phase === 'downloading' ? 'Descargando actualización' : update.phase === 'installing' ? 'Instalando actualización' : update.phase === 'error' ? 'Reintentar búsqueda de actualizaciones' : 'Buscar actualizaciones';
  const UpdateIcon = isBusy ? LoaderCircle : update.phase === 'available' ? Download : update.phase === 'downloaded' ? CheckCheck : CloudDownload;

  useEffect(() => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const syncMaximized = () => { void appWindow.isMaximized().then((value) => { if (mounted) setMaximized(value); }).catch(() => undefined); };
    syncMaximized();
    void appWindow.onResized(syncMaximized).then((stop) => { if (mounted) unlisten = stop; else stop(); }).catch(() => undefined);
    return () => { mounted = false; unlisten?.(); };
  }, [desktop]);

  const windowAction = (action: 'minimize' | 'maximize' | 'close') => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    const operation = action === 'minimize' ? appWindow.minimize() : action === 'maximize' ? appWindow.toggleMaximize() : appWindow.close();
    void operation.catch(() => undefined);
  };

  return <Localized><header className="topbar" data-tauri-drag-region>
    <div className="topbar-brand-drag" data-tauri-drag-region><Logo compact /></div>
    <div className="topbar-spacer" data-tauri-drag-region />
    <button type="button" className="topbar-search" aria-label="Buscar comandos" title="Buscar comandos (Ctrl / ⌘ P)" onClick={onCommandPalette}><Search size={14} /><span>Buscar</span></button>
    {!['idle', 'up-to-date', 'checking'].includes(update.phase) && <button type="button" className={`update-center-button${update.phase === 'available' || update.phase === 'downloaded' ? ' has-update' : ''}${isBusy ? ' is-busy' : ''}`} aria-label={updateLabel} title={updateLabel} onClick={onUpdateAction} disabled={isBusy}><UpdateIcon size={15} strokeWidth={1.9} />{(update.phase === 'available' || update.phase === 'downloaded') && <span className="update-center-dot" aria-hidden="true" />}</button>}
    {desktop && <div className="window-controls" role="group" aria-label="Controles de ventana">
      <button type="button" className="window-control" aria-label="Minimizar ventana" title="Minimizar" onClick={() => windowAction('minimize')}><Minus size={13} strokeWidth={1.7} /></button>
      <button type="button" className="window-control" aria-label={maximized ? 'Restaurar ventana' : 'Maximizar ventana'} title={maximized ? 'Restaurar' : 'Maximizar'} onClick={() => windowAction('maximize')}>{maximized ? <Copy size={12} strokeWidth={1.65} /> : <Square size={11} strokeWidth={1.7} />}</button>
      <button type="button" className="window-control window-control--close" aria-label="Cerrar ventana" title="Cerrar" onClick={() => windowAction('close')}><X size={14} strokeWidth={1.7} /></button>
    </div>}
  </header></Localized>;
}
