import { create } from 'zustand';
import type { BrokerHealth, HarnessEvent, PermissionProfile, RuntimeState, SessionRecord, TerminalSessionInfo, WorkMode } from './contracts';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  refs?: string[];
}

export type AppLanguage = 'system' | 'es' | 'en';
export type ThemePreference = 'system' | 'dark' | 'light';
export type InterfaceDensity = 'comfortable' | 'compact';

interface UserPreferences {
  language: AppLanguage;
  themePreference: ThemePreference;
  density: InterfaceDensity;
  reducedMotion: boolean;
  autoCheckUpdates: boolean;
  editorFontSize: number;
  tabSize: 2 | 4 | 8;
  terminalFontSize: number;
}

const PREFERENCES_KEY = 'ordercode.desktop.preferences.v1';
const preferenceDefaults: UserPreferences = { language: 'system', themePreference: 'dark', density: 'comfortable', reducedMotion: false, autoCheckUpdates: true, editorFontSize: 12, tabSize: 2, terminalFontSize: 11 };

function loadPreferences(): UserPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return preferenceDefaults;
    const saved = value as Partial<UserPreferences>;
    return {
      language: saved.language === 'es' || saved.language === 'en' || saved.language === 'system' ? saved.language : preferenceDefaults.language,
      themePreference: saved.themePreference === 'dark' || saved.themePreference === 'light' || saved.themePreference === 'system' ? saved.themePreference : preferenceDefaults.themePreference,
      density: saved.density === 'compact' || saved.density === 'comfortable' ? saved.density : preferenceDefaults.density,
      reducedMotion: typeof saved.reducedMotion === 'boolean' ? saved.reducedMotion : preferenceDefaults.reducedMotion,
      autoCheckUpdates: typeof saved.autoCheckUpdates === 'boolean' ? saved.autoCheckUpdates : preferenceDefaults.autoCheckUpdates,
      editorFontSize: Number.isInteger(saved.editorFontSize) && saved.editorFontSize! >= 10 && saved.editorFontSize! <= 18 ? saved.editorFontSize! : preferenceDefaults.editorFontSize,
      tabSize: saved.tabSize === 2 || saved.tabSize === 4 || saved.tabSize === 8 ? saved.tabSize : preferenceDefaults.tabSize,
      terminalFontSize: Number.isInteger(saved.terminalFontSize) && saved.terminalFontSize! >= 9 && saved.terminalFontSize! <= 16 ? saved.terminalFontSize! : preferenceDefaults.terminalFontSize,
    };
  } catch { return preferenceDefaults; }
}

function resolveTheme(preference: ThemePreference): 'dark' | 'light' {
  if (preference === 'dark' || preference === 'light') return preference;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const initialPreferences = loadPreferences();

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'up-to-date' | 'error';
export interface UpdateViewState {
  phase: UpdatePhase;
  version?: string;
  currentVersion?: string;
  notes?: string;
  publishedAt?: string;
  downloadedBytes: number;
  contentLength?: number;
  lastCheckedAt?: string;
  error?: string;
}

export const initialUpdateViewState: UpdateViewState = { phase: 'idle', downloadedBytes: 0 };

interface DesktopState {
  theme: 'dark' | 'light';
  themePreference: ThemePreference;
  language: AppLanguage;
  density: InterfaceDensity;
  reducedMotion: boolean;
  autoCheckUpdates: boolean;
  editorFontSize: number;
  tabSize: 2 | 4 | 8;
  terminalFontSize: number;
  currentView: string;
  settingsSection: string;
  sidebarOpen: boolean;
  reviewOpen: boolean;
  terminalOpen: boolean;
  terminalSessions: TerminalSessionInfo[];
  terminalBuffers: Record<string, string>;
  activeTerminalId: string | null;
  model: string;
  freeOnly: boolean;
  agentId: string;
  mode: WorkMode;
  permission: PermissionProfile;
  runtimeState: RuntimeState;
  pendingPermission: Record<string, unknown> | null;
  session: SessionRecord | null;
  sessions: SessionRecord[];
  health: BrokerHealth | null;
  updateView: UpdateViewState;
  messages: ChatMessage[];
  streamingText: string;
  events: HarnessEvent[];
  openFile: string | null;
  editorContent: string;
  editorOriginal: string;
  set: <K extends keyof DesktopState>(key: K, value: DesktopState[K]) => void;
  addMessage: (message: ChatMessage) => void;
  addEvent: (event: HarnessEvent) => void;
  resetSession: () => void;
}

export const useDesktopStore = create<DesktopState>((set) => ({
  ...initialPreferences,
  theme: resolveTheme(initialPreferences.themePreference),
  currentView: 'Workspace',
  settingsSection: 'general',
  sidebarOpen: false,
  reviewOpen: false,
  terminalOpen: false,
  terminalSessions: [],
  terminalBuffers: {},
  activeTerminalId: null,
  model: '',
  freeOnly: false,
  agentId: 'general',
  mode: 'Build',
  permission: 'Guiado',
  runtimeState: 'CREATED',
  pendingPermission: null,
  session: null,
  sessions: [],
  health: null,
  updateView: initialUpdateViewState,
  messages: [],
  streamingText: '',
  events: [],
  openFile: null,
  editorContent: '',
  editorOriginal: '',
  set: (key, value) => set((state) => {
    const next = { [key]: value } as Partial<DesktopState>;
    if (key === 'theme') next.themePreference = value as ThemePreference;
    if (key === 'themePreference') next.theme = resolveTheme(value as ThemePreference);
    const updated = { ...state, ...next };
    if (['theme', 'themePreference', 'language', 'density', 'reducedMotion', 'autoCheckUpdates', 'editorFontSize', 'tabSize', 'terminalFontSize'].includes(key)) {
      try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
          language: updated.language, themePreference: updated.themePreference, density: updated.density,
          reducedMotion: updated.reducedMotion, autoCheckUpdates: updated.autoCheckUpdates, editorFontSize: updated.editorFontSize, tabSize: updated.tabSize,
          terminalFontSize: updated.terminalFontSize,
        } satisfies UserPreferences));
      } catch { /* The interface remains usable when local persistence is unavailable. */ }
    }
    return next;
  }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  addEvent: (event) => set((state) => {
    if (!state.session || event.sessionId !== state.session.id) return {};
    if (state.events.some((item) => item.id === event.id)) return {};
    const events = [...state.events.filter((item) => item.id !== event.id), event].sort((left, right) => left.sequence - right.sequence);
    return { events, ...(event.runId ? { runtimeState: event.state } : {}), ...(event.permissionRequest ? { pendingPermission: event.permissionRequest } : {}), ...(event.summary === 'provider.chunk' ? { streamingText: state.streamingText + (event.detail ?? '') } : {}) };
  }),
  resetSession: () => set({ session: null, messages: [], streamingText: '', events: [], runtimeState: 'CREATED', pendingPermission: null, openFile: null, editorContent: '', editorOriginal: '' }),
}));
