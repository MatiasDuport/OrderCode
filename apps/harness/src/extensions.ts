import { resolve } from "node:path";
import { HarnessError } from "./errors.js";
import type { McpRegistry } from "./mcp.js";
import type { SkillRegistry } from "./skills.js";
import type { PermissionCheckInput, PermissionEngine } from "./permissions.js";
import type { McpServerDraft, SessionRecord, ToolEffect } from "./types.js";

export interface ExtensionCatalogItem {
  id: string; kind: "skill" | "mcp"; name: string; description: string; category: string;
  publisher: string; version: string; sourceUrl: string; license?: string; requirements: string[];
  installed: boolean; enabled: boolean; connected: boolean; skillId?: string; serverId?: string;
  transport?: "stdio" | "streamable-http";
}
export interface ExtensionInstallResult { entry: ExtensionCatalogItem; status: "ready" | "installed" | "needs-setup"; message?: string }
interface Definition extends Omit<ExtensionCatalogItem, "installed" | "enabled" | "connected" | "serverId"> {
  content?: string; endpoint?: string; command?: string; args?: string[];
}
const skill = (id: string, name: string, description: string, category: string, guidance: string): Definition => ({
  id: `skill:${id}`, kind: "skill", name, description, category, publisher: "OrderCode", version: "1.0.0",
  sourceUrl: "https://github.com/MatiasDuport/OrderCode", license: "Apache-2.0", requirements: ["Carpeta de proyecto abierta"],
  skillId: `.agents/skills/ordercode-${id}/SKILL.md`,
  content: `---\nname: ordercode-${id}\ndisplay-name: ${name}\ncatalog-id: skill:${id}\ndescription: ${description}\nlicense: Apache-2.0\nversion: 1.0.0\n---\n\n# ${name}\n\nAplica esta guía solo cuando la tarea requiera ${category.toLowerCase()}. Mantén el alcance solicitado y los permisos de la sesión. Si no es relevante, no añadas trabajo ni instrucciones a la tarea.\n\n${guidance}\n`,
});
const remote = (id: string, name: string, description: string, publisher: string, endpoint: string, sourceUrl: string): Definition => ({
  id: `mcp:${id}`, kind: "mcp", name, description, category: "Documentación", publisher, version: "Remoto", sourceUrl,
  requirements: ["Conexión a Internet", "Envía consultas al servicio del publicador; no requiere clave", "Servicio remoto actualizado por su publicador", ...(id === "context7" ? ["Acceso gratuito básico sujeto a cuotas del servicio"] : [])], transport: "streamable-http", endpoint,
});
const DEFINITIONS: readonly Definition[] = [
  skill("web-design", "Diseño web", "Diseñar o mejorar interfaces web respetando el sistema visual del proyecto.", "Diseño web", "Lee las partes relevantes de DESIGN.md y los componentes existentes. Conserva tipografía, espaciado, estados e identidad definidos. Implementa comportamiento y accesibilidad junto con la apariencia; contempla teclado, foco, contraste, errores y tamaños de pantalla pertinentes. Usa recursos existentes y evita dependencias visuales innecesarias. Comprueba el resultado visual mediante las capacidades disponibles y distingue lo observado de lo pendiente."),
  skill("debug", "Depuración con evidencia", "Diagnosticar errores reproducibles y corregir su causa con evidencia concreta.", "Depuración", "Recoge el síntoma, la entrada que lo provoca y el error relevante. Busca primero el flujo implicado y formula una hipótesis verificable. Reduce el caso antes de cambiar código; contrasta causas alternativas cuando la evidencia sea ambigua. Aplica la corrección mínima que resuelve la causa y reproduce el caso original. Informa la evidencia, las limitaciones y cualquier comprobación bloqueada."),
  skill("code-review", "Revisión de código", "Revisar cambios buscando regresiones y problemas demostrables con referencias precisas.", "Revisión de código", "Lee el diff y sus contratos o consumidores relevantes. Prioriza errores de ejecución, pérdida de datos, permisos y regresiones observables. Para cada hallazgo explica la condición que lo activa, su impacto y una ubicación concreta; evita hallazgos especulativos o preferencias de estilo. No modifiques archivos durante una revisión salvo que se solicite. Si no encuentras problemas, dilo e indica los límites de la revisión."),
  skill("focused-tests", "Pruebas focalizadas", "Diseñar y ejecutar verificaciones relevantes para un cambio o integración concreta.", "Pruebas", "Identifica el comportamiento prometido y las fronteras afectadas. Reutiliza el entorno de pruebas existente. Escoge primero un caso que falle por la regresión y compruebe un resultado visible; añade casos de límites o errores solo cuando aporten cobertura distinta. Ejecuta el conjunto focalizado y amplía según el riesgo. Distingue fixtures de integración real, registra salida y código de resultado y nunca declares PASS por ausencia de ejecución."),
  skill("documentation", "Documentación clara", "Crear o actualizar documentación técnica según el comportamiento comprobado del proyecto.", "Documentación", "Identifica el lector y la decisión o tarea que debe poder completar. Usa las fuentes de verdad existentes y actualiza la sección afectada sin duplicarlas. Documenta requisitos reales, pasos reproducibles y errores relevantes; no inventes funciones, resultados ni compatibilidad. Mantén ejemplos pequeños y comprueba que nombres, rutas y comandos correspondan al código actual. Evita crear archivos de seguimiento o manuales redundantes."),
  skill("performance", "Rendimiento medido", "Investigar y mejorar un problema de rendimiento mediante mediciones comparables.", "Rendimiento", "Define la operación lenta, carga representativa y métrica observable antes de optimizar. Mide una referencia con el entorno y sus límites. Localiza el coste dominante con evidencia y cambia un factor relevante cada vez. Compara con las mismas entradas y condiciones, incluyendo memoria o recursos cuando importen. Conserva corrección y permisos; informa mediciones y variación, y no presentes intuiciones o fixtures como ganancias de producción."),
  remote("deepwiki", "DeepWiki", "Consulta documentación y estructura de repositorios públicos.", "Cognition", "https://mcp.deepwiki.com/mcp", "https://docs.devin.ai/work-with-devin/deepwiki-mcp"),
  remote("microsoft-learn", "Microsoft Learn", "Busca documentación oficial y ejemplos de Microsoft.", "Microsoft", "https://learn.microsoft.com/api/mcp", "https://learn.microsoft.com/training/support/mcp"),
  remote("context7", "Context7", "Recupera documentación y ejemplos de bibliotecas de programación.", "Upstash", "https://mcp.context7.com/mcp", "https://github.com/upstash/context7"),
  remote("cloudflare-docs", "Cloudflare Docs", "Consulta documentación de productos y servicios de Cloudflare.", "Cloudflare", "https://docs.mcp.cloudflare.com/mcp", "https://github.com/cloudflare/mcp-server-cloudflare"),
  { id: "mcp:playwright", kind: "mcp", name: "Playwright", description: "Automatiza un navegador local mediante el servidor oficial de Microsoft.", category: "Navegador", publisher: "Microsoft", version: "0.0.83", sourceUrl: "https://github.com/microsoft/playwright-mcp", license: "Apache-2.0", transport: "stdio", command: "npx", args: ["--yes", "@playwright/mcp@0.0.83", "--headless", "--isolated", ...(process.platform === "win32" ? ["--browser", "msedge"] : [])], requirements: ["Descarga el paquete fijado desde npm y ejecuta un proceso local", process.platform === "win32" ? "Microsoft Edge instalado" : "Navegador Chromium de Playwright y dependencias del sistema instalados", "Perfil de navegador aislado; las herramientas requieren autorización de la sesión"] },
];

