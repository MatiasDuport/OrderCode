import { AlertCircle, ArrowLeft, Bot, Check, ChevronLeft, ChevronRight, Pencil, Plus, Search, Save, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
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
const editorSteps = ['Objetivo', 'Capacidades', 'Colaboración', 'Revisar'];
const toolGroups: Record<string, string> = { fs: 'Archivos', code: 'Código y búsqueda', git: 'Control de versiones', process: 'Comandos y procesos', release: 'Publicación', mcp: 'Conexiones MCP' };
const toolLabels: Record<string, string> = { 'fs.read': 'Leer archivos', 'fs.write': 'Editar archivos', 'code.search': 'Buscar en el proyecto', 'code.graph': 'Consultar el grafo de código', 'process.exec': 'Ejecutar comandos', 'git.status': 'Consultar estado', 'git.diff': 'Revisar cambios', 'git.branches': 'Consultar ramas', 'git.history': 'Consultar historial', 'git.remotes': 'Consultar repositorios remotos', 'release.deploy': 'Publicar proyecto' };
const effectLabels: Record<string, string> = { READ: 'Lectura', WRITE: 'Escritura', EXECUTE: 'Ejecución', GIT_WRITE: 'Cambios en Git', PUBLISH: 'Publicación', NETWORK: 'Red', DELETE: 'Eliminación' };

export function AgentStudio({ officialAgents }: { officialAgents: OfficialAgent[] }) {
  const agentId = useDesktopStore((state) => state.agentId);
  const health = useDesktopStore((state) => state.health);
  const session = useDesktopStore((state) => state.session);
  const set = useDesktopStore((state) => state.set);
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
  const [loading, setLoading] = useState(false);
  const [baseline, setBaseline] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const [toolSearch, setToolSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const editorTitle = useRef<HTMLHeadingElement>(null);
  const testSequence = useRef(0);
  const editorOpen = draft !== null;
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;
  const valid = !!draft?.name.trim() && !!draft.instructions.trim();

  useEffect(() => { if (editorOpen) editorTitle.current?.focus(); }, [editorOpen]);
  useEffect(() => { testSequence.current += 1; setTestResult(null); }, [draft, testPrompt, session?.id, session?.model, session?.reasoningEffort]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const openDraft = (next: Draft) => {
    setDraft(next); setBaseline(JSON.stringify(next)); setStep(0); setTestResult(null);
    setConfirmClose(false); setPendingTemplate(null); setToolSearch(''); setSelectedOnly(false);
    setNotice(''); setError('');
  };
  const closeEditor = () => { if (busy || testing) return; if (dirty) setConfirmClose(true); else setDraft(null); };

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextProfiles, nextTools, nextSkills] = await Promise.all([listCustomAgents(), listAvailableAgentTools(session?.id), session ? listProjectSkills(session.id) : Promise.resolve([])]);
      setProfiles(nextProfiles);
      setTools(nextTools.filter((tool) => tool.name !== 'desktop.terminal.open'));
      setSkills(nextSkills);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (health?.harnessConnected) void refresh(); }, [health?.harnessConnected, session?.id]);

  const create = () => {
    const safeDefaults = tools.filter((tool) => tool.effects.every((effect) => effect === 'READ')).map((tool) => tool.name);
    openDraft({ name: '', description: '', instructions: agentTemplates[0].instructions, toolAllowlist: safeDefaults, skillAllowlist: skills.filter((skill) => skill.enabled).map((skill) => skill.id), templateId: 'custom', outcome: agentTemplates[0].outcome, autoAssign: false, canDelegate: false, delegateAllowlist: [], delegationDepth: 2, enabled: false });
  };
  const applyTemplate = (templateId: string, description?: string) => {
    const template = agentTemplates.find((item) => item.id === templateId) ?? agentTemplates[0];
    const safeDefaults = tools.filter((tool) => tool.effects.every((effect) => effect === 'READ')).map((tool) => tool.name);
    const canWrite = ['developer', 'debugger', 'qa'].includes(template.id);
    const recommended = canWrite ? tools.filter((tool) => !tool.effects.includes('PUBLISH')).map((tool) => tool.name) : safeDefaults;
    setDraft((previous) => ({ id: previous?.id, name: previous?.name.trim() || (template.id === 'custom' ? '' : template.name), description: description ?? (previous?.description.trim() || (template.id === 'custom' ? '' : template.description)), instructions: template.instructions, toolAllowlist: recommended, skillAllowlist: previous?.skillAllowlist ?? skills.filter((skill) => skill.enabled).map((skill) => skill.id), templateId: template.id, outcome: template.outcome, autoAssign: previous?.autoAssign ?? false, canDelegate: previous?.canDelegate ?? false, delegateAllowlist: previous?.delegateAllowlist ?? [], delegationDepth: previous?.delegationDepth ?? 2, enabled: previous?.enabled ?? false }));
    setPendingTemplate(null); setTestResult(null);
  };
  const createFromDescription = () => {
    const request = starterDescription.trim();
    if (!request) return;
    const normalized = request.toLocaleLowerCase();
    const templateId = /prueb|test|qa|verific/.test(normalized) ? 'qa' : /depur|debug|error|fallo|regres/.test(normalized) ? 'debugger' : /código|codigo|implement|desarroll|constru|build/.test(normalized) ? 'developer' : /document/.test(normalized) ? 'documentation' : /revis|seguridad|review/.test(normalized) ? 'review' : 'research';
    const template = agentTemplates.find((item) => item.id === templateId)!;
    const canWrite = ['developer', 'debugger', 'qa'].includes(template.id);
    const recommended = tools.filter((tool) => canWrite ? !tool.effects.includes('PUBLISH') : tool.effects.every((effect) => effect === 'READ')).map((tool) => tool.name);
    openDraft({ name: template.name, description: request, instructions: `${template.instructions}\n\nObjetivo específico:\n${request}`, outcome: template.outcome, templateId, toolAllowlist: recommended, skillAllowlist: skills.filter((skill) => skill.enabled).map((skill) => skill.id), autoAssign: false, canDelegate: false, delegateAllowlist: [], delegationDepth: 2, enabled: false });
    setNotice('Borrador preparado en el dispositivo; no se envió ningún prompt ni se consumieron tokens.');
  };
  const edit = (profile: AgentProfile) => {
    openDraft({ id: profile.id, name: profile.name, description: profile.description, instructions: profile.instructions, toolAllowlist: [...profile.toolAllowlist], skillAllowlist: profile.skillAllowlist ?? skills.filter((skill) => skill.enabled).map((skill) => skill.id), templateId: profile.templateId ?? 'custom', outcome: profile.outcome ?? '', autoAssign: profile.autoAssign === true, canDelegate: profile.canDelegate === true, delegateAllowlist: profile.delegateAllowlist ?? [], delegationDepth: profile.delegationDepth ?? 2, enabled: profile.enabled });
  };
  const save = async (activate: boolean) => {
    if (!draft || busy || testing || !valid) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const profile = await saveCustomAgent({ ...draft, enabled: activate });
      await refresh();
      if (activate && (!draft.enabled || agentId === profile.id)) set('agentId', profile.id);
      else if (agentId === profile.id) set('agentId', 'general');
      setDraft(null);
      setNotice(activate ? draft.enabled ? `Cambios de “${profile.name}” guardados. El agente sigue activo.` : `“${profile.name}” quedó activado y seleccionado. Hereda el modelo y los permisos de la conversación.` : draft.enabled ? `“${profile.name}” quedó desactivado.` : `“${profile.name}” quedó guardado como borrador. No se seleccionó ni se activó.`);
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
    const attempt = ++testSequence.current;
    setTesting(true); setError(''); setTestResult(null);
    try {
      const result = await testCustomAgent(session.id, { ...draft, enabled: true }, testPrompt);
      if (attempt === testSequence.current) setTestResult(result);
    } catch (cause) { if (attempt === testSequence.current) setError(cause instanceof Error ? cause.message : String(cause)); }
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

  const availableSkills = skills.filter((skill) => skill.enabled);
  const delegates = [...officialAgents.map((agent) => ({ id: agent.id, name: agent.name, description: agent.detail })),
    ...profiles.filter((profile) => profile.enabled && profile.id !== draft?.id).map((profile) => ({ id: profile.id, name: profile.name, description: profile.description }))];
  const filteredTools = tools.filter((tool) =>
    (!selectedOnly || draft?.toolAllowlist.includes(tool.name)) &&
    [tool.name, toolLabels[tool.name] ?? '', tool.description, toolGroups[tool.name.split('.')[0]] ?? ''].join(' ').toLocaleLowerCase().includes(toolSearch.toLocaleLowerCase()));
  const groupedTools = Object.entries(filteredTools.reduce<Record<string, AgentToolChoice[]>>((groups, tool) => {
    const group = toolGroups[tool.name.split('.')[0]] ?? 'Otras herramientas';
    (groups[group] ??= []).push(tool);
    return groups;
  }, {}));
  const unavailableTools = draft?.toolAllowlist.filter((name) => !tools.some((tool) => tool.name === name)) ?? [];
  const unavailableDelegates = draft?.delegateAllowlist.filter((id) => !delegates.some((agent) => agent.id === id)) ?? [];
  const toggleTools = (names: string[], checked: boolean) => {
    if (!draft) return;
    setDraft({ ...draft, toolAllowlist: checked ? [...new Set([...draft.toolAllowlist, ...names])] : draft.toolAllowlist.filter((name) => !names.includes(name)) });
  };

  if (draft) return <Localized><div className="surface-page agent-studio agent-studio--editing">
    <section className="agent-editor" aria-label="Editor de agente" aria-busy={busy || testing}>
      <header className="agent-editor-header">
        <button type="button" className="agent-close" onClick={closeEditor} disabled={busy || testing} aria-label="Volver a agentes"><ArrowLeft size={16} /></button>
        <div><h2 ref={editorTitle} tabIndex={-1}>{draft.id ? 'Editar agente' : 'Crear agente'}</h2><small>{draft.name || 'Un especialista para tu forma de trabajar'}</small></div>
        <span className="panel-title-spacer" /><span className="agent-draft-status">{dirty ? 'Cambios sin guardar' : draft.enabled ? 'Activo' : 'Borrador'}</span>
      </header>
      {confirmClose && <div className="agent-inline-confirm" role="alert">
        <span><strong>Hay cambios sin guardar</strong><small>Si sales ahora, se perderán los cambios de este formulario.</small></span>
        <button type="button" className="agent-cancel" onClick={() => setConfirmClose(false)}>Seguir editando</button>
        <button type="button" className="agent-discard" onClick={() => { setDraft(null); setConfirmClose(false); }}>Descartar cambios</button>
      </div>}
      <fieldset className="agent-editor-fields" disabled={busy || testing}>
        <nav className="agent-wizard-steps" aria-label="Pasos para configurar el agente">
          {editorSteps.map((label, index) => <button type="button" key={label} className={step === index ? 'is-active' : ''} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span>{index === 0 && valid ? <Check size={12} /> : index + 1}</span>{label}</button>)}
        </nav>
        <div className="agent-editor-content" key={step}>
          {step === 0 && <div className="agent-wizard-page">
            <div className="agent-section-heading"><h3>Dale un propósito</h3><p>Define su especialidad y cómo reconocer un buen resultado.</p></div>
            <details className="agent-template-picker" open={draft.templateId === 'custom' && !draft.name}>
              <summary><Sparkles size={14} /><span>Empezar con una plantilla</span><small>{agentTemplates.find((item) => item.id === draft.templateId)?.name}</small></summary>
              <div className="agent-template-grid">{agentTemplates.map((template) => <button type="button" key={template.id} aria-pressed={draft.templateId === template.id} className={draft.templateId === template.id ? 'is-active' : ''} onClick={() => {
                if (template.id === draft.templateId) return;
                if (dirty || draft.id) setPendingTemplate(template.id); else applyTemplate(template.id);
              }}><strong>{template.name}</strong><small>{template.description}</small></button>)}</div>
            </details>
            {pendingTemplate && <div className="agent-inline-confirm" role="alert"><span><strong>¿Aplicar esta plantilla?</strong><small>Reemplaza las instrucciones, el resultado esperado y las herramientas. Conserva el nombre y la colaboración.</small></span><button type="button" className="agent-cancel" onClick={() => setPendingTemplate(null)}>Cancelar</button><button type="button" className="agent-save" onClick={() => applyTemplate(pendingTemplate)}>Aplicar plantilla</button></div>}
            <div className="agent-form-grid">
              <label>Nombre <span className="agent-required">Obligatorio</span><input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej.: Revisión de accesibilidad" autoComplete="off" /></label>
              <label>Cuándo usarlo<input value={draft.description} maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Ej.: al revisar una interfaz web" /><small>Ayuda al agente principal a saber cuándo convocarlo.</small></label>
            </div>
            <label className="agent-instructions">Instrucciones <span className="agent-required">Obligatorio</span><textarea rows={7} value={draft.instructions} maxLength={20_000} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="El enfoque y las reglas que seguirá el agente." /><small className="agent-character-count">{draft.instructions.length.toLocaleString()} / 20 000</small></label>
            <label className="agent-instructions">Resultado esperado<textarea rows={3} value={draft.outcome} maxLength={2_000} onChange={(event) => setDraft({ ...draft, outcome: event.target.value })} placeholder="Describe cómo reconocer que terminó correctamente." /></label>
          </div>}
          {step === 1 && <div className="agent-wizard-page">
            <div className="agent-section-heading"><h3>Elige sus capacidades</h3><p>Activa solo lo que necesita. Las acciones respetan los permisos de la conversación.</p></div>
            <div className="agent-capability-toolbar">
              <div className="agent-tool-search"><Search size={14} /><input value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} placeholder="Buscar herramientas" aria-label="Buscar herramientas" />{toolSearch && <button type="button" aria-label="Limpiar búsqueda de herramientas" onClick={() => setToolSearch('')}><X size={12} /></button>}</div>
              <button type="button" className="agent-filter" aria-pressed={selectedOnly} onClick={() => setSelectedOnly(!selectedOnly)}>Seleccionadas <span>{draft.toolAllowlist.length}</span></button>
            </div>
            <div className="agent-capability-actions"><button type="button" onClick={() => setDraft({ ...draft, toolAllowlist: tools.filter((tool) => tool.effects.every((effect) => effect === 'READ')).map((tool) => tool.name) })}>Solo lectura</button><button type="button" onClick={() => setDraft({ ...draft, toolAllowlist: [] })} disabled={!draft.toolAllowlist.length}>Quitar todas</button></div>
            {unavailableTools.length > 0 && <div className="agent-editor-warning"><AlertCircle size={14} /><span>Hay herramientas guardadas que no están disponibles en este proyecto.</span><button type="button" onClick={() => toggleTools(unavailableTools, false)}>Quitar no disponibles</button></div>}
            <div className="agent-capability-groups">
              {groupedTools.map(([group, entries]) => {
                const groupTools = entries ?? [];
                const selected = groupTools.filter((tool) => draft.toolAllowlist.includes(tool.name)).length;
                return <details className="agent-tool-group" key={group} open>
                  <summary><span>{group}</span><small>{selected} / {groupTools.length}</small></summary>
                  <div className="agent-group-action"><button type="button" onClick={() => toggleTools(groupTools.map((tool) => tool.name), selected !== groupTools.length)}>{selected === groupTools.length ? 'Quitar grupo' : 'Seleccionar grupo'}</button></div>
                  {groupTools.map((tool) => <label className="agent-tool-choice" key={tool.name}>
                    <input type="checkbox" checked={draft.toolAllowlist.includes(tool.name)} onChange={(event) => toggleTools([tool.name], event.target.checked)} />
                    <span><strong>{toolLabels[tool.name] ?? tool.name}</strong><small title={tool.description}>{tool.description}</small><code>{tool.name}</code></span>
                    <span className={tool.effects.some((effect) => effect !== 'READ') ? 'agent-effect agent-effect--write' : 'agent-effect'}>{tool.effects.map((effect) => effectLabels[effect] ?? effect).join(' · ') || 'Sin efectos declarados'}</span>
                  </label>)}
                </details>;
              })}
              {!filteredTools.length && <p className="agent-editor-empty">{tools.length ? 'No hay herramientas que coincidan con los filtros.' : 'No hay herramientas disponibles. Comprueba la conexión con el servicio.'}</p>}
            </div>
            <details className="agent-skill-picker"><summary><span>Skills del proyecto</span><small>{draft.skillAllowlist.length} seleccionadas</small></summary><div className="agent-skill-list">{availableSkills.length ? availableSkills.map((skill) => <label key={skill.id}><input type="checkbox" checked={draft.skillAllowlist.includes(skill.id)} onChange={(event) => setDraft({ ...draft, skillAllowlist: event.target.checked ? [...draft.skillAllowlist, skill.id] : draft.skillAllowlist.filter((id) => id !== skill.id) })} /><span><b>{skill.name}</b><small>{skill.description || skill.id}</small></span></label>) : <p>No hay Skills activas. Puedes activarlas desde Herramientas → Skills.</p>}</div></details>
          </div>}
          {step === 2 && <div className="agent-wizard-page">
            <div className="agent-section-heading"><h3>Cómo trabajará con los demás</h3><p>Decide si puede ser elegido automáticamente y recibir ayuda de otros agentes.</p></div>
            <label className="agent-setting-row"><span><b>Asignar automáticamente</b><small>El agente principal puede elegirlo cuando su descripción coincida con la tarea.</small></span><input type="checkbox" role="switch" checked={draft.autoAssign} onChange={(event) => setDraft({ ...draft, autoAssign: event.target.checked })} /></label>
            {draft.autoAssign && !draft.description.trim() && <p className="agent-editor-warning"><AlertCircle size={14} />Añade cuándo usarlo en Objetivo para facilitar la asignación automática.</p>}
            <label className="agent-setting-row"><span><b>Puede delegar tareas</b><small>Permite que solicite ayuda a los especialistas que elijas.</small></span><input type="checkbox" role="switch" checked={draft.canDelegate} onChange={(event) => setDraft({ ...draft, canDelegate: event.target.checked, delegationDepth: event.target.checked ? Math.max(1, draft.delegationDepth) : 0, delegateAllowlist: event.target.checked ? draft.delegateAllowlist : [] })} /></label>
            {draft.canDelegate && <>
              <label className="agent-depth">Niveles de delegación<select value={draft.delegationDepth} onChange={(event) => setDraft({ ...draft, delegationDepth: Number(event.target.value) })}>{[1, 2, 3, 4].map((depth) => <option key={depth} value={depth}>{depth}</option>)}</select><small>Con un nivel, sus ayudantes no pueden volver a delegar.</small></label>
              <div className="agent-delegate-heading"><strong>Quién puede ayudarlo</strong><small>{draft.delegateAllowlist.length} seleccionados</small></div>
              {(!draft.delegateAllowlist.length || unavailableDelegates.length > 0) && <p className="agent-editor-warning"><AlertCircle size={14} />{!draft.delegateAllowlist.length ? 'Selecciona al menos un agente para que pueda delegar.' : 'Algunos agentes elegidos están desactivados o ya no están disponibles.'}</p>}
              <div className="agent-delegate-list">{delegates.map((agent) => <label key={agent.id}><input type="checkbox" checked={draft.delegateAllowlist.includes(agent.id)} onChange={(event) => setDraft({ ...draft, delegateAllowlist: event.target.checked ? [...draft.delegateAllowlist, agent.id] : draft.delegateAllowlist.filter((id) => id !== agent.id) })} /><span><b>{agent.name}</b><small>{agent.description}</small></span></label>)}</div>
            </>}
            <p className="agent-permission-note"><ShieldCheck size={15} />Todos heredan el modelo, el esfuerzo y los límites de la conversación.</p>
          </div>}
          {step === 3 && <div className="agent-wizard-page agent-review">
            <div className="agent-section-heading"><h3>Revisa y guarda</h3><p>Puedes probar el agente antes de activarlo.</p></div>
            {!valid && <div className="agent-editor-warning"><AlertCircle size={14} /><span>Completa el nombre y las instrucciones antes de guardar.</span><button type="button" onClick={() => setStep(0)}>Ir a Objetivo</button></div>}
            <div className="agent-review-card"><span className="agent-mark"><Bot size={20} /></span><span><b>{draft.name || 'Tu nuevo agente'}</b><small>{draft.description || 'Sin descripción de uso'}</small></span><button type="button" className="agent-review-edit" onClick={() => setStep(0)} aria-label="Editar objetivo"><Pencil size={13} /></button></div>
            <div className="agent-review-section"><div><strong>Resultado esperado</strong><button type="button" onClick={() => setStep(0)}>Editar</button></div><p>{draft.outcome || 'Un resumen de sus hallazgos y acciones verificadas.'}</p></div>
            <details className="agent-review-instructions"><summary>Ver instrucciones completas</summary><pre>{draft.instructions || 'Sin instrucciones'}</pre></details>
            <div className="agent-review-facts">
              <button type="button" onClick={() => setStep(1)}><span>Capacidades</span><strong>{draft.toolAllowlist.length} herramientas · {draft.skillAllowlist.length} Skills</strong><ChevronRight size={14} /></button>
              <button type="button" onClick={() => setStep(2)}><span>Asignación</span><strong>{draft.autoAssign ? 'Automática o manual' : 'Selección manual'}</strong><ChevronRight size={14} /></button>
              <button type="button" onClick={() => setStep(2)}><span>Colaboración</span><strong>{draft.canDelegate ? <>{draft.delegateAllowlist.length} {draft.delegateAllowlist.length === 1 ? 'agente' : 'agentes'} · {draft.delegationDepth} {draft.delegationDepth === 1 ? 'nivel' : 'niveles'}</> : 'Sin delegación'}</strong><ChevronRight size={14} /></button>
            </div>
            <section className="agent-test-section" aria-label="Probar agente">
              <h4>Prueba de solo lectura</h4><p>Usa el modelo de tu conversación y puede consumir tokens. No guarda ni activa el agente.</p>
              <label>Tarea de prueba<textarea rows={2} value={testPrompt} maxLength={4_000} onChange={(event) => setTestPrompt(event.target.value)} /></label>
              <button type="button" className="agent-test" disabled={!session?.model || !session.providerId || !valid || !testPrompt.trim()} onClick={() => void test()}>{testing ? 'Probando…' : 'Probar ahora'}<ChevronRight size={13} /></button>
              {(!session?.model || !session.providerId) && <small>Selecciona un modelo en la conversación para probar el agente.</small>}
              {testResult && <div className="agent-test-result" role="status"><strong>Prueba real · {testResult.providerId} / {testResult.modelId}</strong><pre>{testResult.content || 'El modelo devolvió una respuesta vacía.'}</pre><small>{[testResult.inputTokens !== undefined ? String(testResult.inputTokens) + ' tokens de entrada' : '', testResult.outputTokens !== undefined ? String(testResult.outputTokens) + ' de salida' : '', String(testResult.durationMs) + ' ms', testResult.toolsRun?.length ? 'Herramientas ejecutadas: ' + testResult.toolsRun.join(', ') : 'Sin herramientas ejecutadas', testResult.toolCallsIgnored ? 'Algunas solicitudes no disponibles se omitieron.' : ''].filter(Boolean).join(' · ')}</small></div>}
            </section>
          </div>}
        </div>
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="surface-note" role="status">{notice}</p>}
      <footer className="agent-editor-footer">
        <span className="agent-footer-progress">Paso {step + 1} de {editorSteps.length}</span><span className="panel-title-spacer" />
        {step > 0 && <button type="button" className="agent-cancel" disabled={busy || testing} onClick={() => setStep(step - 1)}><ChevronLeft size={13} />Atrás</button>}
        {step < 3 ? <button type="button" className="agent-save" disabled={busy || testing || (step === 0 && !valid)} onClick={() => setStep(step + 1)}>Continuar<ChevronRight size={13} /></button> : <>
          <button type="button" className="agent-cancel" disabled={busy || testing || !valid} onClick={() => void save(false)}>{draft.enabled ? 'Guardar y desactivar' : 'Guardar borrador'}</button>
          <button type="button" className="agent-save" disabled={busy || testing || !valid} onClick={() => void save(true)}><Save size={14} />{busy ? 'Guardando…' : draft.enabled ? 'Guardar cambios' : 'Guardar y activar'}</button>
        </>}
      </footer>
    </section>
  </div></Localized>;
  return <Localized><div className="surface-page agent-studio">
    <div className="surface-heading"><Bot size={18} /><div><h2>Agentes</h2><p>Crea especialistas con herramientas, permisos heredados y delegación configurables.</p></div><span className="panel-title-spacer" /><div className="agent-surface-actions"><button type="button" onClick={exportProfiles} disabled={!profiles.length || transferring}>Exportar</button><label className="agent-import-button">{transferring ? 'Importando…' : 'Importar'}<input type="file" accept="application/json,.json" onChange={(event) => void importProfiles(event)} disabled={!health?.harnessConnected || transferring} /></label><button type="button" className="surface-refresh" onClick={create} disabled={!health?.harnessConnected || busy || transferring || loading}><Plus size={13} />Crear agente</button></div></div>
    {!health?.harnessConnected && <div className="surface-note">Conecta un workspace para administrar agentes persistentes. Los especialistas oficiales siguen disponibles en esta vista previa.</div>}
    <section className="agent-description-create"><label><Sparkles size={14} />Descríbelo en una frase<input value={starterDescription} maxLength={500} onChange={(event) => setStarterDescription(event.target.value)} placeholder="Ej.: revisa accesibilidad sin cambiar archivos" /></label><button type="button" onClick={createFromDescription} disabled={!starterDescription.trim() || !health?.harnessConnected || loading}><Sparkles size={12} />Preparar borrador</button><small>Se arma una plantilla en este dispositivo; no llama a un modelo ni consume tokens.</small></section>
    <label className="agent-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar agentes y especialistas" aria-label="Buscar agentes" /><span>{profiles.length + officialAgents.length}</span></label>
    <div className="agent-library-heading"><strong>Especialistas oficiales</strong><small>Elige quién llevará el próximo mensaje</small></div>
    <div className="agent-grid">{officialAgents.filter((agent) => `${agent.name} ${agent.detail}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((agent) => <button type="button" className={`agent-card ${agentId === agent.id ? 'is-active' : ''}`} key={agent.id} aria-pressed={agentId === agent.id} onClick={() => set('agentId', agent.id)}><span className="agent-mark"><Bot size={14} /></span><strong>{agent.name}</strong><small>{agent.detail}</small><span className="agent-card-tag">Oficial · Disponible</span></button>)}</div>
    <div className="agent-library-heading"><strong>Mis agentes</strong><small>{profiles.filter((profile) => profile.enabled).length} activos · {profiles.filter((profile) => !profile.enabled).length} borradores o desactivados</small></div>
    <div className="agent-grid">{profiles.filter((profile) => `${profile.name} ${profile.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((profile) => <article className={`agent-card agent-card--custom ${agentId === profile.id ? 'is-active' : ''} ${profile.enabled ? '' : 'is-disabled'}`} key={profile.id}><button type="button" className="agent-card-select" aria-pressed={agentId === profile.id} disabled={!profile.enabled} onClick={() => set('agentId', profile.id)}><span className="agent-mark"><Bot size={14} /></span><strong>{profile.name}</strong><small>{profile.description || 'Agente personalizado'}</small><span className="agent-card-tag">{profile.enabled ? 'Activo · elegible para selección' : 'Borrador o desactivado'} · {profile.toolAllowlist.length} herramientas</span></button><span className="agent-card-actions"><button type="button" aria-label={`Editar ${profile.name}`} title="Editar" onClick={() => edit(profile)}><Pencil size={12} /></button><button type="button" aria-label={`Eliminar ${profile.name}`} title="Eliminar" onClick={() => void remove(profile)} disabled={busy}><Trash2 size={12} /></button></span></article>)}</div>
    {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="surface-note" role="status"><Check size={13} />{notice}</p>}
    <p className="surface-note"><span>Seleccionado:</span> {officialAgents.find((agent) => agent.id === agentId)?.name ?? profiles.find((profile) => profile.id === agentId)?.name ?? 'General'}. <span>Los agentes personalizados no pueden cambiar de modelo ni ampliar el perfil de permisos de la sesión.</span></p>
  </div></Localized>;
}
