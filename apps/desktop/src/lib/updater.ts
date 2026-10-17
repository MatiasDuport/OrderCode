import { isDesktopApp, updaterCheck, updaterDownload, updaterInstall, type NativeUpdateMetadata } from './ipc';
import { initialUpdateViewState, useDesktopStore, type UpdateViewState } from './store';

let checkInFlight: Promise<NativeUpdateMetadata | null> | null = null;
let downloadInFlight: Promise<number> | null = null;
function setUpdateView(patch: Partial<UpdateViewState>) {
  useDesktopStore.setState((state) => ({ updateView: { ...state.updateView, ...patch } }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function initializeUpdater(): Promise<boolean> {
  if (!isDesktopApp()) {
    setUpdateView({ ...initialUpdateViewState, phase: 'error', error: 'El actualizador está disponible en OrderCode Desktop.' });
    return false;
  }
  setUpdateView({ phase: 'idle', error: undefined });
  return true;
}

export function checkForUpdates(): Promise<NativeUpdateMetadata | null> {
  if (checkInFlight) return checkInFlight;
  if (!isDesktopApp()) {
    const message = 'La comprobación automática está disponible en OrderCode Desktop.';
    setUpdateView({ phase: 'error', error: message });
    return Promise.reject(new Error(message));
  }
  setUpdateView({ phase: 'checking', error: undefined });
  checkInFlight = updaterCheck().then((update) => {
    const checkedAt = new Date().toISOString();
    if (!update) {
      setUpdateView({ phase: 'up-to-date', version: undefined, currentVersion: undefined, notes: undefined, publishedAt: undefined, downloadedBytes: 0, contentLength: undefined, lastCheckedAt: checkedAt, error: undefined });
      return null;
    }
    setUpdateView({ phase: 'available', version: update.version, currentVersion: update.currentVersion, notes: update.notes ?? undefined, publishedAt: update.publishedAt ?? undefined, downloadedBytes: 0, contentLength: undefined, lastCheckedAt: checkedAt, error: undefined });
    return update;
  }).catch((error: unknown) => {
    const message = errorMessage(error);
    setUpdateView({ phase: 'error', error: message });
    throw new Error(message);
  }).finally(() => { checkInFlight = null; });
  return checkInFlight;
}

export function downloadUpdate(): Promise<number> {
  if (downloadInFlight) return downloadInFlight;
  setUpdateView({ phase: 'downloading', downloadedBytes: 0, contentLength: undefined, error: undefined });
  downloadInFlight = updaterDownload().then((size) => {
    setUpdateView({ phase: 'downloaded', downloadedBytes: size, contentLength: size, error: undefined });
    return size;
  }).catch((error: unknown) => {
    const message = errorMessage(error);
    setUpdateView({ phase: 'available', error: message });
    throw new Error(message);
  }).finally(() => { downloadInFlight = null; });
  return downloadInFlight;
}

export async function installUpdate(): Promise<void> {
  const state = useDesktopStore.getState();
  const wasDownloaded = state.updateView.phase === 'downloaded';
  const editorDirty = state.editorContent !== state.editorOriginal;
  setUpdateView({ phase: 'installing', error: undefined });
  try {
    await updaterInstall(editorDirty);
  } catch (error) {
    const message = errorMessage(error);
    setUpdateView({ phase: wasDownloaded ? 'downloaded' : 'error', error: message });
    throw new Error(message);
  }
}

export function reportUpdateProgress(progress: { downloadedBytes: number; contentLength: number | null; complete: boolean }) {
  setUpdateView({
    phase: progress.complete ? 'downloaded' : 'downloading',
    downloadedBytes: progress.downloadedBytes,
    contentLength: progress.contentLength ?? undefined,
  });
}
