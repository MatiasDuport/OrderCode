import { cloneElement, isValidElement, useEffect, useState } from 'react';
import { Activity, Accessibility, Cable, Code2, Database, Download, Moon, PlugZap, ShieldCheck, SlidersHorizontal, WalletCards } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { useDesktopStore } from '../lib/store';
import { cancelXaiLogin, listProviderModels, chatgptAccountStatus, connectChatGPT, connectXai, createCompatibleProvider, deleteCompatibleProvider, disconnectChatGPT, disconnectXai, health, isDesktopApp, listProviders, providerKeysStatus, removeProviderCredential, setProviderCredential, updateSession, xaiAccountStatus, type XaiDeviceCode } from '../lib/ipc';
import type { ExecutionBudget } from '../lib/contracts';
import type { ReactNode } from 'react';
import { Localized } from '../lib/localization';
import { UpdaterSettings } from './UpdaterSettings';

const categories = [
  { id: 'general', label: 'General', description: 'Idioma, apariencia y preferencias de interfaz', icon: SlidersHorizontal },
  { id: 'models', label: 'Modelos', description: 'Conecta una cuenta o una clave', icon: PlugZap },
  { id: 'usage', label: 'Uso y límites', description: 'Topes de la sesión activa', icon: WalletCards },
  { id: 'permissions', label: 'Seguridad', description: 'Permisos y protección de tus claves', icon: ShieldCheck },
  { id: 'runtime', label: 'Conexión local', description: 'Comprueba el servicio de OrderCode', icon: Cable },
  { id: 'editor', label: 'Editor y terminal', description: 'Preferencias de escritura y consola', icon: Code2 },
  { id: 'accessibility', label: 'Accesibilidad', description: 'Atajos de teclado y accesibilidad', icon: Accessibility },
  { id: 'data', label: 'Datos y diagnóstico', description: 'Almacenamiento local y diagnóstico', icon: Database },
  { id: 'updates', label: 'Actualizaciones', description: 'Versiones públicas de OrderCode', icon: Download },
] as const;

type CategoryId = typeof categories[number]['id'];
const primaryCategoryIds: readonly CategoryId[] = ['general', 'models', 'usage', 'permissions', 'updates'];
type Provider = { id: string; label: string; baseUrl: string; configured: boolean; custom?: boolean };

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div className="settings-section-heading"><h2>{title}</h2><p>{description}</p></div>;
}

function PreferenceRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const control = isValidElement<{ 'aria-label'?: string }>(children) && (children.type === 'select' || children.type === 'input') ? cloneElement(children, { 'aria-label': title }) : children;
  return <div className="settings-preference-row"><div><strong>{title}</strong><small>{description}</small></div><div className="settings-preference-control">{control}</div></div>;
}

