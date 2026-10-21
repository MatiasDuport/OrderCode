import { create } from 'zustand';
import type { BrokerHealth, HarnessEvent, PermissionProfile, RuntimeState, SessionRecord, TerminalSessionInfo, WorkMode, WorkspaceFileContent } from './contracts';

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
  hiddenModelProviders: string[];
  showAdvancedModels: boolean;
  recentModels: string[];
  favoriteModels: string[];
}

const PREFERENCES_KEY = 'ordercode.desktop.preferences.v1';
const preferenceDefaults: UserPreferences = { language: 'system', themePreference: 'dark', density: 'comfortable', reducedMotion: false, autoCheckUpdates: true, editorFontSize: 12, tabSize: 2, terminalFontSize: 11, hiddenModelProviders: [], showAdvancedModels: false, recentModels: [], favoriteModels: [] };

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
      hiddenModelProviders: Array.isArray(saved.hiddenModelProviders) ? [...new Set(saved.hiddenModelProviders.filter((item): item is string => typeof item === 'string' && item.length <= 100))].slice(0, 100) : preferenceDefaults.hiddenModelProviders,
      showAdvancedModels: typeof saved.showAdvancedModels === 'boolean' ? saved.showAdvancedModels : preferenceDefaults.showAdvancedModels,
      recentModels: Array.isArray(saved.recentModels) ? [...new Set(saved.recentModels.filter((item): item is string => typeof item === 'string' && item.length <= 400))].slice(0, 5) : preferenceDefaults.recentModels,
      favoriteModels: Array.isArray(saved.favoriteModels) ? [...new Set(saved.favoriteModels.filter((item): item is string => typeof item === 'string' && item.length <= 400))].slice(0, 100) : preferenceDefaults.favoriteModels,
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

// Keep keystrokes local to the composer subscription; drafts never enter persisted preferences.
export const useComposerDraftStore = create<{
  drafts: Record<string, string>;
  setDraft: (key: string, next: string | ((current: string) => string)) => void;
  adoptDraft: (sessionId: string) => void;
}>((set) => ({
  drafts: {},
  setDraft: (key, next) => set((state) => {
    const drafts = { ...state.drafts };
    const value = typeof next === 'function' ? next(drafts[key] ?? '') : next;
    if (value) drafts[key] = value;
    else delete drafts[key];
    return { drafts };
  }),
  adoptDraft: (sessionId) => set((state) => {
    if (!state.drafts.__new__) return state;
    const drafts = { ...state.drafts };
    drafts[sessionId] ??= drafts.__new__!;
    delete drafts.__new__;
    return { drafts };
  }),
}));

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
  hiddenModelProviders: string[];
  showAdvancedModels: boolean;
  recentModels: string[];
  favoriteModels: string[];
  currentView: string;
  settingsSection: string;
  sidebarOpen: boolean;
  reviewOpen: boolean;
  previewOpen: boolean;
  previewRequest: { url: string; id: string; projectPath?: string } | null;
  terminalOpen: boolean;
  terminalSessions: TerminalSessionInfo[];
  terminalBuffers: Record<string, string>;
  activeTerminalId: string | null;
  model: string;
  reasoningEffort: string | undefined;
  freeOnly: boolean;
  agentId: string;
  mode: WorkMode;
  permission: PermissionProfile;
  runtimeState: RuntimeState;
  pendingPermission: Record<string, unknown> | null;
  session: SessionRecord | null;
  sessionRevision: number;
  sessions: SessionRecord[];
  health: BrokerHealth | null;
  updateView: UpdateViewState;
  messages: ChatMessage[];
  streamingText: string;
  events: HarnessEvent[];
  openFile: string | null;
  filePreview: WorkspaceFileContent | null;
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
  previewOpen: false,
  previewRequest: null,
  terminalOpen: false,
  terminalSessions: [],
  terminalBuffers: {},
  activeTerminalId: null,
  model: '',
  reasoningEffort: undefined,
  freeOnly: false,
  agentId: 'general',
  mode: 'Auto',
  permission: 'Guiado',
  runtimeState: 'CREATED',
  pendingPermission: null,
  session: null,
  sessionRevision: 0,
  sessions: [],
  health: null,
  updateView: initialUpdateViewState,
  messages: [],
  streamingText: '',
  events: [],
  openFile: null,
  filePreview: null,
  editorContent: '',
  editorOriginal: '',
  set: (key, value) => set((state) => {
    const next = { [key]: value } as Partial<DesktopState>;
    if (key === 'reviewOpen' && value === true) next.previewOpen = false;
    if (key === 'previewOpen' && value === true) next.reviewOpen = false;
    if (key === 'openFile' && value !== state.openFile) next.filePreview = null;
    if (key === 'session' && (value as SessionRecord | null)?.id !== state.session?.id) next.filePreview = null;
    if (key === 'session') next.reasoningEffort = (value as SessionRecord | null)?.reasoningEffort;
    if (key === 'session' && (value as SessionRecord | null)?.projectPath !== state.session?.projectPath) next.previewRequest = null;
    if (key === 'session' && value && !state.session) useComposerDraftStore.getState().adoptDraft((value as SessionRecord).id);
    if (key === 'session' && (value as SessionRecord | null)?.id !== state.session?.id) next.sessionRevision = state.sessionRevision + 1;
    if (key === 'theme') next.themePreference = value as ThemePreference;
    if (key === 'themePreference') next.theme = resolveTheme(value as ThemePreference);
    const updated = { ...state, ...next };
    if (['theme', 'themePreference', 'language', 'density', 'reducedMotion', 'autoCheckUpdates', 'editorFontSize', 'tabSize', 'terminalFontSize', 'hiddenModelProviders', 'showAdvancedModels', 'recentModels', 'favoriteModels'].includes(key)) {
      try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
          language: updated.language, themePreference: updated.themePreference, density: updated.density,
          reducedMotion: updated.reducedMotion, autoCheckUpdates: updated.autoCheckUpdates, editorFontSize: updated.editorFontSize, tabSize: updated.tabSize,
          terminalFontSize: updated.terminalFontSize, hiddenModelProviders: updated.hiddenModelProviders,
          showAdvancedModels: updated.showAdvancedModels, recentModels: updated.recentModels, favoriteModels: updated.favoriteModels,
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
    const isLifecycle = /^(run\.(started|completed|failed|cancelled)|session\.state|permission\.requested)$/.test(event.type ?? event.summary);
    const lifecycle = isLifecycle ? events.filter((item) => item.runId && /^(run\.(started|completed|failed|cancelled)|session\.state|permission\.requested)$/.test(item.type ?? item.summary)).at(-1) : undefined;
    const resolvedPending = event.type === 'permission.resolved' && state.pendingPermission?.id === event.permissionRequestId;
    return { events, ...(lifecycle ? { runtimeState: lifecycle.state } : {}), ...(event.permissionRequest ? { pendingPermission: event.permissionRequest } : resolvedPending ? { pendingPermission: null } : {}), ...(event.summary === 'provider.chunk' ? { streamingText: state.streamingText + (event.detail ?? '') } : {}) };
  }),
  resetSession: () => set((state) => ({ session: null, reasoningEffort: undefined, sessionRevision: state.sessionRevision + 1, messages: [], streamingText: '', events: [], runtimeState: 'CREATED', pendingPermission: null, openFile: null, filePreview: null, editorContent: '', editorOriginal: '' })),
}));