/** UI-only extension lifecycle. Never registered in the model's ToolRegistry. */
export class ExtensionCatalog {
  private readonly mutations = new Map<string, Promise<unknown>>();
  constructor(private readonly skills: SkillRegistry, private readonly mcp: McpRegistry, private readonly permissions: PermissionEngine, private readonly getSession: (id: string) => SessionRecord) {}

  async list(sessionId?: string): Promise<ExtensionCatalogItem[]> {
    const session = sessionId === undefined ? undefined : this.getSession(sessionId);
    const skills = session ? await this.skills.list(session.projectPath) : [];
    const servers = session ? this.mcp.list(session.projectPath) : [];
    return DEFINITIONS.map((definition) => {
      const { content: _content, endpoint: _endpoint, command: _command, args: _args, ...item } = definition;
      if (definition.kind === "skill") {
        const installed = skills.find((skill) => skill.id === definition.skillId);
        return { ...item, requirements: [...item.requirements], installed: !!installed, enabled: installed?.enabled ?? false, connected: false };
      }
      const installed = servers.find(({ server }) => definition.endpoint ? server.transport === "streamable-http" && canonicalEndpoint(server.endpoint) === canonicalEndpoint(definition.endpoint) : server.transport === "stdio" && server.command === definition.command && JSON.stringify(server.args) === JSON.stringify(definition.args));
      return { ...item, requirements: [...item.requirements], installed: !!installed, enabled: installed?.server.enabled ?? false, connected: installed?.connected ?? false, ...(installed ? { serverId: installed.server.id } : {}) };
    });
  }

