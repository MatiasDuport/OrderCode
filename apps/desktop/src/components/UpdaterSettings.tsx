import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { useDesktopStore } from '../lib/store';
import { checkForUpdates } from '../lib/updater';

function UpdateStatus() {
  const update = useDesktopStore((state) => state.updateView);
  const date = update.lastCheckedAt ? new Date(update.lastCheckedAt).toLocaleString() : 'Aún no se ha comprobado';
  return <section className="settings-card updater-status-card" aria-live="polite">
    <div className="settings-card-heading"><strong>Estado de actualizaciones</strong><span>WINDOWS · 64 BITS</span></div>
    <p>{update.phase === 'checking' ? 'Buscando una versión nueva…' : update.phase === 'available' ? `OrderCode ${update.version} está disponible.` : update.phase === 'downloading' ? 'Descargando y verificando la firma…' : update.phase === 'downloaded' ? `OrderCode ${update.version} se descargó y verificó. Puedes instalarlo cuando termines tu trabajo.` : update.phase === 'installing' ? 'Cerrando procesos e iniciando el instalador…' : update.phase === 'up-to-date' ? 'Tienes la versión más reciente publicada.' : update.error ?? 'Las actualizaciones públicas están disponibles para todos y no requieren una cuenta de GitHub.'}</p>
    {update.phase === 'available' && update.notes && <div className="updater-release-notes">{update.notes.slice(0, 4000)}</div>}
    {update.phase === 'downloading' && <div className="updater-progress" role="progressbar" aria-label="Progreso de descarga" aria-valuemin={0} aria-valuemax={update.contentLength ?? undefined} aria-valuenow={update.contentLength ? update.downloadedBytes : undefined}><span style={{ width: update.contentLength ? `${Math.min(100, update.downloadedBytes / update.contentLength * 100)}%` : '30%' }} /></div>}
    <div className="updater-status-footer"><small>Última comprobación: {date}</small><button type="button" className="settings-primary-action" disabled={update.phase === 'checking' || update.phase === 'downloading' || update.phase === 'installing'} onClick={() => void checkForUpdates().catch(() => undefined)}><RefreshCw size={13} />{update.phase === 'checking' ? 'Comprobando…' : 'Buscar ahora'}</button></div>
  </section>;
}

export function UpdaterSettings() {
  const autoCheckUpdates = useDesktopStore((state) => state.autoCheckUpdates);
  return <>
    <div className="settings-section-heading"><h2>Actualizaciones</h2><p>Recibe versiones públicas de OrderCode y decide cuándo instalarlas.</p></div>
    <div className="settings-card">
      <div className="settings-preference-row"><div><strong>Buscar actualizaciones automáticamente</strong><small>Comprueba al iniciar OrderCode y cada seis horas. La búsqueda no descarga ni instala nada.</small></div><div className="settings-preference-control"><input className="settings-checkbox" type="checkbox" checked={autoCheckUpdates} onChange={(event) => useDesktopStore.getState().set('autoCheckUpdates', event.target.checked)} aria-label="Buscar actualizaciones automáticamente" /></div></div>
    </div>
    <div className="settings-card updater-public-card">
      <div className="updater-public-icon"><Download size={16} /></div>
      <div className="updater-public-copy"><strong>Actualizaciones públicas</strong><small>Cualquier persona puede buscarlas y descargarlas sin iniciar sesión ni configurar un token.</small></div>
      <ShieldCheck className="updater-public-shield" size={16} aria-label="Paquetes firmados" />
    </div>
    <UpdateStatus />
    <p className="settings-footnote">Solo se instalan paquetes firmados por OrderCode. Antes de instalar, OrderCode comprueba que no haya ejecuciones, aprobaciones pendientes, terminales abiertas ni cambios sin guardar.</p>
  </>;
}