export function SettingsView({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const { session, health: runtimeHealth, language, themePreference, density, reducedMotion, editorFontSize, tabSize, terminalFontSize, settingsSection, hiddenModelProviders, showAdvancedModels, recentModels, favoriteModels, set } = useDesktopStore();
  const [category, setCategory] = useState<CategoryId>('general');
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const [connectingXai, setConnectingXai] = useState(false);
  const [xai, setXai] = useState<{ connected: boolean }>({ connected: false });
  const [providerGroup, setProviderGroup] = useState<'plans' | 'api' | 'local'>('plans');
  const [providerChecks, setProviderChecks] = useState<Record<string, { error?: boolean; message: string }>>({});
  const [checkingProvider, setCheckingProvider] = useState<string | null>(null);
  const [xaiDeviceCode, setXaiDeviceCode] = useState<XaiDeviceCode | null>(null);

  useEffect(() => {
    if (categories.some((item) => item.id === settingsSection)) {
      setCategory(settingsSection as CategoryId);
      if (!primaryCategoryIds.includes(settingsSection as CategoryId)) setAdvancedOpen(true);
    }
  }, [settingsSection]);

  useEffect(() => {
    const budget = session?.budget;
    setLimits({ input: budget?.maxInputTokens == null ? '' : String(budget.maxInputTokens), output: budget?.maxOutputTokens == null ? '' : String(budget.maxOutputTokens), cost: budget?.maxCostUsd == null ? '' : String(budget.maxCostUsd), tools: budget?.maxToolCalls == null ? '' : String(budget.maxToolCalls), minutes: budget?.maxDurationMs == null ? '' : String(Math.ceil(budget.maxDurationMs / 60_000)) });
  }, [session?.id, session?.budget]);

  const refreshProviders = async () => {
    const next = await listProviders();
    setProviders(next);
    const results = await Promise.allSettled([providerKeysStatus(next.map((provider) => provider.id)), chatgptAccountStatus(), xaiAccountStatus()]);
    const [credentials, account, xaiAccount] = results;
    if (credentials.status === 'fulfilled') setStoredKeys(credentials.value);
    if (account.status === 'fulfilled') setChatgpt(account.value);
    if (xaiAccount.status === 'fulfilled') setXai(xaiAccount.value);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') setProviderError(String(failure.reason));
    else setProviderError('');
  };
  useEffect(() => { void refreshProviders().catch((cause) => setProviderError(cause instanceof Error ? cause.message : String(cause))); }, [runtimeHealth?.harnessConnected]);
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<XaiDeviceCode>('ordercode-xai-device-code', (event) => { if (active) setXaiDeviceCode(event.payload); }).then((stop) => { if (active) unlisten = stop; else stop(); }).catch(() => undefined);
    return () => { active = false; unlisten?.(); };
  }, []);

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

  const checkProvider = async (providerId: string) => {
    setCheckingProvider(providerId);
    try {
      const models = await listProviderModels(providerId);
      const available = models.filter((model) => model.available).length;
      setProviderChecks((current) => ({ ...current, [providerId]: { error: !available, message: available ? `${available} modelos disponibles. Elige uno en la conversación.` : 'No hay modelos disponibles. Revisa tu acceso, la clave o el servicio local.' } }));
    } catch (cause) { setProviderChecks((current) => ({ ...current, [providerId]: { error: true, message: cause instanceof Error ? cause.message : String(cause) } })); }
    finally { setCheckingProvider(null); }
  };

  const updateCredential = async (providerId: string, key: string | null) => {
    if (busyProvider) return;
    setBusyProvider(providerId); setProviderError('');
    try {
      if (key === null) await removeProviderCredential(providerId);
      else await setProviderCredential(providerId, key);
      setKeyDrafts((current) => ({ ...current, [providerId]: '' }));
      await refreshProviders();
      if (key !== null) await checkProvider(providerId);
      else setProviderChecks((current) => { const next = { ...current }; delete next[providerId]; return next; });
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
    if (connectingChatGPT || connectingXai) return;
    setConnectingChatGPT(true); setProviderError('');
    try { setChatgpt(connect ? await connectChatGPT() : await disconnectChatGPT()); await refreshProviders(); if (connect) await checkProvider('openai_chatgpt'); }
    catch (cause) { setProviderError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setConnectingChatGPT(false); }
  };

  const updateXaiConnection = async (connect: boolean) => {
    if (connectingXai || connectingChatGPT) return;
    setConnectingXai(true); setProviderError(''); setXaiDeviceCode(null);
    try { setXai(connect ? await connectXai() : await disconnectXai()); await refreshProviders(); if (connect) await checkProvider('xai_plan'); setXaiDeviceCode(null); }
    catch (cause) { setProviderError(cause instanceof Error ? cause.message : String(cause)); setXaiDeviceCode(null); }
    finally { setConnectingXai(false); }
  };

  const renderProviderError = () => {
    if (!providerError) return null;
    if (providerError.includes('3p_delegated_access_policy_denied')) return <div className="settings-error" role="alert"><strong>Acceso bloqueado por la política de tu organización</strong><p>Un administrador global de OpenAI debe permitir OrderCode en External access y autorizar el uso delegado del plan ChatGPT. Después, vuelve a conectar la cuenta.</p><a href="https://admin.openai.com/external-access" target="_blank" rel="noreferrer">Abrir External access ↗</a><span>·</span><a href="https://help.openai.com/en/articles/12289294-managing-your-tenant-in-admin-console" target="_blank" rel="noreferrer">Guía de administración ↗</a></div>;
    return <div className="settings-error" role="alert">{providerError}</div>;
  };

  const selectedProviderCount = providers.filter((item) => (item.configured && item.id !== 'ollama' && item.id !== 'lmstudio') || (item.id === 'openai_chatgpt' && chatgpt.connected) || (item.id === 'xai_plan' && xai.connected)).length;
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
      <SectionHeading title="Modelos" description="Conecta una cuenta para empezar. Después, elige el modelo junto al mensaje." />
      <div className="settings-card settings-provider-summary"><span className="settings-status-dot" data-connected={selectedProviderCount > 0} aria-hidden="true" /><strong>{selectedProviderCount} conexiones configuradas</strong><small>Las claves se almacenan en el almacén seguro del sistema operativo. No se muestran después de guardarlas.</small></div>
      {renderProviderError()}
      <div className="settings-provider-tabs" role="tablist" aria-label="Tipo de conexión" onKeyDown={(event) => {
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next]?.focus(); tabs[next]?.click();
      }}>{([{ id: 'plans', label: 'Suscripciones' }, { id: 'api', label: 'Claves API' }, { id: 'local', label: 'Locales' }] as const).map((group) => <button type="button" role="tab" key={group.id} aria-selected={providerGroup === group.id} tabIndex={providerGroup === group.id ? 0 : -1} id={`provider-tab-${group.id}`} aria-controls="provider-connections" onClick={() => setProviderGroup(group.id)}>{group.label}</button>)}</div>
      <div id="provider-connections" role="tabpanel" aria-labelledby={`provider-tab-${providerGroup}`} className="settings-provider-connections">
      <p className="settings-provider-intro">{providerGroup === 'plans' ? 'Conecta tu cuenta o la clave de tu plan. La disponibilidad depende de tu suscripción.' : providerGroup === 'api' ? 'Pega la clave de tu proveedor. Su uso puede tener un coste independiente de tu suscripción de chat.' : 'Usa modelos en tu equipo con Ollama o LM Studio. Abre el servicio y carga un modelo para empezar.'}</p>
      {providers.filter((provider) => {
        const plan = ['openai_chatgpt', 'xai_plan', 'minimax_plan'].includes(provider.id);
        const local = ['ollama', 'lmstudio'].includes(provider.id);
        return providerGroup === 'plans' ? plan : providerGroup === 'local' ? local : !plan && !local;
      }).map((provider) => {
        const local = provider.id === 'ollama' || provider.id === 'lmstudio';
        const openCode = provider.id === 'opencode_zen';
        const openRouter = provider.id === 'openrouter';
        const openAi = provider.id === 'openai';
        const xaiApi = provider.id === 'xai';
        const chatGPTPlan = provider.id === 'openai_chatgpt';
        const xaiPlan = provider.id === 'xai_plan';
        const providerNote = provider.id === 'minimax_plan' ? <>Usa tu clave de suscripción M Plan (sk-cp-), no una clave API de pago por uso. <a href="https://platform.minimax.io/console/plan" target="_blank" rel="noreferrer">Obtener clave del plan ↗</a></> : provider.id === 'anthropic' ? 'Claude mediante API. Claude Pro y Max no permiten conectar su suscripción a OrderCode.' : provider.id === 'gemini' ? 'Usa una clave de Google AI Studio. Sus cuotas son independientes de la suscripción de la aplicación Gemini.' : local ? 'Abre el servicio y carga un modelo en tu equipo para conectarlo.' : openCode ? <>El nivel gratuito de OpenCode solo funciona dentro de su aplicación y devuelve acceso denegado desde OrderCode. Los modelos de Console requieren créditos y clave API. <a href="https://opencode.ai/console/" target="_blank" rel="noreferrer">Obtener clave</a> · <a href="https://dev.opencode.ai/v2/docs/console/models/" target="_blank" rel="noreferrer">Modelos y precios</a></> : 'El coste aparece solo si hay precios verificables.';
        return <article className="settings-provider-card" key={provider.id} data-provider={provider.id}>
          <div className="settings-provider-copy"><strong>{chatGPTPlan ? 'ChatGPT con tu cuenta' : xaiPlan ? 'Grok con tu cuenta' : xaiApi ? 'xAI API' : provider.label}</strong><span>{chatGPTPlan ? chatgpt.connected ? `Conectado${chatgpt.email ? ` · ${chatgpt.email}` : ''}` : 'Sin conectar' : xaiPlan ? xai.connected ? 'Cuenta autorizada' : 'Sin conectar' : openCode ? storedKeys[provider.id] ? 'Clave guardada en el sistema' : 'Gratis solo dentro de OpenCode' : openRouter ? storedKeys[provider.id] || provider.configured ? 'Clave disponible' : 'Catálogo gratuito · conecta una clave' : local ? 'Proveedor local' : storedKeys[provider.id] ? 'Clave guardada en el sistema' : provider.configured ? 'Clave disponible en el entorno' : 'Sin configurar'}</span><small>{chatGPTPlan ? 'Usa los modelos que tu cuenta tenga habilitados mediante el acceso oficial al plan ChatGPT. Aplican sus límites de uso.' : xaiPlan ? 'Usa los modelos de Grok Build habilitados en tu cuenta y sus límites de uso.' : providerNote}</small>{xaiPlan && <><small>La cuenta está autorizada cuando aparece conectada. Envía un mensaje para comprobar el acceso a tu modelo.</small>{xaiDeviceCode && connectingXai && <div className="settings-device-code"><span>Código de acceso</span><strong>{xaiDeviceCode.userCode}</strong><a href={xaiDeviceCode.verificationUri} target="_blank" rel="noreferrer">Abrir verificación de xAI ↗</a><small>Escribe el código en la página de xAI para autorizar esta cuenta.</small></div>}</>}{xaiApi && <small>La clave API utiliza facturación de la plataforma xAI; no consume el uso de tu plan SuperGrok.</small>}{openRouter && <small>Necesitas una clave gratuita de OpenRouter. Los modelos marcados Gratis tienen coste $0 y están sujetos a sus cuotas.</small>}{openAi && <small>La clave de API usa la facturación de la plataforma API de OpenAI; no consume la suscripción de ChatGPT.</small>}{chatGPTPlan && <><small>La conexión se guarda de forma segura en este dispositivo.</small><details className="settings-plan-help"><summary>Requisitos de cuenta y organización</summary><small>Si aparece 3p_delegated_access_policy_denied, tu organización bloqueó este permiso. Un administrador global debe permitir OrderCode en External access y aprobar el uso delegado del plan; habilitar solo el inicio de sesión no basta.</small><a href="https://help.openai.com/en/articles/12289294-managing-your-tenant-in-admin-console" target="_blank" rel="noreferrer">Ver instrucciones para administradores ↗</a></details></>}</div>
          {chatGPTPlan ? <div className="settings-provider-actions"><button type="button" disabled={!isDesktopApp() || connectingChatGPT || connectingXai} onClick={() => void updateChatGPTConnection(true)}>{connectingChatGPT ? 'Conectando…' : 'Conectar ChatGPT'}</button>{chatgpt.connected && <button type="button" disabled={connectingChatGPT} onClick={() => void updateChatGPTConnection(false)}>{connectingChatGPT ? 'Procesando…' : 'Desconectar cuenta'}</button>}</div> : xaiPlan ? <div className="settings-provider-actions"><button type="button" disabled={!isDesktopApp() || connectingChatGPT || connectingXai} onClick={() => void updateXaiConnection(true)}>{connectingXai ? 'Esperando autorización…' : 'Conectar Grok'}</button>{connectingXai && <button type="button" onClick={() => void cancelXaiLogin().catch((cause) => setProviderError(String(cause)))}>Cancelar conexión</button>}{xai.connected && <button type="button" disabled={connectingXai} onClick={() => void updateXaiConnection(false)}>{connectingXai ? 'Procesando…' : 'Desconectar cuenta'}</button>}</div> : !local && <div className="settings-provider-actions"><input type="password" autoComplete="new-password" value={keyDrafts[provider.id] ?? ''} onChange={(event) => setKeyDrafts({ ...keyDrafts, [provider.id]: event.target.value })} placeholder={provider.id === 'minimax_plan' ? 'Clave del plan sk-cp-…' : 'Clave API'} maxLength={4096} aria-label={`Clave API ${provider.label}`} /><button type="button" disabled={!isDesktopApp() || !keyDrafts[provider.id]?.trim() || busyProvider !== null} onClick={() => void updateCredential(provider.id, keyDrafts[provider.id]?.trim() ?? '')}>{busyProvider === provider.id ? 'Guardando…' : 'Guardar clave'}</button>{storedKeys[provider.id] && <button type="button" disabled={busyProvider === provider.id} onClick={() => void updateCredential(provider.id, null)}>{busyProvider === provider.id ? 'Procesando…' : 'Eliminar clave'}</button>}</div>}
          {(provider.configured || storedKeys[provider.id] || (chatGPTPlan && chatgpt.connected) || (xaiPlan && xai.connected) || local) && <button type="button" className="settings-check-provider" disabled={checkingProvider !== null || connectingXai || connectingChatGPT} onClick={() => void checkProvider(provider.id)}>{checkingProvider === provider.id ? 'Comprobando…' : 'Comprobar modelos'}</button>}
          {providerChecks[provider.id] && <p className={providerChecks[provider.id].error ? 'settings-error' : 'settings-provider-check'} role="status">{providerChecks[provider.id].message}</p>}
          {!isDesktopApp() && <small className="settings-provider-check">Conecta las cuentas y claves desde la aplicación de escritorio.</small>}
        </article>;
      })}
      </div>
      {providerGroup === 'plans' && <details className="settings-card settings-plan-help"><summary>Otras suscripciones y compatibilidad</summary><p>Una suscripción de chat no equivale a una clave API. Claude Pro/Max no permite conectar su cuenta a OrderCode; utiliza Anthropic en Claves API. GitHub Copilot necesita una integración oficial propia y todavía no está integrado. Z.AI limita su Coding Plan a las herramientas que autoriza; OrderCode todavía no figura en esa lista.</p><a href="https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use" target="_blank" rel="noreferrer">Acceso autorizado de Anthropic ↗</a> · <a href="https://docs.z.ai/devpack/tool/others" target="_blank" rel="noreferrer">Herramientas autorizadas por Z.AI ↗</a></details>}
      <details className="settings-card settings-model-catalog"><summary>Personalizar el selector de modelos</summary><div className="settings-card-heading"><strong>Catálogo del selector</strong><span>PERSONALIZABLE</span></div><p>Empieza con una lista breve: modelos gratuitos verificados, acceso de tu plan y opciones destacadas. Los catálogos completos se abren cuando los solicitas.</p><small className="settings-model-plan-note">OpenRouter requiere una clave gratuita de cuenta para enviar solicitudes. Ollama y LM Studio ejecutan modelos locales. OpenCode reserva su nivel gratuito para su propia aplicación.</small>
        <PreferenceRow title="Mostrar catálogos completos por defecto" description="Incluye los modelos avanzados de los proveedores visibles en el selector."><input className="settings-checkbox" type="checkbox" checked={showAdvancedModels} onChange={(event) => set('showAdvancedModels', event.target.checked)} /></PreferenceRow>
        <div className="settings-model-provider-title"><strong>Proveedores visibles en el selector</strong><small>Oculta un proveedor si no quieres ver sus modelos.</small></div>
        <div className="settings-model-provider-list">{providers.map((provider) => <label className="settings-model-provider" key={provider.id}><input type="checkbox" checked={!hiddenModelProviders.includes(provider.id)} onChange={(event) => { const next = event.target.checked ? hiddenModelProviders.filter((id) => id !== provider.id) : [...hiddenModelProviders, provider.id]; set('hiddenModelProviders', next); }} /><span><strong>{provider.id === 'openai_chatgpt' ? 'ChatGPT con tu cuenta' : provider.id === 'xai_plan' ? 'Grok con tu cuenta' : provider.label}</strong><small>{provider.id === 'openai_chatgpt' ? chatgpt.connected ? 'Conectado' : 'Conectar cuenta' : provider.id === 'xai_plan' ? xai.connected ? 'Cuenta autorizada' : 'Conectar cuenta SuperGrok' : provider.configured ? 'Conectado' : provider.id === 'opencode_zen' ? 'Gratis solo en OpenCode' : provider.id === 'openrouter' ? 'Gratis con clave de cuenta' : provider.id === 'ollama' || provider.id === 'lmstudio' ? 'Modelo local' : 'Conecta su clave en esta sección'}</small></span></label>)}</div>
        <div className="settings-model-actions"><button type="button" className="settings-secondary-action" disabled={!recentModels.length} onClick={() => set('recentModels', [])}>Borrar modelos recientes{recentModels.length ? ` · ${recentModels.length}` : ''}</button><button type="button" className="settings-secondary-action" disabled={!favoriteModels.length} onClick={() => set('favoriteModels', [])}>Borrar favoritos{favoriteModels.length ? ` · ${favoriteModels.length}` : ''}</button></div>
      </details>
      <details className="settings-card settings-plan-help"><summary>Añadir otro proveedor</summary><div className="settings-card-heading"><strong>Conexión personalizada</strong><span>OPENAI API</span></div><p>Añade proveedores compatibles con Chat Completions. Usa HTTPS; HTTP solo se permite en servicios locales. El nombre y la URL se guardan localmente; la clave se guarda en el almacén seguro del sistema.</p><div className="settings-form-grid"><label>Nombre<input value={endpoint.label} maxLength={80} onChange={(event) => setEndpoint({ ...endpoint, label: event.target.value })} placeholder="Mi proveedor" /></label><label>URL base<input value={endpoint.baseUrl} maxLength={2000} onChange={(event) => setEndpoint({ ...endpoint, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label><label>Clave API<input type="password" autoComplete="new-password" value={endpoint.apiKey} maxLength={4096} onChange={(event) => setEndpoint({ ...endpoint, apiKey: event.target.value })} placeholder="Clave del proveedor" /></label></div><button type="button" className="settings-primary-action" onClick={() => void addEndpoint()} disabled={!endpoint.label.trim() || !endpoint.baseUrl.trim() || !endpoint.apiKey.trim() || savingEndpoint}>{savingEndpoint ? 'Guardando…' : 'Añadir proveedor'}</button>
        {providers.filter((provider) => provider.custom).map((provider) => <div className="settings-custom-provider" key={provider.id}><div><strong>{provider.label}</strong><small>{provider.baseUrl} · {provider.configured ? 'Listo' : 'Falta configurar la clave'}</small></div><button type="button" disabled={busyProvider === provider.id} onClick={() => { setBusyProvider(provider.id); void deleteCompatibleProvider(provider.id).then(refreshProviders).catch((cause) => setProviderError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusyProvider(null)); }}>{busyProvider === provider.id ? 'Eliminando…' : 'Eliminar proveedor'}</button></div>)}</details>
    </>;
    if (category === 'usage') return <>
      <SectionHeading title="Uso y límites" description="Fija topes para la sesión activa. Los campos vacíos no limitan el uso." />
      <section className="settings-card settings-budget-card"><div className="settings-card-heading"><strong>Límites de la sesión</strong><span>{session ? 'GUARDADO PARA ESTA SESIÓN' : 'SIN SESIÓN ACTIVA'}</span></div><p>Los límites se aplican a cada ejecución de esta sesión con los datos de uso que informa el proveedor.</p><div className="settings-form-grid">
        {([['input', 'Tokens de entrada'], ['output', 'Tokens de salida'], ['cost', 'Coste máximo (USD)'], ['tools', 'Llamadas de herramientas'], ['minutes', 'Duración máxima (minutos)']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step={key === 'cost' ? '0.01' : '1'} max={key === 'cost' ? '1000000' : undefined} value={limits[key]} placeholder="Sin límite" disabled={!session} onChange={(event) => setLimits({ ...limits, [key]: event.target.value })} /></label>)}
      </div><button type="button" className="settings-primary-action" onClick={() => void saveLimits()} disabled={!session || savingLimits}>{savingLimits ? 'Guardando…' : 'Guardar límites'}</button><small className="settings-footnote">El límite de salida se envía al proveedor. El de entrada se comprueba al finalizar cada llamada. El límite económico usa precios actuales del modelo y una estimación preventiva.</small></section>
      {!session && <div className="settings-inline-note"><Activity size={14} /><span>Abre un proyecto para configurar los límites de su conversación.</span><button type="button" onClick={onOpenWorkspace}>Abrir proyecto</button></div>}
      {renderProviderError()}
    </>;
    if (category === 'permissions') return <>
      <SectionHeading title="Seguridad" description="Decide qué acciones puede realizar OrderCode y cuándo debe pedirte permiso." />
      <div className="settings-card settings-security-card"><ShieldCheck size={18} /><div><strong>Perfil de permisos de la conversación</strong><span>{permissionName}</span><small>OrderCode comprueba los permisos antes de realizar cada acción.</small></div><button type="button" onClick={onOpenWorkspace}>Revisar en la conversación</button></div>
      <div className="settings-card settings-info-card"><strong>Trabajo automático y permisos son independientes</strong><p>Auto decide cuándo planificar, implementar y verificar. El perfil de permisos decide qué acciones requieren autorización. Cambiar el modo de trabajo no amplía permisos.</p></div>
      <div className="settings-card settings-info-card"><strong>Credenciales</strong><p>Las claves de proveedores se guardan en el almacén seguro del sistema operativo. Esta pantalla solo muestra si una clave existe; nunca puede volver a leer su contenido.</p></div>
    </>;
    if (category === 'runtime') return <>
      <SectionHeading title="Conexión local" description="Comprueba que OrderCode puede trabajar en tu equipo." />
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
      <SectionHeading title="Datos y diagnóstico" description="Revisa los datos guardados y comprueba el estado de OrderCode." />
      <div className="settings-card settings-info-card"><strong>Datos almacenados en este dispositivo</strong><p>Las preferencias de interfaz se guardan localmente en este perfil. Las sesiones, eventos y configuración de proveedores se conservan en la base local del Harness. Las credenciales se mantienen en el almacén seguro del sistema.</p></div>
      <div className="settings-runtime-grid"><div><span>ESTADO</span><strong>{runtimeHealth?.harnessConnected ? 'Operativo' : 'Vista previa web'}</strong><small>{runtimeHealth?.version ? `Harness ${runtimeHealth.version}` : 'El broker nativo informa detalles al iniciar la aplicación Desktop.'}</small></div><div><span>ALMACENAMIENTO</span><strong>Local</strong><small>Las claves y los detalles de credenciales no se incluyen aquí.</small></div></div>
      <button type="button" className="settings-primary-action" onClick={() => void verifyRuntime()} disabled={checkingRuntime}>{checkingRuntime ? 'Comprobando…' : 'Ejecutar diagnóstico'}</button>{runtimeStatus && <p className="settings-runtime-result" role="status">{runtimeStatus}</p>}
    </>;
  };

  const renderCategory = ({ id, label, description, icon: Icon }: typeof categories[number]) => <button type="button" key={id} className={category === id ? 'is-active' : ''} aria-current={category === id ? 'page' : undefined} onClick={() => { setCategory(id); set('settingsSection', id); }}><Icon size={15} /><span><strong>{label}</strong><small>{description}</small></span></button>;

  return <Localized><div className="surface-page settings-page">
    <header className="settings-page-heading"><div><h1>Ajustes</h1><p>Haz OrderCode a tu medida.</p></div></header>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Secciones de ajustes">
        {categories.filter((item) => primaryCategoryIds.includes(item.id)).map(renderCategory)}
        <details className="settings-nav-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
          <summary>Avanzado</summary>
          {categories.filter((item) => !primaryCategoryIds.includes(item.id)).map(renderCategory)}
        </details>
      </nav>
      <main className="settings-content" aria-live="polite"><div className="settings-section-content" key={category}>{renderContent()}</div></main>
    </div>
  </div></Localized>;
}
