import { useEffect, useState, type ChangeEvent } from 'react';
import { Download, FilePlus2, Pencil, Upload, X } from 'lucide-react';
import { invokeHarnessTool, listProjectSkills, readProjectSkill, setProjectSkillEnabled } from '../lib/ipc';
import type { ProjectSkill } from '../lib/ipc';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';

interface Draft { id?: string; sha256?: string; name: string; description: string; body: string }
const EMPTY_FILE_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function decodeMetadata(value: string): string { return value.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_all, doubleQuoted: string | undefined, singleQuoted: string | undefined) => (doubleQuoted ?? singleQuoted ?? '').replaceAll('\\"', '"').replaceAll('\\\\', '\\')); }

function parseSkill(content: string, fallbackName: string): Pick<Draft, 'name' | 'description' | 'body'> {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const values: Record<string, string> = {};
  if (frontmatter) for (const line of (frontmatter[1] ?? '').split(/\r?\n/)) {
    const field = line.match(/^(name|description):\s*(.*?)\s*$/);
    if (field) values[field[1]!] = decodeMetadata(field[2] ?? '');
  }
  return { name: values.name || fallbackName, description: values.description || '', body: frontmatter ? content.slice(frontmatter[0].length).trimStart() : content };
}

function makeSkill(name: string, description: string, body: string): string {
  const safeName = name.trim().replace(/[\r\n]/g, ' ').slice(0, 80);
  const safeDescription = description.trim().replace(/[\r\n]/g, ' ').slice(0, 500);
  return `---\nname: ${JSON.stringify(safeName)}\ndescription: ${JSON.stringify(safeDescription)}\n---\n\n${body.trim()}\n`;
}