  async install(sessionId: string, extensionId: string, userApproved: unknown): Promise<ExtensionInstallResult> {
    if (userApproved !== true) throw new HarnessError("EXTENSION_CONSENT_REQUIRED", "La instalación requiere la acción explícita del usuario.");
    const definition = DEFINITIONS.find((entry) => entry.id === extensionId);
    if (!definition) throw new HarnessError("EXTENSION_NOT_FOUND", "La extensión no pertenece al catálogo autorizado.");
    const project = this.getSession(sessionId).projectPath;
    const previous = this.mutations.get(project) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.installOne(sessionId, definition));
    this.mutations.set(project, next);
    try { return await next; } finally { if (this.mutations.get(project) === next) this.mutations.delete(project); }
  }

  private authorize(sessionId: string, definition: Definition, effect: ToolEffect): void {
    const session = this.getSession(sessionId);
    const input: PermissionCheckInput = { sessionId, projectPath: session.projectPath, agentId: "general", mode: session.mode, toolName: "extensions.install", action: `install:${definition.id}`, effect, resource: definition.id, arguments: { extensionId: definition.id }, ...(definition.skillId ? { path: resolve(session.projectPath, definition.skillId) } : {}), ...(definition.endpoint ? { destination: new URL(definition.endpoint).origin } : definition.command ? { destination: "https://registry.npmjs.org" } : {}) };
    let decision = this.permissions.check(session.permissionProfile, input);
    if (decision.kind === "approval") {
      // The Install gesture authorizes only this exact check; no durable or session grant.
      this.permissions.resolve(decision.request.id, "once");
      decision = this.permissions.check(session.permissionProfile, input);
    }
    if (decision.kind !== "allow") throw new HarnessError("EXTENSION_PERMISSION_DENIED", decision.kind === "reject" ? decision.reason : "La sesión no permite instalar esta extensión.");
  }

  private async installOne(sessionId: string, definition: Definition): Promise<ExtensionInstallResult> {
    const session = this.getSession(sessionId);
    this.authorize(sessionId, definition, "WRITE");
    if (definition.kind === "skill") {
      await this.skills.installBundled(session.projectPath, `ordercode-${definition.id.slice(6)}`, definition.content!, () => this.authorize(sessionId, definition, "WRITE"));
      return { entry: (await this.list(sessionId)).find((entry) => entry.id === definition.id)!, status: "ready" };
    }
    // Check every side effect before saving config; rejected installs leave no config behind.
    this.authorize(sessionId, definition, "NETWORK");
    if (definition.transport === "stdio") this.authorize(sessionId, definition, "EXECUTE");
    let entry = (await this.list(sessionId)).find((item) => item.id === definition.id)!;
    if (entry.connected && entry.enabled) return { entry, status: "ready", ...(definition.command ? { message: "Servidor conectado. La disponibilidad del navegador se comprueba al usar sus herramientas." } : {}) };
    const current = entry.serverId ? this.mcp.get(entry.serverId) : undefined;
    const draft: McpServerDraft = current ? { ...current, enabled: true } : { projectPath: session.projectPath, name: definition.name, transport: definition.transport!, enabled: true, secretKeys: [], args: [...definition.args ?? []], ...(definition.endpoint ? { endpoint: definition.endpoint } : { command: definition.command }) };
    const server = current?.enabled ? current : await this.mcp.save(draft, () => this.authorize(sessionId, definition, "WRITE"));
    try {
      await this.mcp.connect(server.id, () => {
        this.authorize(sessionId, definition, "NETWORK");
        if (definition.transport === "stdio") this.authorize(sessionId, definition, "EXECUTE");
      });
    } catch (error) {
      entry = (await this.list(sessionId)).find((item) => item.id === definition.id)!;
      return { entry, status: "needs-setup", message: `Configuración guardada; no se pudo conectar: ${error instanceof Error ? error.message : "Error de conexión"}`.slice(0, 1200) };
    }
    entry = (await this.list(sessionId)).find((item) => item.id === definition.id)!;
    if (!entry.connected) return { entry, status: "needs-setup", message: "La conexión se cerró después del descubrimiento. Vuelve a conectar desde Extensiones." };
    return { entry, status: "ready", ...(definition.command ? { message: "Servidor conectado. La disponibilidad del navegador se comprueba al usar sus herramientas." } : {}) };
  }
}

function canonicalEndpoint(value?: string): string { try { const url = new URL(value!); url.pathname = url.pathname.replace(/\/$/, ""); return url.href; } catch { return ""; } }
