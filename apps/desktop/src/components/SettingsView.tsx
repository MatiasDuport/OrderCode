import { useEffect, useState } from 'react';
import { Activity, Accessibility, Cable, Code2, Database, Download, Moon, PlugZap, ShieldCheck, SlidersHorizontal, WalletCards } from 'lucide-react';
import { useDesktopStore } from '../lib/store';
import { chatgptAccountStatus, connectChatGPT, createCompatibleProvider, deleteCompatibleProvider, disconnectChatGPT, health, isDesktopApp, listProviders, providerKeysStatus, removeProviderCredential, setProviderCredential, updateSession } from '../lib/ipc';
import type { ExecutionBudget } from '../lib/contracts';
import type { ReactNode } from 'react';
import { Localized } from '../lib/localization';
import { UpdaterSettings } from './UpdaterSettings';

const categories = [
  { id: 'general', label: 'General', description: 'Idioma, apariencia y preferencias de interfaz', icon: SlidersHorizontal },
  { id: 'models', label: 'Modelos y proveedores', description: 'Proveedores, credenciales y endpoints', icon: PlugZap },
  { id: 'usage', label: 'Uso y límites', description: 'Topes de la sesión activa', icon: WalletCards },
  { id: 'permissions', label: 'Permisos y seguridad', description: 'Perfil de autorización y credenciales', icon: ShieldCheck },
  { id: 'runtime', label: 'Runtime y conexiones', description: 'Estado del Harness local', icon: Cable },
  { id: 'editor', label: 'Editor y terminal', description: 'Preferencias de escritura y consola', icon: Code2 },
  { id: 'accessibility', label: 'Accesibilidad', description: 'Atajos de teclado y accesibilidad', icon: Accessibility },
  { id: 'data', label: 'Datos y diagnóstico', description: 'Almacenamiento local y diagnóstico', icon: Database },
  { id: 'updates', label: 'Actualizaciones', description: 'Versiones públicas de OrderCode', icon: Download },
] as const;

type CategoryId = typeof categories[number]['id'];
type Provider = { id: string; label: string; baseUrl: string; configured: boolean; custom?: boolean };

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div className="settings-section-heading"><h2>{title}</h2><p>{description}</p></div>;
}

function PreferenceRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="settings-preference-row"><div><strong>{title}</strong><small>{description}</small></div><div className="settings-preference-control">{children}</div></div>;
}