function skillSlug(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export function SkillsManager({ sessionId }: { sessionId?: string }) {
  const session = useDesktopStore((state) => state.session);
  const set = useDesktopStore((state) => state.set);
  const [skills, setSkills] = useState<ProjectSkill[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const enabledCount = skills.filter((skill) => skill.enabled).length;

  const refresh = async () => {
    if (!sessionId) { setSkills([]); return; }
    setError('');
    try { setSkills(await listProjectSkills(sessionId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  useEffect(() => { void refresh(); }, [sessionId]);

  const edit = async (skill: ProjectSkill) => {
    if (!sessionId || busy) return;
    setBusy(skill.id); setError(''); setNotice('');
    try {
      const value = await readProjectSkill(sessionId, skill.id);
      setDraft({ id: skill.id, sha256: value.sha256, ...parseSkill(value.content, skill.name) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const save = async () => {
    if (!sessionId || !session || !draft || busy) return;
    const name = draft.name.trim();
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) { setError('El nombre debe tener entre 1 y 80 caracteres visibles.'); return; }
    const path = draft.id ?? `.agents/skills/${skillSlug(name)}/SKILL.md`;
    if (!draft.id && (!skillSlug(name) || skills.some((skill) => skill.id === path))) { setError('Ya existe un Skill con ese nombre. Elige otro nombre.'); return; }
    const content = makeSkill(name, draft.description, draft.body);
    if (content.length > 128_000) { setError('El archivo SKILL.md no puede superar 128 KB.'); return; }
    setBusy('save'); setError(''); setNotice('');
    try {
      const result = await invokeHarnessTool(sessionId, 'fs.write', { path, content, expectedSha256: draft.sha256 ?? EMPTY_FILE_SHA256 });
      const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
      if (data.permissionRequest && typeof data.permissionRequest === 'object') {
        set('pendingPermission', data.permissionRequest as Record<string, unknown>);
        set('runtimeState', 'WAITING_APPROVAL');
        setNotice('La edición espera tu aprobación. Después de aprobarla, vuelve a guardar el Skill.');
        return;
      }
      if (result.status !== 'completed' || result.ok !== true) throw new Error(String(result.summary ?? 'No se pudo guardar el Skill.'));
      await refresh();
      setDraft(null);
      setNotice(`“${name}” quedó guardado en ${path}. Su contenido se trata como guía externa no confiable.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const importSkill = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setError(''); setNotice('');
    try {
      if (file.size > 128_000 || !/\.(?:md|markdown)$/i.test(file.name)) throw new Error('Importa un archivo Markdown de hasta 128 KB.');
      const content = await file.text();
      setDraft(parseSkill(content, file.name.replace(/\.(?:md|markdown)$/i, '')));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const exportSkill = async (skill: ProjectSkill) => {
    if (!sessionId) return;
    try {
      const value = await readProjectSkill(sessionId, skill.id);
      const url = URL.createObjectURL(new Blob([value.content], { type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${skillSlug(skill.name) || 'skill'}.md`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <Localized><section className="extension-section skills-manager">
    <div className="extension-section-heading"><strong>Skills del proyecto</strong><span>{enabledCount} {enabledCount === 1 ? 'activa' : 'activas'}</span><button type="button" className="skill-action-button" onClick={() => { setError(''); setNotice(''); setDraft({ name: '', description: '', body: '## Instrucciones\n\n' }); }} disabled={!session || !!busy}><FilePlus2 size={12} />Nuevo</button><label className="skill-action-button">{<Upload size={12} />}Importar<input type="file" accept=".md,.markdown,text/markdown" onChange={(event) => void importSkill(event)} disabled={!session || !!busy} /></label></div>
    {skills.length ? skills.map((skill) => <article className="extension-skill" key={skill.id}><div className="extension-skill-copy"><strong>{skill.name}</strong><small>{skill.description}</small>{skill.resources.length > 0 && <small>Recursos: {skill.resources.join(' · ')}</small>}</div><div className="skill-row-actions"><button type="button" className={`extension-switch ${skill.enabled ? 'is-active' : ''}`} role="switch" aria-checked={skill.enabled} aria-label={`${skill.enabled ? 'Desactivar' : 'Activar'} ${skill.name}`} disabled={!!busy} onClick={() => { setBusy(skill.id); void setProjectSkillEnabled(sessionId!, skill.id, !skill.enabled).then(setSkills).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy('')); }}>{skill.enabled ? 'Activa' : 'Activar'}</button><button type="button" className="skill-icon-button" aria-label={`Editar ${skill.name}`} title="Editar" disabled={!!busy} onClick={() => void edit(skill)}><Pencil size={12} /></button><button type="button" className="skill-icon-button" aria-label={`Exportar ${skill.name}`} title="Exportar" disabled={!!busy} onClick={() => void exportSkill(skill)}><Download size={12} /></button></div></article>) : <div className="surface-empty extension-empty">{sessionId ? 'No hay instrucciones guardadas. Crea una Skill o importa un archivo Markdown.' : 'Conecta un workspace para crear, importar y administrar Skills.'}</div>}
    {draft && <section className="skill-editor" aria-label="Editor de Skill"><div className="skill-editor-heading"><strong>{draft.id ? 'Editar Skill' : 'Nuevo Skill'}</strong><button type="button" aria-label="Cerrar editor de Skill" onClick={() => setDraft(null)}><X size={13} /></button></div><label>Nombre<input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Nombre del Skill" /></label><label>Descripción<input value={draft.description} maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Cuándo debe aplicarse este Skill" /></label><label>Instrucciones<textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} rows={10} placeholder="Instrucciones y enlaces a recursos relacionados" /></label><small>Al guardar, el archivo se escribe dentro del workspace con autorización del motor de permisos. El contenido no puede cambiar esas reglas.</small><div className="mcp-editor-actions"><button type="button" onClick={() => setDraft(null)} disabled={!!busy}>Cancelar</button><button type="button" onClick={() => void save()} disabled={!session || !draft.name.trim() || !!busy}>{busy === 'save' ? 'Guardando…' : 'Guardar Skill'}</button></div></section>}
    {error && <div className="surface-empty" role="alert">{error}</div>}{notice && <div className="surface-note" role="status">{notice}</div>}
  </section></Localized>;
}
