import { Bot, Check, ChevronLeft, ChevronRight, Pencil, Plus, Search, Save, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { deleteCustomAgent, listAvailableAgentTools, listCustomAgents, listProjectSkills, saveCustomAgent, testCustomAgent, type ProjectSkill } from '../lib/ipc';
import type { AgentProfile, AgentTestResult, AgentToolChoice } from '../lib/contracts';
import type { OfficialAgent } from '../lib/agents';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';

interface Draft { id?: string; name: string; description: string; instructions: string; toolAllowlist: string[]; skillAllowlist: string[]; templateId: string; outcome: string; autoAssign: boolean; canDelegate: boolean; delegateAllowlist: string[]; delegationDepth: number; enabled: boolean }

const agentTemplates = [
  { id: 'custom', name: 'Desde cero', description: 'Define tú el propósito y las capacidades.', instructions: 'Trabaja con pasos pequeños. Usa solo las herramientas habilitadas y solicita aprobación cuando sea necesario. Entrega hallazgos con evidencia, separa lo verificado de las suposiciones y describe cualquier bloqueo.', outcome: 'Un resumen claro de lo realizado, los resultados comprobados y lo que queda pendiente.' },
  { id: 'research', name: 'Investigación', description: 'Encuentra hechos y archivos relacionados.', instructions: 'Investiga el objetivo con fuentes concretas del proyecto. Usa búsqueda y lectura antes de concluir. No cambies archivos. Distingue evidencia, hipótesis y preguntas pendientes.', outcome: 'Hallazgos concisos con rutas, referencias y pasos recomendados.' },
  { id: 'developer', name: 'Desarrollo', description: 'Implementa y verifica cambios permitidos.', instructions: 'Inspecciona primero el área afectada. Cambia solo lo necesario, sigue las convenciones del proyecto y verifica el resultado. Si una acción requiere autorización, espera la decisión.', outcome: 'Cambios integrados y comprobaciones realizadas, con archivos y resultados.' },
  { id: 'debugger', name: 'Depuración', description: 'Rastrea errores hasta su causa.', instructions: 'Reproduce el fallo con la evidencia disponible, sigue el flujo hasta su causa y corrige el origen. Comprueba el caso afectado y los riesgos de regresión.', outcome: 'Causa identificada, corrección concreta y evidencia de verificación.' },
  { id: 'qa', name: 'Pruebas QA', description: 'Comprueba recorridos y encuentra regresiones.', instructions: 'Deriva comprobaciones observables del objetivo. Usa las pruebas y herramientas habilitadas. Registra el resultado real de cada comprobación; nunca declares éxito sin ejecutarla.', outcome: 'Comprobaciones ejecutadas con resultado, fallos y pasos para reproducirlos.' },
  { id: 'review', name: 'Revisión', description: 'Detecta errores y riesgos en los cambios.', instructions: 'Revisa los cambios contra el objetivo. Prioriza fallos reproducibles, riesgos de seguridad y problemas que cambien el comportamiento. No modifiques archivos durante la revisión.', outcome: 'Problemas ordenados por gravedad, ubicación y evidencia; indica si no encontraste hallazgos.' },
  { id: 'documentation', name: 'Documentación', description: 'Explica el producto y sus cambios.', instructions: 'Consulta el comportamiento real antes de describirlo. Mantén el lenguaje claro y conciso, y conserva la estructura existente del proyecto.', outcome: 'Documentación actualizada y referencias a los archivos modificados.' },
] as const;

const initialTestPrompt = 'Investiga cómo localizar una regresión pequeña y qué comprobaciones seguras realizarías.';

export function AgentStudio({ officialAgents }: { officialAgents: OfficialAgent[] }) {
  const { agentId, health, session, set } = useDesktopStore();
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [search, setSearch] = useState('');
  const [tools, setTools] = useState<AgentToolChoice[]>([]);
  const [skills, setSkills] = useState<ProjectSkill[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(0);
  const [starterDescription, setStarterDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testPrompt, setTestPrompt] = useState(initialTestPrompt);
  const [testResult, setTestResult] = useState<AgentTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const refresh = async () => {
    setError('');
    try {
      const [nextProfiles, nextTools, nextSkills] = await Promise.all([listCustomAgents(), listAvailableAgentTools(session?.id), session ? listProjectSkills(session.id) : Promise.resolve([])]);
      setProfiles(nextProfiles);
      setTools(nextTools.filter((tool) => tool.name !== 'desktop.terminal.open'));
      setSkills(nextSkills);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  useEffect(() => { if (health?.harnessConnected) void refresh(); }, [health?.harnessConnected, session?.id]);

  const create = () => {
    const safeDefaults = tools.filter((tool) => tool.effects.every((effect) => effect === 'READ')).map((tool) => tool.name);
    setDraft({ name: '', description: '', instructions: agentTemplates[0].instructions, toolAllowlist: safeDefaults, skillAllowlist: skills.filter((skill) => skill.enabled).map((skill) => skill.id), templateId: 'custom', outcome: agentTemplates[0].outcome, autoAssign: false, canDelegate: false, delegateAllowlist: [], delegationDepth: 2, enabled: false });
    setStep(0); setTestResult(null);
    setNotice(''); setError('');
  };
  const applyTemplate = (templateId: string, description?: string) => {
    const template = agentTemplates.find((item) => item.id === templateId) ?? agentTemplates[0];
    const safeDefaults = tools.filter((tool) => tool.effects.every((effect) => effect === 'READ')).map((tool) => tool.name);
    const canWrite = ['developer', 'debugger', 'qa'].includes(template.id);
    const recommended = canWrite ? tools.filter((tool) => !['desktop.terminal.open', 'release.deploy'].includes(tool.name)).map((tool) => tool.name) : safeDefaults;
    setDraft((previous) => ({ id: previous?.id, name: template.id === 'custom' ? previous?.name ?? '' : template.name, description: description ?? (template.id === 'custom' ? previous?.description ?? '' : template.description), instructions: template.instructions, toolAllowlist: recommended, skillAllowlist: previous?.skillAllowlist ?? skills.filter((skill) => skill.enabled).map((skill) => skill.id), templateId: template.id, outcome: template.outcome, autoAssign: previous?.autoAssign ?? false, canDelegate: previous?.canDelegate ?? false, delegateAllowlist: previous?.delegateAllowlist ?? [], delegationDepth: previous?.delegationDepth ?? 2, enabled: previous?.enabled ?? false }));
    setTestResult(null);
  };
  const createFromDescription = () => {
    const request = starterDescription.trim();
    if (!request) return;
    const normalized = request.toLocaleLowerCase();
    const templateId = /prueb|test|qa|verific/.test(normalized) ? 'qa' : /depur|debug|error|fallo|regres/.test(normalized) ? 'debugger' : /código|codigo|implement|desarroll|constru|build/.test(normalized) ? 'developer' : /document/.test(normalized) ? 'documentation' : /revis|seguridad|review/.test(normalized) ? 'review' : 'research';
    applyTemplate(templateId, request);
    setDraft((previous) => previous ? { ...previous, instructions: `${previous.instructions}\n\nObjetivo específico:\n${request}` } : previous);
    setStep(0); setNotice('Borrador preparado en el dispositivo; no se envió ningún prompt ni se consumieron tokens.'); setError('');
  };
  const edit = (profile: AgentProfile) => {
    setDraft({ id: profile.id, name: profile.name, description: profile.description, instructions: profile.instructions, toolAllowlist: [...profile.toolAllowlist], skillAllowlist: profile.skillAllowlist ?? skills.filter((skill) => skill.enabled).map((skill) => skill.id), templateId: profile.templateId ?? 'custom', outcome: profile.outcome ?? '', autoAssign: profile.autoAssign === true, canDelegate: profile.canDelegate === true, delegateAllowlist: profile.delegateAllowlist ?? [], delegationDepth: profile.delegationDepth ?? 2, enabled: profile.enabled });
    setStep(0); setTestResult(null);
    setNotice(''); setError('');
  };
  const save = async (activate: boolean) => {
    if (!draft || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const profile = await saveCustomAgent({ ...draft, enabled: activate });
      await refresh();
      if (activate) set('agentId', profile.id);
      else if (agentId === profile.id) set('agentId', 'general');
      setDraft(null);
      setNotice(activate ? `“${profile.name}” quedó activado y seleccionado. Hereda el modelo y los permisos de la conversación.` : `“${profile.name}” quedó guardado como borrador. No se seleccionó ni se activó.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const remove = async (profile: AgentProfile) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await deleteCustomAgent(profile.id);
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      if (agentId === profile.id) set('agentId', 'general');
      if (draft?.id === profile.id) setDraft(null);
      setNotice(`“${profile.name}” se eliminó.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (!draft || !session || testing) return;
    setTesting(true); setError(''); setTestResult(null);
    try {
      const result = await testCustomAgent(session.id, { ...draft, enabled: true }, testPrompt);
      setTestResult(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setTesting(false); }
  };
  const exportProfiles = () => {
    const references = new Map(profiles.map((profile, index) => [profile.id, `agent-${index + 1}`]));
    const data = JSON.stringify({ version: 2, profiles: profiles.map(({ id, name, description, instructions, toolAllowlist, skillAllowlist, templateId, outcome, autoAssign, canDelegate, delegateAllowlist, delegationDepth, enabled }) => ({ sourceId: references.get(id), name, description, instructions, toolAllowlist, skillAllowlist, templateId, outcome, autoAssign, canDelegate, delegateAllowlist: (delegateAllowlist ?? []).map((target) => references.get(target) ?? target), delegationDepth, enabled })) }, null, 2);
    const href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = href; anchor.download = 'ordercode-agents.json'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const importProfiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setTransferring(true); setError(''); setNotice('');
    try {
      if (file.size > 1_000_000) throw new Error('El archivo de agentes supera 1 MB.');
      const raw: unknown = JSON.parse(await file.text());
      const source = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { profiles?: unknown }).profiles) ? (raw as { profiles: unknown[] }).profiles : null;
      if (!source || source.length < 1 || source.length > 100) throw new Error('El archivo debe contener entre 1 y 100 perfiles.');
      const knownTools = new Set(tools.map((tool) => tool.name));
      const knownSkills = new Set(skills.map((skill) => skill.id));
      const sourceIds = source.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)).map((item) => item.sourceId).filter((id): id is string => typeof id === 'string' && id.length <= 120);
      if (new Set(sourceIds).size !== sourceIds.length) throw new Error('El archivo contiene referencias de agente duplicadas.');
      const importedRefs = new Set(sourceIds);
      const normalized = source.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('El archivo contiene un perfil inválido.');
        const item = value as Partial<AgentProfile> & { sourceId?: unknown };
        if (typeof item.name !== 'string' || typeof item.instructions !== 'string' || !Array.isArray(item.toolAllowlist) || item.toolAllowlist.some((name) => typeof name !== 'string')) throw new Error('Cada perfil debe incluir nombre, instrucciones y una lista de herramientas.');
        const toolAllowlist = [...new Set(item.toolAllowlist as string[])];
        const unknownTools = toolAllowlist.filter((name) => !knownTools.has(name));
        if (unknownTools.length) throw new Error(`El archivo incluye herramientas desconocidas: ${unknownTools.join(', ')}`);
        const skillAllowlist = Array.isArray(item.skillAllowlist) ? item.skillAllowlist.filter((id): id is string => typeof id === 'string' && knownSkills.has(id)) : undefined;
        const delegateAllowlist = Array.isArray(item.delegateAllowlist) ? item.delegateAllowlist.filter((id): id is string => typeof id === 'string' && (officialAgents.some((agent) => agent.id === id) || profiles.some((profile) => profile.id === id) || importedRefs.has(id))) : [];
        return { sourceId: typeof item.sourceId === 'string' ? item.sourceId : undefined, id: undefined as string | undefined, name: item.name, description: typeof item.description === 'string' ? item.description : '', instructions: item.instructions, toolAllowlist, skillAllowlist, templateId: typeof item.templateId === 'string' ? item.templateId : 'custom', outcome: typeof item.outcome === 'string' ? item.outcome : '', autoAssign: item.autoAssign === true, canDelegate: item.canDelegate === true, delegateAllowlist, delegationDepth: Number.isInteger(item.delegationDepth) ? Math.max(1, Math.min(4, Number(item.delegationDepth))) : 2, enabled: false };
      });
      const importedIds = new Map<string, string>();
      for (const profile of normalized) {
        const fields = { ...profile };
        delete fields.sourceId;
        delete fields.id;
        const created = await saveCustomAgent({ ...fields, canDelegate: false, delegateAllowlist: [], delegationDepth: 0 });
        if (profile.sourceId) importedIds.set(profile.sourceId, created.id);
        profile.id = created.id;
      }
      for (const profile of normalized) {
        if (!profile.canDelegate) continue;
        const targets = profile.delegateAllowlist.map((id) => importedIds.get(id) ?? id).filter((id) => id !== profile.id);
        await saveCustomAgent({ ...profile, delegateAllowlist: targets, enabled: false });
      }
      await refresh();
      setNotice(`${normalized.length} agente${normalized.length === 1 ? '' : 's'} importado${normalized.length === 1 ? '' : 's'}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setTransferring(false); }
  };

  return <Localized><div className="surface-page agent-studio">
    <div className="surface-heading"><Bot size={18} /><div><h2>Agentes</h2><p>Crea especialistas con herramientas, permisos heredados y delegación configurables.</p></div><span className="panel-title-spacer" /><div className="agent-surface-actions"><button type="button" onClick={exportProfiles} disabled={!profiles.length || transferring}>Exportar</button><label className="agent-import-button">{transferring ? 'Importando…' : 'Importar'}<input type="file" accept="application/json,.json" onChange={(event) => void importProfiles(event)} disabled={!health?.harnessConnected || transferring} /></label><button type="button" className="surface-refresh" onClick={create} disabled={!health?.harnessConnected || busy || transferring}><Plus size={13} />Crear agente</button></div></div>
    {!health?.harnessConnected && <div className="surface-note">Conecta un workspace para administrar agentes persistentes. Los especialistas oficiales siguen disponibles en esta vista previa.</div>}
    <section className="agent-description-create"><label><Sparkles size={14} />Descríbelo en una frase<input value={starterDescription} maxLength={500} onChange={(event) => setStarterDescription(event.target.value)} placeholder="Ej.: revisa accesibilidad sin cambiar archivos" /></label><button type="button" onClick={createFromDescription} disabled={!starterDescription.trim() || !health?.harnessConnected}><Sparkles size={12} />Preparar borrador</button><small>Se arma una plantilla en este dispositivo; no llama a un modelo ni consume tokens.</small></section>
    <label className="agent-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar agentes y especialistas" aria-label="Buscar agentes" /><span>{profiles.length + officialAgents.length}</span></label>
    <div className="agent-library-heading"><strong>Especialistas oficiales</strong><small>Elige quién llevará el próximo mensaje</small></div>
    <div className="agent-grid">{officialAgents.filter((agent) => `${agent.name} ${agent.detail}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((agent) => <button type="button" className={`agent-card ${agentId === agent.id ? 'is-active' : ''}`} key={agent.id} aria-pressed={agentId === agent.id} onClick={() => set('agentId', agent.id)}><span className="agent-mark"><Bot size={14} /></span><strong>{agent.name}</strong><small>{agent.detail}</small><span className="agent-card-tag">Oficial · Disponible</span></button>)}</div>
    <div className="agent-library-heading"><strong>Mis agentes</strong><small>{profiles.filter((profile) => profile.enabled).length} activos · {profiles.filter((profile) => !profile.enabled).length} borradores o desactivados</small></div>
    <div className="agent-grid">{profiles.filter((profile) => `${profile.name} ${profile.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((profile) => <article className={`agent-card agent-card--custom ${agentId === profile.id ? 'is-active' : ''} ${profile.enabled ? '' : 'is-disabled'}`} key={profile.id}><button type="button" className="agent-card-select" aria-pressed={agentId === profile.id} disabled={!profile.enabled} onClick={() => set('agentId', profile.id)}><span className="agent-mark"><Bot size={14} /></span><strong>{profile.name}</strong><small>{profile.description || 'Agente personalizado'}</small><span className="agent-card-tag">{profile.enabled ? 'Activo · elegible para selección' : 'Borrador o desactivado'} · {profile.toolAllowlist.length} herramientas</span></button><span className="agent-card-actions"><button type="button" aria-label={`Editar ${profile.name}`} title="Editar" onClick={() => edit(profile)}><Pencil size={12} /></button><button type="button" aria-label={`Eliminar ${profile.name}`} title="Eliminar" onClick={() => void remove(profile)} disabled={busy}><Trash2 size={12} /></button></span></article>)}</div>
    {draft && <section className="agent-editor" aria-label="Creador guiado de agente">
      <div className="agent-editor-header"><div><strong>{draft.id ? 'Editar agente' : 'Crear agente'}</strong><small>Configuración clara; las opciones avanzadas aparecen cuando las necesitas.</small></div><span className="panel-title-spacer" /><button type="button" className="agent-close" onClick={() => setDraft(null)} aria-label="Cerrar editor"><X size={14} /></button></div>
      <nav className="agent-wizard-steps" aria-label="Pasos para configurar el agente">{['Objetivo', 'Herramientas', 'Delegación', 'Revisar'].map((label, index) => <button type="button" key={label} className={step === index ? 'is-active' : step > index ? 'is-complete' : ''} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{label}</button>)}</nav>
      {step === 0 && <div className="agent-wizard-page"><strong>¿Qué trabajo debe hacer?</strong><div className="agent-template-grid">{agentTemplates.map((template) => <button type="button" key={template.id} className={draft.templateId === template.id ? 'is-active' : ''} onClick={() => applyTemplate(template.id)}><strong>{template.name}</strong><small>{template.description}</small></button>)}</div><div className="agent-form-grid"><label>Nombre<input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej.: Revisión de accesibilidad" /></label><label>Cuándo usarlo<input value={draft.description} maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Ej.: al revisar una interfaz web" /></label></div><label className="agent-instructions">Instrucciones<textarea value={draft.instructions} maxLength={20_000} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="El enfoque y las reglas que seguirá el agente." /></label><label className="agent-instructions">¿Qué resultado debe entregar?<textarea value={draft.outcome} maxLength={2_000} onChange={(event) => setDraft({ ...draft, outcome: event.target.value })} placeholder="Describe cómo reconocer que terminó correctamente." /></label></div>}
      {step === 1 && <div className="agent-wizard-page"><div className="agent-wizard-intro"><strong>¿Qué podrá usar?</strong><small>El agente solo recibe las herramientas marcadas. Cada acción sigue las autorizaciones de esta conversación.</small><span>{draft.toolAllowlist.length} seleccionadas</span></div><div className="agent-tool-list">{tools.map((tool) => <label className="agent-tool-choice" key={tool.name}><input type="checkbox" checked={draft.toolAllowlist.includes(tool.name)} onChange={(event) => setDraft({ ...draft, toolAllowlist: event.target.checked ? [...draft.toolAllowlist, tool.name] : draft.toolAllowlist.filter((name) => name !== tool.name) })} /><span><strong>{tool.name}</strong><small>{tool.description}</small></span><small>{tool.effects.join(' · ')}</small></label>)}</div><div className="agent-skill-list"><strong>Skills que puede consultar</strong><small>Solo se usan Skills activas de este workspace. Las herramientas de servidores MCP conectados aparecen en la lista anterior.</small>{skills.filter((skill) => skill.enabled).length ? skills.filter((skill) => skill.enabled).map((skill) => <label key={skill.id}><input type="checkbox" checked={draft.skillAllowlist.includes(skill.id)} onChange={(event) => setDraft({ ...draft, skillAllowlist: event.target.checked ? [...draft.skillAllowlist, skill.id] : draft.skillAllowlist.filter((id) => id !== skill.id) })} /><span><b>{skill.name}</b><small>{skill.description || skill.id}</small></span></label>) : <p>No hay Skills activas. Puedes activarlas desde Herramientas → Skills.</p>}</div><p className="agent-permission-note"><Check size={13} />Los permisos y el modelo se heredan de la conversación; el agente no puede ampliarlos.</p></div>}
      {step === 2 && <div className="agent-wizard-page"><strong>¿Cuándo se puede utilizar?</strong><label className="agent-setting-row"><span><b>Asignar automáticamente</b><small>El agente principal puede elegirlo cuando su descripción coincida con la tarea.</small></span><input type="checkbox" checked={draft.autoAssign} onChange={(event) => setDraft({ ...draft, autoAssign: event.target.checked })} /></label><label className="agent-setting-row"><span><b>Puede delegar tareas</b><small>Los agentes seleccionados podrán recibir tareas de este agente.</small></span><input type="checkbox" checked={draft.canDelegate} onChange={(event) => setDraft({ ...draft, canDelegate: event.target.checked, delegationDepth: event.target.checked ? Math.max(1, draft.delegationDepth) : 0, delegateAllowlist: event.target.checked ? draft.delegateAllowlist : [] })} /></label>{draft.canDelegate && <><label className="agent-instructions">Hasta cuántos niveles<select value={draft.delegationDepth} onChange={(event) => setDraft({ ...draft, delegationDepth: Number(event.target.value) })}>{[1, 2, 3, 4].map((depth) => <option key={depth} value={depth}>{depth} {depth === 1 ? 'nivel' : 'niveles'}</option>)}</select><small>El motor también detiene ciclos y comparte los límites de la tarea principal.</small></label><div className="agent-delegate-list"><strong>Agentes que puede convocar</strong>{[...officialAgents.map((agent) => ({ id: agent.id, name: agent.name, description: agent.detail })), ...profiles.filter((profile) => profile.enabled && profile.id !== draft.id).map((profile) => ({ id: profile.id, name: profile.name, description: profile.description }))].map((agent) => <label key={agent.id}><input type="checkbox" checked={draft.delegateAllowlist.includes(agent.id)} onChange={(event) => setDraft({ ...draft, delegateAllowlist: event.target.checked ? [...draft.delegateAllowlist, agent.id] : draft.delegateAllowlist.filter((id) => id !== agent.id) })} /><span><b>{agent.name}</b><small>{agent.description}</small></span></label>)}</div></>}</div>}
      {step === 3 && <div className="agent-wizard-page agent-review"><strong>Así queda tu agente</strong><div className="agent-review-card"><span className="agent-mark"><Bot size={15} /></span><span><b>{draft.name || 'Tu nuevo agente'}</b><small>{draft.description || 'Aún no has descrito cuándo usarlo.'}</small></span><span className="agent-card-tag">{draft.autoAssign ? 'Asignable automáticamente' : 'Selección manual'} · {draft.enabled ? 'Actualmente activo' : 'Se guardará como borrador'}</span></div><p><b>Resultado:</b> {draft.outcome || 'El resultado será el resumen de sus hallazgos y acciones verificadas.'}</p><p><b>Herramientas:</b> {draft.toolAllowlist.length ? `${draft.toolAllowlist.length} permitidas, siempre sujetas a los permisos de la conversación.` : 'No hay herramientas seleccionadas.'}</p><p><b>Delegación:</b> {draft.canDelegate ? `Hasta ${draft.delegationDepth} niveles; ${draft.delegateAllowlist.length} agentes elegidos.` : 'No delega tareas.'}</p><p className="agent-permission-note"><Check size={13} />Modelo, esfuerzo y permisos se heredan. La prueba real usa este perfil sin guardarlo ni activarlo.</p><label className="agent-instructions">Prueba con una tarea<input value={testPrompt} maxLength={4_000} onChange={(event) => setTestPrompt(event.target.value)} /></label><p className="agent-test-notice">La prueba usa el modelo de la sesión y solo las herramientas de lectura seleccionadas. Puede consumir tokens según tu proveedor y límites; no escribe archivos ni ejecuta comandos.</p>{testResult && <div className="agent-test-result" role="status"><strong>Prueba real · {testResult.providerId} / {testResult.modelId}</strong><pre>{testResult.content || 'El modelo devolvió una respuesta vacía.'}</pre><small>{[testResult.inputTokens !== undefined ? `${testResult.inputTokens} tokens de entrada` : '', testResult.outputTokens !== undefined ? `${testResult.outputTokens} de salida` : '', `${testResult.durationMs} ms`, testResult.toolsRun?.length ? `Herramientas ejecutadas: ${testResult.toolsRun.join(', ')}` : 'Sin herramientas ejecutadas', testResult.toolCallsIgnored ? 'Algunas solicitudes no disponibles se omitieron.' : ''].filter(Boolean).join(' · ')}</small></div>}</div>}
      <div className="agent-editor-footer"><button type="button" className="agent-cancel" onClick={() => setDraft(null)}>Cancelar</button><span className="panel-title-spacer" />{step > 0 && <button type="button" className="agent-cancel" onClick={() => setStep(step - 1)}><ChevronLeft size={12} />Atrás</button>}{step < 3 ? <button type="button" className="agent-save" disabled={step === 0 && (!draft.name.trim() || !draft.instructions.trim())} onClick={() => setStep(step + 1)}>Continuar<ChevronRight size={12} /></button> : <><button type="button" className="agent-test" disabled={testing || !session || !session.model || !session.providerId || !draft.name.trim() || !draft.instructions.trim() || !testPrompt.trim()} onClick={() => void test()}>{testing ? 'Probando…' : 'Probar ahora'}</button><button type="button" className="agent-cancel" disabled={busy || testing || !draft.name.trim() || !draft.instructions.trim()} onClick={() => void save(false)}><Save size={12} />Guardar borrador</button><button type="button" className="agent-save" disabled={busy || testing || !draft.name.trim() || !draft.instructions.trim()} onClick={() => void save(true)}><Save size={13} />{busy ? 'Guardando…' : 'Guardar y activar'}</button></>}</div>
    </section>}
    {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="surface-note" role="status"><Check size={13} />{notice}</p>}
    <p className="surface-note"><span>Seleccionado:</span> {officialAgents.find((agent) => agent.id === agentId)?.name ?? profiles.find((profile) => profile.id === agentId)?.name ?? 'General'}. <span>Los agentes personalizados no pueden cambiar de modelo ni ampliar el perfil de permisos de la sesión.</span></p>
  </div></Localized>;
}
