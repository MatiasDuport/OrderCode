import { GitBranch } from 'lucide-react';
import { StatusDot } from './ui';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';

export function StatusBar() {
  const { session, runtimeState, health } = useDesktopStore();
  const runtimeLabel = health?.harnessConnected ? 'Harness conectado' : 'Harness no conectado';
  return <Localized><footer className="statusbar"><span><GitBranch size={12} />{session ? 'Workspace' : 'Sin workspace'}</span><span>{session ? runtimeState.toLowerCase().replaceAll('_', ' ') : 'Sin sesión activa'}</span><span className="panel-title-spacer" /><span><StatusDot color={health?.harnessConnected ? 'green' : 'muted'} />{runtimeLabel}</span></footer></Localized>;
}