export function SettingsView({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const { session, health: runtimeHealth, language, themePreference, density, reducedMotion, editorFontSize, tabSize, terminalFontSize, settingsSection, set } = useDesktopStore();
  const [category, setCategory] = useState<CategoryId>('general');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [storedKeys, setStoredKeys] = useState<Record<string, boolean>>({});
  const [chatgpt, setChatgpt] = useState<{ connected: boolean; email?: string | null }>({ connected: false });
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [providerError, setProviderError] = useState('');
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState({ label: '', baseUrl: '', apiKey: '' });
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  const [limits, setLimits] = useState({ input: '', output: '', cost: '', tools: '', minutes: '' });
  const [savingLimits, setSavingLimits] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState('');
  const [checkingRuntime, setCheckingRuntime] = useState(false);
  const [connectingChatGPT, setConnectingChatGPT] = useState(false);

  useEffect(() => {
    if (categories.some((item) => item.id === settingsSection)) setCategory(settingsSection as CategoryId);
  }, [settingsSection]);

  useEffect(() => {
    const budget = session?.budget;
    setLimits({ input: budget?.maxInputTokens == null ? '' : String(budget.maxInputTokens), output: budget?.maxOutputTokens == null ? '' : String(budget.maxOutputTokens), cost: budget?.maxCostUsd == null ? '' : String(budget.maxCostUsd), tools: budget?.maxToolCalls == null ? '' : String(budget.maxToolCalls), minutes: budget?.maxDurationMs == null ? '' : String(Math.ceil(budget.maxDurationMs / 60_000)) });
  }, [session?.id, session?.budget]);

  const refreshProviders = async () => {
    const next = await listProviders();
    const [credentials, account] = await Promise.all([providerKeysStatus(next.map((provider) => provider.id)), chatgptAccountStatus()]);
    setProviders(next);
    setStoredKeys(credentials);
    setChatgpt(account);
    setProviderError('');
  };
  useEffect(() => { void refreshProviders().catch((cause) => setProviderError(cause instanceof Error ? cause.message : String(cause))); }, []);

  const saveLimits = async () => {
    if (!session || savingLimits) return;
    const integer = (value: string, multiplier = 1): number | null => {
      if (!value.trim()) return null;
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0) throw new Error('Los límites enteros deben ser cero o mayores, o quedar vacíos para no fijar un tope.');
      return number * multiplier;
    };
    try {
      const cost = limits.cost.trim() ? Number(limits.cost) : null;
      if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > 1_000_000)) throw new Error('El coste máximo debe estar entre $0 y $1.000.000 USD.');
      const budget: ExecutionBudget = { maxInputTokens: integer(limits.input), maxOutputTokens: integer(limits.output), maxCostUsd: cost, maxDurationMs: integer(limits.minutes, 60_000), maxToolCalls: integer(limits.tools) };
      const updated = { ...session, budget };
      setSavingLimits(true);
      set('session', updated);
      await updateSession(updated);
      set('sessions', useDesktopStore.getState().sessions.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setProviderError(cause instanceof Error ? cause.message : String(cause));
      const active = useDesktopStore.getState().session;
      if (active?.id === session.id) set('session', { ...active, budget: session.budget });
    } finally { setSavingLimits(false); }
  };

  const addEndpoint = async () => {
    if (!endpoint.label.trim() || !endpoint.baseUrl.trim() || !endpoint.apiKey.trim() || savingEndpoint) return;
    setSavingEndpoint(true); setProviderError('');
    try {
      const created = await createCompatibleProvider(endpoint.label.trim(), endpoint.baseUrl.trim());
      await setProviderCredential(created.id, endpoint.apiKey.trim());
      setEndpoint({ label: '', baseUrl: '', apiKey: '' });
      await refreshProviders();
    } catch (cause) { setProviderError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSavingEndpoint(false); }
  };

  const updateCredential = async (providerId: string, key: string | null) => {
    if (busyProvider) return;
    setBusyProvider(providerId); setProviderError('');
    try {
      if (key === null) await removeProviderCredential(providerId);
      else await setProviderCredential(providerId, key);
      setKeyDrafts((current) => ({ ...current, [providerId]: '' }));
      await refreshProviders();
    } catch (cause) { setProviderError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyProvider(null); }
  };

  const verifyRuntime = async () => {
    setCheckingRuntime(true); setRuntimeStatus('');
    try { const result = await health(); set('health', result); setRuntimeStatus(result.harnessConnected ? 'El Harness local responde correctamente.' : 'El Runtime se inició, pero el Harness no está conectado.'); }
    catch (cause) { setRuntimeStatus(cause instanceof Error ? cause.message : String(cause)); }
    finally { setCheckingRuntime(false); }
  };

  const updateChatGPTConnection = async (connect: boolean) => {
    if (connectingChatGPT) return;
    setConnectingChatGPT(true); setProviderError('');
    try { setChatgpt(connect ? await connectChatGPT() : await disconnectChatGPT()); await refreshProviders(); }
    catch (cause) { setProviderError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setConnectingChatGPT(false); }
  };

  const selectedProviderCount = providers.filter((item) => item.configured || item.id === 'ollama' || item.id === 'lmstudio' || (item.id === 'openai_chatgpt' && chatgpt.connected)).length;
  const permissionName = session?.permission ?? 'Guiado';
  const renderContent = () => {
    if (category === 'general') return <>
      <SectionHeading title="General" description="Ajusta el idioma y la apariencia del entorno de trabajo." />
      <div className="settings-card">
        <PreferenceRow title="Idioma" description="Elige el idioma de la interfaz. Automático usa el idioma preferido del sistema."><select value={language} onChange={(event) => set('language', event.target.value as typeof language)}><option value="system">Automático</option><option value="es">Español</option><option value="en">Inglés</option></select></PreferenceRow>
        <PreferenceRow title="Tema" description="El tema automático sigue la apariencia del sistema operativo."><select value={themePreference} onChange={(event) => set('themePreference', event.target.value as typeof themePreference)}><option value="system">Automático</option><option value="dark">Oscuro</option><option value="light">Claro</option></select></PreferenceRow>
        <PreferenceRow title="Densidad de interfaz" description="Compacta muestra más elementos; cómoda añade aire entre controles."><select value={density} onChange={(event) => set('density', event.target.value as typeof density)}><option value="comfortable">Cómoda</option><option value="compact">Compacta</option></select></PreferenceRow>
        <PreferenceRow title="Movimiento reducido" description="Reduce animaciones y transiciones en toda la interfaz."><input className="settings-checkbox" type="checkbox" checked={reducedMotion} onChange={(event) => set('reducedMotion', event.target.checked)} /></PreferenceRow>
        <div className="settings-inline-note"><Moon size={14} /><span>Las preferencias se guardan automáticamente en este dispositivo.</span></div>
      </div>
    </>;
    if (category === 'models') return <>
      <SectionHeading title="Modelos y proveedores" description="Administra credenciales y endpoints. El modelo de cada conversación se selecciona en el Composer." />
      <div className="settings-card settings-provider-summary"><span className="settings-status-dot" /><strong>{selectedProviderCount} proveedores disponibles</strong><small>Las claves se almacenan en el almacén seguro del sistema operativo. No se muestran después de guardarlas.</small></div>
      {providers.map((provider) => {
        const local = provider.id === 'ollama' || provider.id === 'lmstudio';
        const openCode = provider.id === 'opencode_zen';
        const openRouter = provider.id === 'openrouter';
        const openAi = provider.id === 'openai';
        const chatGPTPlan = provider.id === 'openai_chatgpt';
        const providerNote = local ? 'El endpoint local se consulta al descubrir modelos.' : openCode ? <>Modelos gratuitos publicados por OpenCode. <a href="https://opencode.ai/console/" target="_blank" rel="noreferrer">Obtener clave</a> · <a href="https://opencode.ai/v2/docs/console/models/" target="_blank" rel="noreferrer">Modelos y precios</a></> : 'El coste aparece solo si hay precios verificables.';
        return <article className="settings-provider-card" key={provider.id}>
          <div className="settings-provider-copy"><strong>{chatGPTPlan ? 'ChatGPT con tu cuenta' : provider.label}</strong><span>{chatGPTPlan ? chatgpt.connected ? `Conectado${chatgpt.email ? ` · ${chatgpt.email}` : ''}` : 'Sin conectar' : local ? 'Proveedor local' : storedKeys[provider.id] ? 'Clave guardada en el sistema' : provider.configured ? 'Clave disponible en el entorno' : 'Sin configurar'}</span><small>{provider.id} · {chatGPTPlan ? 'Usa los modelos que tu cuenta tenga habilitados mediante el acceso oficial al plan ChatGPT. Aplican sus límites de uso.' : providerNote}</small>{openRouter && <small>Catálogo actualizado de cientos de modelos de distintos proveedores, con precios gratuitos identificados cuando se verifican. Puedes descubrirlos sin clave; para enviar solicitudes debes conectar una clave de OpenRouter.</small>}{openAi && <small>La clave de API usa la facturación de la plataforma API de OpenAI; no consume la suscripción de ChatGPT.</small>}{chatGPTPlan && <small>La sesión se guarda cifrada por el almacén seguro del sistema. Las credenciales no se envían al frontend.</small>}</div>
          {chatGPTPlan ? <div className="settings-provider-actions"><button type="button" disabled={!isDesktopApp() || connectingChatGPT} onClick={() => void updateChatGPTConnection(true)}>{connectingChatGPT ? 'Conectando…' : 'Continue with ChatGPT'}</button>{chatgpt.connected && <button type="button" disabled={connectingChatGPT} onClick={() => void updateChatGPTConnection(false)}>{connectingChatGPT ? 'Procesando…' : 'Desconectar cuenta'}</button>}</div> : !local && <div className="settings-provider-actions"><input type="password" autoComplete="new-password" value={keyDrafts[provider.id] ?? ''} onChange={(event) => setKeyDrafts({ ...keyDrafts, [provider.id]: event.target.value })} placeholder="Clave API" aria-label={`Clave API ${provider.label}`} /><button type="button" disabled={!keyDrafts[provider.id]?.trim() || busyProvider === provider.id} onClick={() => void updateCredential(provider.id, keyDrafts[provider.id]?.trim() ?? '')}>{busyProvider === provider.id ? 'Guardando…' : 'Guardar clave'}</button>{storedKeys[provider.id] && <button type="button" disabled={busyProvider === provider.id} onClick={() => void updateCredential(provider.id, null)}>{busyProvider === provider.id ? 'Procesando…' : 'Eliminar clave'}</button>}</div>}
        </article>;
      })}
      <section className="settings-card"><div className="settings-card-heading"><strong>Endpoint compatible</strong><span>OPENAI API</span></div><p>Añade proveedores compatibles con Chat Completions. Usa HTTPS; HTTP solo se permite en servicios locales. El nombre y la URL se guardan localmente; la clave se guarda en el almacén seguro del sistema.</p><div className="settings-form-grid"><label>Nombre<input value={endpoint.label} maxLength={80} onChange={(event) => setEndpoint({ ...endpoint, label: event.target.value })} placeholder="Mi proveedor" /></label><label>URL base<input value={endpoint.baseUrl} maxLength={2000} onChange={(event) => setEndpoint({ ...endpoint, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label><label>Clave API<input type="password" autoComplete="new-password" value={endpoint.apiKey} maxLength={4096} onChange={(event) => setEndpoint({ ...endpoint, apiKey: event.target.value })} placeholder="Clave del proveedor" /></label></div><button type="button" className="settings-primary-action" onClick={() => void addEndpoint()} disabled={!endpoint.label.trim() || !endpoint.baseUrl.trim() || !endpoint.apiKey.trim() || savingEndpoint}>{savingEndpoint ? 'Guardando…' : 'Añadir proveedor'}</button>
        {providers.filter((provider) => provider.custom).map((provider) => <div className="settings-custom-provider" key={provider.id}><div><strong>{provider.label}</strong><small>{provider.baseUrl} · {provider.configured ? 'Listo' : 'Falta configurar la clave'}</small></div><button type="button" disabled={busyProvider === provider.id} onClick={() => { setBusyProvider(provider.id); void deleteCompatibleProvider(provider.id).then(refreshProviders).catch((cause) => setProviderError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusyProvider(null)); }}>{busyProvider === provider.id ? 'Eliminando…' : 'Eliminar endpoint'}</button></div>)}</section>
      {providerError && <div className="settings-error" role="alert">{providerError}</div>}
    </>;
    if (category === 'usage') return <>
      <SectionHeading title="Uso y límites" description="Fija topes para la sesión activa. Los campos vacíos no limitan el uso." />
      <section className="settings-card settings-budget-card"><div className="settings-card-heading"><strong>Límites de la sesión</strong><span>{session ? 'GUARDADO EN EL HARNESS' : 'SIN SESIÓN ACTIVA'}</span></div><p>Los límites se aplican a cada ejecución de esta sesión con los datos de uso que informa el proveedor.</p><div className="settings-form-grid">
        {([['input', 'Tokens de entrada'], ['output', 'Tokens de salida'], ['cost', 'Coste máximo (USD)'], ['tools', 'Llamadas de herramientas'], ['minutes', 'Duración máxima (minutos)']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step={key === 'cost' ? '0.01' : '1'} max={key === 'cost' ? '1000000' : undefined} value={limits[key]} placeholder="Sin límite" disabled={!session} onChange={(event) => setLimits({ ...limits, [key]: event.target.value })} /></label>)}
      </div><button type="button" className="settings-primary-action" onClick={() => void saveLimits()} disabled={!session || savingLimits}>{savingLimits ? 'Guardando…' : 'Guardar límites'}</button><small className="settings-footnote">El límite de salida se envía al proveedor. El de entrada se comprueba al finalizar cada llamada. El límite económico usa precios actuales del modelo y una estimación preventiva.</small></section>
      {!session && <div className="settings-inline-note"><Activity size={14} /><span>Abre o conecta un workspace para configurar límites por sesión.</span><button type="button" onClick={onOpenWorkspace}>Ir al workspace</button></div>}
      {providerError && <div className="settings-error" role="alert">{providerError}</div>}
    </>;
    if (category === 'permissions') return <>
      <SectionHeading title="Permisos y seguridad" description="Revisa el perfil de autorización activo y dónde se almacenan las credenciales." />
      <div className="settings-card settings-security-card"><ShieldCheck size={18} /><div><strong>Perfil de permisos de la conversación</strong><span>{permissionName}</span><small>El Harness valida cada herramienta, acción, recurso y destino antes de ejecutarla.</small></div><button type="button" onClick={onOpenWorkspace}>Revisar en el Composer</button></div>
      <div className="settings-card settings-info-card"><strong>Trabajo automático y permisos son independientes</strong><p>Auto decide cuándo planificar, implementar y verificar. El perfil de permisos decide qué acciones requieren autorización. Cambiar el modo de trabajo no amplía permisos.</p></div>
      <div className="settings-card settings-info-card"><strong>Credenciales</strong><p>Las claves de proveedores se guardan en el almacén seguro del sistema operativo. Esta pantalla solo muestra si una clave existe; nunca puede volver a leer su contenido.</p></div>
    </>;
    if (category === 'runtime') return <>
      <SectionHeading title="Runtime y conexiones" description="Estado del broker local, la plataforma y los proveedores detectados." />
      <div className="settings-card settings-runtime-grid"><div><span>HARNESS</span><strong className={runtimeHealth?.harnessConnected ? 'is-connected' : ''}>{runtimeHealth?.harnessConnected ? 'Conectado' : 'No conectado'}</strong><small>{runtimeHealth?.version ? `Versión ${runtimeHealth.version}` : 'Sin información de versión'}</small></div><div><span>PLATAFORMA</span><strong>{runtimeHealth?.platform ?? 'Vista previa web'}</strong><small>Procesos gestionados bajo los controles del Desktop.</small></div><div><span>PROVEEDORES</span><strong>{selectedProviderCount} listos</strong><small>{providers.length} registrados en el catálogo local.</small></div></div>
      <button type="button" className="settings-primary-action" onClick={() => void verifyRuntime()} disabled={checkingRuntime}>{checkingRuntime ? 'Comprobando…' : 'Comprobar conexión'}</button>{runtimeStatus && <p className="settings-runtime-result" role="status">{runtimeStatus}</p>}
    </>;
    if (category === 'editor') return <>
      <SectionHeading title="Editor y terminal" description="Personaliza la lectura y escritura de código. Los cambios se aplican al instante." />
      <div className="settings-card">
        <PreferenceRow title="Tamaño de fuente del editor" description="Tamaño en píxeles para el editor de código."><select value={editorFontSize} onChange={(event) => set('editorFontSize', Number(event.target.value))}>{[10, 11, 12, 13, 14, 15, 16, 18].map((size) => <option key={size} value={size}>{size}px</option>)}</select></PreferenceRow>
        <PreferenceRow title="Tamaño de tabulación" description="Espacios insertados al pulsar Tab en el editor."><select value={tabSize} onChange={(event) => set('tabSize', Number(event.target.value) as typeof tabSize)}><option value={2}>2 espacios</option><option value={4}>4 espacios</option><option value={8}>8 espacios</option></select></PreferenceRow>
        <PreferenceRow title="Tamaño de fuente de terminal" description="Tamaño en píxeles para la terminal integrada."><select value={terminalFontSize} onChange={(event) => set('terminalFontSize', Number(event.target.value))}>{[9, 10, 11, 12, 13, 14, 16].map((size) => <option key={size} value={size}>{size}px</option>)}</select></PreferenceRow>
      </div>
    </>;
    if (category === 'accessibility') return <>
      <SectionHeading title="Accesibilidad" description="La interfaz puede usarse con teclado y admite reducción de movimiento y densidad ajustable desde General." />
      <div className="settings-card settings-shortcuts"><strong>Atajos disponibles</strong><span><kbd>Ctrl / ⌘ P</kbd> Paleta de comandos</span><span><kbd>Ctrl / ⌘ L</kbd> Enfocar conversación</span><span><kbd>Ctrl / ⌘ ⇧ D</kbd> Revisión de cambios</span><span><kbd>Ctrl / ⌘ J</kbd> Alternar terminal</span><span><kbd>Esc</kbd> Cerrar paleta o cancelar ejecución</span></div>
    </>;
    if (category === 'updates') return <UpdaterSettings />;
    return <>
      <SectionHeading title="Datos y diagnóstico" description="Información local de OrderCode y comprobaciones del Harness." />
      <div className="settings-card settings-info-card"><strong>Datos almacenados en este dispositivo</strong><p>Las preferencias de interfaz se guardan localmente en este perfil. Las sesiones, eventos y configuración de proveedores se conservan en la base local del Harness. Las credenciales se mantienen en el almacén seguro del sistema.</p></div>
      <div className="settings-runtime-grid"><div><span>ESTADO</span><strong>{runtimeHealth?.harnessConnected ? 'Operativo' : 'Vista previa web'}</strong><small>{runtimeHealth?.version ? `Harness ${runtimeHealth.version}` : 'El broker nativo informa detalles al iniciar la aplicación Desktop.'}</small></div><div><span>ALMACENAMIENTO</span><strong>Local</strong><small>Las claves y los detalles de credenciales no se incluyen aquí.</small></div></div>
      <button type="button" className="settings-primary-action" onClick={() => void verifyRuntime()} disabled={checkingRuntime}>{checkingRuntime ? 'Comprobando…' : 'Ejecutar diagnóstico'}</button>{runtimeStatus && <p className="settings-runtime-result" role="status">{runtimeStatus}</p>}
    </>;
  };

  return <Localized><div className="surface-page settings-page"><header className="settings-page-heading"><div><h1>Settings</h1><p>Preferencias, conexiones y controles del Harness local.</p></div></header><div className="settings-layout"><nav className="settings-nav" aria-label="Secciones de ajustes">{categories.map(({ id, label, description, icon: Icon }) => <button type="button" key={id} className={category === id ? 'is-active' : ''} aria-current={category === id ? 'page' : undefined} onClick={() => { setCategory(id); set('settingsSection', id); }}><Icon size={15} /><span><strong>{label}</strong><small>{description}</small></span></button>)}</nav><main className="settings-content" aria-live="polite"><div className="settings-section-content" key={category}>{renderContent()}</div></main></div></div></Localized>;
}
