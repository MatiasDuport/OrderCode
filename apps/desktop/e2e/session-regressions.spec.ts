import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ExtensionCatalog as RuntimeExtensionCatalog } from '../../harness/src/extensions.js';
import type { ExtensionCatalogItem } from '../src/lib/contracts';

// Controlled native transport: regression checks, without paid calls or a user account.
test.beforeEach(async ({ page }) => {
  // Read the real offline catalogue; only native mutations and connections are controlled.
  const catalog = await new RuntimeExtensionCatalog(undefined as never, undefined as never, undefined as never, () => { throw new Error('No session expected for catalogue metadata'); }).list();
  await page.addInitScript((catalogEntries: ExtensionCatalogItem[]) => {
    if (!localStorage.getItem('ordercode.desktop.preferences.v1')) localStorage.setItem('ordercode.desktop.preferences.v1', JSON.stringify({ language: 'es', autoCheckUpdates: false }));
    const fixture = { sessionsCreated: 0, ready: false, slowResolved: false, modelRequests: 0, polls: 0, maxPolls: 0, cursors: [] as number[], runRequests: 0, completeEvents: false, graphFailure: true, folderResult: 'C:/fixtures/new-project' as string | null, requests: [] as Array<{ method: string; params: Record<string, unknown> }> };
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const extensions = fixture as typeof fixture & { catalogEntries: ExtensionCatalogItem[]; extensionInstallRequests: number; holdExtensionInstall?: boolean; extensionResolved?: boolean; extensionNeedsSetup?: boolean; extensionFailure?: boolean };
    extensions.catalogEntries = catalogEntries;
    extensions.extensionInstallRequests = 0;
    const rawSession = (id: string) => ({ id, projectPath: `C:/fixtures/${id}`, title: id, modelId: 'local-code', providerId: 'ollama', mode: 'build', permissionProfile: 'guided', state: 'COMPLETED', createdAt: new Date().toISOString(), sequence: 1500 });
    Object.assign(window, { auditFixture: fixture, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined }, __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      invoke: async (command: string, args: Record<string, unknown>) => {
        if (command === 'health') return { ok: fixture.ready, harnessConnected: fixture.ready, version: 'fixture', platform: 'windows' };
        if (command === 'plugin:window|is_maximized') return false;
        if (command === 'harness_start') { await pause(150); fixture.ready = true; return { ok: true, harnessConnected: true, version: 'fixture', platform: 'windows' }; }
        if (command === 'workspace_open') return args.projectPath;
        if (command === 'mcp_server_secret_status') return {};
        if (command === 'web_preview_check') {
          const state = fixture as typeof fixture & { previewChecks?: Record<string, unknown>; holdPreview?: boolean; previewPending?: boolean; previewResolved?: boolean; lastPreviewChecked?: string };
          state.lastPreviewChecked = String(args.url);
          if (String(args.url).includes('slow-preview')) {
            state.previewPending = true;
            while (state.holdPreview) await pause(25);
            state.previewResolved = true;
          }
          return state.previewChecks?.[String(args.url)] ?? { url: args.url, status: 200, issue: null };
        }
        if (command === 'workspace_read_file') {
          Object.assign(fixture, { lastFileRead: args.path });
          const delayedRead = fixture as unknown as { holdGraphicRead?: boolean; graphicReadPending?: boolean; graphicReadResolved?: boolean };
          if (args.path === 'graphs/curve.svg' && delayedRead.holdGraphicRead) {
            delayedRead.graphicReadPending = true;
            while (delayedRead.holdGraphicRead) await pause(25);
            delayedRead.graphicReadResolved = true;
          }
          if (args.path === 'img/campo.jpg') return { kind: 'image', mimeType: 'image/png', dataUrl: (fixture as unknown as { imageData: string }).imageData, size: 2048 };
          if (args.path === 'graphs/curve.svg') return { kind: 'text', size: 96, content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><path d="M3 35L35 8L72 24" stroke="blue" fill="none"/></svg>' };
          if (args.path === 'graphs/report.html') return { kind: 'text', size: 120, content: '<!doctype html><html><body><strong>Gráfica estática</strong><script>document.body.append("Este script no debe ejecutarse")</script></body></html>' };
          if (args.path === 'archive.bin') return { kind: 'binary', size: 256 };
          return { kind: 'text', size: 44, content: 'export function main() { return helper(); }' };
        }
        if (command === 'plugin:dialog|open') return fixture.folderResult;
        if (command === 'plugin:event|listen') return 1;
        if (command === 'plugin:event|unlisten') return null;
        if (command === 'plugin:opener|open_url') { Object.assign(fixture, { lastOpenedUrl: args.url }); return null; }
        if (command === 'workspace_tree') {
          const files = [
            { path: '.playwright-mcp', kind: 'directory', size: 0 },
            { path: '.playwright-mcp/console-2026-10-18.log', kind: 'file', size: 2048 },
            { path: 'src', kind: 'directory', size: 0 },
            { path: 'img', kind: 'directory', size: 0 },
            { path: 'img/campo.jpg', kind: 'file', size: 2048 },
            { path: 'graphs', kind: 'directory', size: 0 },
            { path: 'graphs/curve.svg', kind: 'file', size: 96 },
            { path: 'graphs/report.html', kind: 'file', size: 120 },
            { path: 'archive.bin', kind: 'file', size: 256 },
            { path: 'src/components', kind: 'directory', size: 0 },
            { path: 'src/components/Button.tsx', kind: 'file', size: 128 },
            { path: 'src/App.tsx', kind: 'file', size: 256 },
            { path: 'src/styles.css', kind: 'file', size: 64 },
            { path: 'public', kind: 'directory', size: 0 },
            { path: '.gitignore', kind: 'file', size: 32 },
            { path: 'package.json', kind: 'file', size: 48 },
            { path: 'README.md', kind: 'file', size: 128 },
            { path: 'tsconfig.json', kind: 'file', size: 128 },
          ];
          if (typeof args.directory === 'string') return files.filter((entry) => entry.path.split('/').slice(0, -1).join('/') === args.directory);
          return args.showAuxiliary ? files : files.filter((entry) => !entry.path.startsWith('.playwright-mcp'));
        }
        if (command === 'git_status') return '## main...origin/main\n M src/App.tsx';
        if (command !== 'harness_request') return null;
        const { method, params } = args.request as { method: string; params: Record<string, unknown> };
        fixture.requests.push({ method, params });
        let result: unknown;
        if (method === 'providers.list') {
          fixture.modelRequests += 1;
          if (!fixture.ready) throw new Error('Harness has not started');
          result = (fixture as unknown as { providers?: unknown[] }).providers ?? [{ id: 'ollama', configured: true }, { id: 'lmstudio', configured: true }];
        } else if (method === 'provider.models') {
          const override = (fixture as unknown as { providerModels?: Record<string, unknown[]> }).providerModels?.[String(params.providerId)];
          if (override) result = override;
          else {
            if (params.providerId === 'lmstudio') { await pause(2500); fixture.slowResolved = true; }
            result = [{ id: 'local-code', providerId: params.providerId, label: params.providerId === 'ollama' ? 'Fast local code' : 'Slow local code', available: true, priceKind: 'local', reasoningEfforts: params.providerId === 'ollama' ? ['low', 'high'] : [] }];
          }
        } else if (method === 'session.list') result = [];
        else if (method === 'session.create') { while ((fixture as unknown as { holdCreate?: boolean }).holdCreate) await pause(25); fixture.sessionsCreated += 1; result = { ...rawSession(fixture.sessionsCreated === 1 ? 'new-project' : 'new-project-' + fixture.sessionsCreated), ...params }; }
        else if (method === 'session.update') {
          const update = fixture as unknown as { holdUpdate?: boolean; failUpdate?: boolean; updateRejected?: boolean };
          while (update.holdUpdate) await pause(25);
          if (update.failUpdate) { update.updateRejected = true; throw new Error('Controlled late settings failure'); }
          result = true;
        }
        else if (method === 'agents.list') result = (fixture as unknown as { customAgents?: unknown[] }).customAgents ?? [];
        else if (method === 'tools.list') result = [
          { name: 'fs.read', description: 'Lee archivos del proyecto.', effects: ['READ'] },
          { name: 'fs.write', description: 'Modifica archivos del proyecto.', effects: ['WRITE'] },
          { name: 'code.search', description: 'Busca símbolos y texto.', effects: ['READ'] },
          { name: 'process.exec', description: 'Ejecuta comandos en el proyecto.', effects: ['EXECUTE'] },
          { name: 'git.push', description: 'Publica cambios en el remoto.', effects: ['PUBLISH'] },
          { name: 'mcp.docs.search', description: 'Consulta documentación conectada.', effects: ['READ'] },
        ];
        else if (method === 'extensions.catalog') result = extensions.catalogEntries.map((entry) => String(params.sessionId).startsWith('other') ? { ...entry, installed: false, enabled: false, connected: false } : { ...entry });
        else if (method === 'extensions.install') {
          extensions.extensionInstallRequests += 1;
          if (params.userApproved !== true) throw new Error('Explicit installation action required');
          while (extensions.holdExtensionInstall) await pause(25);
          extensions.extensionResolved = true;
          if (extensions.extensionFailure) throw new Error('No se pudo descargar la extensión de prueba.');
          const entry = extensions.catalogEntries.find((item) => item.id === params.extensionId)!;
          entry.installed = true; entry.enabled = true; entry.connected = entry.kind === 'mcp' && !extensions.extensionNeedsSetup;
          if (entry.kind === 'mcp') entry.serverId = `catalog-${entry.id}`;
          result = { entry: { ...entry }, status: extensions.extensionNeedsSetup ? 'needs-setup' : 'ready', message: extensions.extensionNeedsSetup ? 'Configuración guardada; el servicio no respondió.' : undefined };
        }
        else if (method === 'skills.list') result = [{ id: 'style-guide', name: 'Guía del proyecto', description: 'Convenciones de interfaz.', enabled: true, resources: [] }, ...extensions.catalogEntries.filter((entry) => entry.kind === 'skill' && entry.installed).map((entry) => ({ id: entry.skillId, name: entry.name, description: entry.description, enabled: entry.enabled, resources: [] }))];
        else if (method === 'skills.setEnabled') {
          const entry = extensions.catalogEntries.find((item) => item.skillId === params.skillId);
          if (entry) entry.enabled = Boolean(params.enabled);
          result = extensions.catalogEntries.filter((item) => item.kind === 'skill' && item.installed).map((item) => ({ id: item.skillId, name: item.name, description: item.description, enabled: item.enabled, resources: [] }));
        }
        else if (method === 'skills.read') {
          const entry = extensions.catalogEntries.find((item) => item.skillId === params.skillId)!;
          result = { id: entry.skillId, sha256: 'a'.repeat(64), content: `---\nname: ordercode-${entry.id.slice(6)}\ndisplay-name: ${entry.name}\ncatalog-id: ${entry.id}\ndescription: ${entry.description}\nlicense: Apache-2.0\nversion: 1.0.0\n---\n\nInstrucciones iniciales.` };
        }
        else if (method === 'mcp.list') result = extensions.catalogEntries.filter((entry) => entry.kind === 'mcp' && entry.installed).map((entry) => ({ server: { id: entry.serverId, projectPath: 'C:/fixtures/new-project', name: entry.name, transport: entry.transport, args: [], secretKeys: [], enabled: entry.enabled, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, connected: entry.connected, toolCount: entry.connected ? 1 : 0, tools: entry.connected ? [{ name: 'query_docs', description: 'Consulta documentación', inputSchema: { type: 'object' }, readOnly: true }] : [] }));
        else if (method === 'mcp.disconnect' || method === 'mcp.delete') {
          const entry = extensions.catalogEntries.find((item) => item.serverId === params.serverId);
          if (entry) { entry.connected = false; if (method === 'mcp.delete') { entry.installed = false; entry.enabled = false; } }
          result = true;
        }
        else if (method === 'agents.save') {
          const agents = fixture as typeof fixture & { customAgents?: Array<Record<string, unknown>>; failAgentSave?: boolean };
          if (agents.failAgentSave) throw new Error('Controlled agent save failure');
          const profile = { ...params.profile as Record<string, unknown> };
          profile.id ??= `custom-${(agents.customAgents?.length ?? 0) + 1}`;
          agents.customAgents = [...(agents.customAgents ?? []).filter((item) => item.id !== profile.id), profile];
          result = profile;
        }
        else if (method === 'agents.test') result = { content: 'Hallazgos verificados en la prueba controlada.', providerId: 'ollama', modelId: 'local-code', inputTokens: 120, outputTokens: 40, durationMs: 25, toolsRun: ['fs.read'] };
        else if (method === 'usage.analytics') {
          const usage = fixture as unknown as { holdUsage?: boolean; usageResolved?: boolean };
          while (usage.holdUsage) await pause(25);
          usage.usageResolved = true;
          result = { latestCall: { inputTokens: 12345 }, estimatedSavedTokens: 0 };
        }
        else if (method === 'session.get') result = rawSession(String(params.sessionId));
        else if (method === 'session.messages') result = [{ id: 'answer', role: 'assistant', content: 'Persisted final answer', createdAt: new Date().toISOString() }];
        else if (method === 'code.graph') {
          if (fixture.graphFailure) throw new Error('No se pudo indexar el workspace de prueba.');
          result = { query: String(params.query ?? ''), files: 2, symbols: 2, truncated: false, relationships: [
            { kind: 'IMPORTS', sourcePath: 'src/main.ts', targetPath: 'src/lib.ts', targetName: './lib', line: 1, confidence: 'confirmed' },
            { kind: 'CALLS', sourcePath: 'src/main.ts', sourceName: 'main', targetPath: 'src/lib.ts', targetName: 'helper', line: 4, confidence: 'inferred' },
          ] };
        } else if (method === 'tool.invoke') {
          const input = params.input as Record<string, unknown>;
          result = { ok: true, status: 'completed', summary: 'File opened', data: { path: input.path, content: 'export function main() { return helper(); }' } };
        } else if (method === 'session.events') {
          const custom = (fixture as unknown as { customEvents?: unknown[] }).customEvents;
          if (custom) return { result: (custom as Array<{ sequence: number }>).filter((event) => event.sequence > Number(params.afterSequence ?? 0)) };
          fixture.cursors.push(Number(params.afterSequence)); fixture.polls += 1; fixture.maxPolls = Math.max(fixture.maxPolls, fixture.polls);
          await pause(350); fixture.polls -= 1;
          result = fixture.completeEvents ? [{ id: 'complete', sessionId: params.sessionId, runId: 'run', sequence: 1502, type: 'run.completed', payload: {} }] : Number(params.afterSequence) < 1501 ? [{ id: 'chunk', sessionId: params.sessionId, runId: 'run', sequence: 1501, type: 'provider.chunk', payload: { chunk: 'A streamed chunk' } }] : [];
        } else if (method === 'permission.pending') result = [];
        else if (method === 'run') { fixture.runRequests += 1; while ((fixture as unknown as { holdRun?: boolean }).holdRun) await pause(25); await pause(900); result = { runId: 'run', state: 'COMPLETED', assistantMessage: { content: 'Persisted final answer' } }; }
        else result = [];
        return { result };
      },
    } });
  }, catalog);
});

async function setTestTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(async (value) => { const path = '/src/lib/store.ts'; const { useDesktopStore } = await import(path); useDesktopStore.getState().set('theme', value); }, theme);
}

async function openChatProject(page: Page, url = '/') {
  await page.goto(url);
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await page.getByRole('option', { name: /Fast local code/ }).click();
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir proyecto' }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('new-project');
  await page.getByRole('button', { name: 'Cerrar proyecto', exact: true }).click();
}

async function openExtensions(page: Page) {
  const tools = page.locator('[aria-controls="navigation-tools"]');
  if (await tools.getAttribute('aria-expanded') !== 'true') await tools.click();
  const advanced = page.locator('[aria-controls="navigation-advanced-tools"]');
  if (await advanced.getAttribute('aria-expanded') !== 'true') await advanced.click();
  await page.getByRole('button', { name: 'Extensiones', exact: true }).click();
}

test('extension catalogue is available before choosing a project and filters real Skill and MCP entries', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto('/'); await openExtensions(page);
  await expect(page.getByRole('tab', { name: /Explorar/ })).toHaveAttribute('aria-selected', 'true');
  const catalog = page.getByRole('region', { name: 'Catálogo de extensiones' });
  await expect(catalog.getByRole('article')).toHaveCount(11);
  await expect(catalog.getByRole('button', { name: 'Abrir proyecto' })).toBeEnabled();
  await expect(catalog.getByRole('button', { name: 'Instalar Diseño web' })).toBeDisabled();
  await catalog.getByRole('button', { name: 'Skills', exact: true }).click();
  await expect(catalog.getByRole('article')).toHaveCount(6);
  await catalog.getByRole('button', { name: 'MCP', exact: true }).click();
  await expect(catalog.getByRole('article')).toHaveCount(5);
  await catalog.getByRole('searchbox', { name: 'Buscar Skills y MCP' }).fill('context7');
  await expect(catalog.getByRole('article', { name: 'Context7' })).toBeVisible();
  await expect(catalog.getByRole('article')).toHaveCount(1);
  await catalog.getByRole('searchbox').fill('no-existe');
  await expect(catalog.getByText('No hay coincidencias')).toBeVisible();
  await catalog.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await expect(catalog.getByRole('article')).toHaveCount(11);
  await page.getByRole('tab', { name: /Explorar/ }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Instrucciones/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /Instrucciones/ }).press('Home');
  await expect(page.getByRole('tab', { name: /Explorar/ })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => (window as unknown as { auditFixture: { extensionInstallRequests: number } }).auditFixture.extensionInstallRequests)).toBe(0);
  if (process.env.TEMP) await page.screenshot({ path: `${process.env.TEMP}/ordercode-extension-catalog-dark.png`, animations: 'disabled' });
  await setTestTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(catalog.getByRole('button', { name: 'Skills', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.TEMP) await page.screenshot({ path: `${process.env.TEMP}/ordercode-extension-catalog-light-mobile.png`, animations: 'disabled' });
});

test('extension installation is one action, updates managers and reconnects without claiming a failed MCP is ready', async ({ page }) => {
  await openChatProject(page); await openExtensions(page);
  const catalog = page.getByRole('region', { name: 'Catálogo de extensiones' });
  await expect(catalog.getByRole('article')).toHaveCount(11);
  await catalog.getByRole('button', { name: 'Instalar Diseño web' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(catalog.getByRole('button', { name: 'Activa Diseño web' })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { auditFixture: { extensionInstallRequests: number } }).auditFixture.extensionInstallRequests)).toBe(1);
  await page.getByRole('tab', { name: /Instrucciones/ }).click();
  await expect(page.getByRole('switch', { name: 'Desactivar Diseño web' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar Diseño web' }).click();
  await page.getByRole('region', { name: 'Editor de Skill' }).getByRole('textbox', { name: 'Instrucciones', exact: true }).fill('Mi guía adaptada al proyecto.');
  await page.getByRole('button', { name: 'Guardar Skill', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Editor de Skill' })).toHaveCount(0);
  const content = await page.evaluate(() => {
    const requests = (window as unknown as { auditFixture: { requests: Array<{ method: string; params: { name?: string; input?: { content?: string } } }> } }).auditFixture.requests;
    return requests.filter((request) => request.method === 'tool.invoke' && request.params.name === 'fs.write').at(-1)?.params.input?.content;
  });
  expect(content).toContain('catalog-id: "skill:web-design"');
  expect(content).toContain('name: "ordercode-web-design"');
  expect(content).toContain('Mi guía adaptada al proyecto.');
  await page.getByRole('switch', { name: 'Desactivar Diseño web' }).click();
  await page.getByRole('tab', { name: /Explorar/ }).click();
  await expect(catalog.getByRole('button', { name: 'Activar Diseño web' })).toBeEnabled();
  await catalog.getByRole('button', { name: 'Activar Diseño web' }).click();
  await expect(catalog.getByRole('button', { name: 'Activa Diseño web' })).toBeDisabled();
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { extensionNeedsSetup: true }));
  await catalog.getByRole('button', { name: 'Conectar Context7' }).click();
  await expect(catalog.getByText('Configuración guardada; el servicio no respondió.')).toBeVisible();
  await expect(catalog.getByRole('button', { name: 'Conectar Context7' })).toBeEnabled();
  await expect(catalog.getByRole('button', { name: 'Conectado Context7' })).toHaveCount(0);
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { extensionNeedsSetup: false }));
  await catalog.getByRole('button', { name: 'Conectar Context7' }).click();
  await expect(catalog.getByRole('button', { name: 'Conectado Context7' })).toBeDisabled();
  await page.getByRole('tab', { name: /Conexiones/ }).click();
  await expect(page.locator('.mcp-server-card').getByText('Context7', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click();
  await page.getByRole('tab', { name: /Explorar/ }).click();
  await expect(catalog.getByRole('button', { name: 'Conectar Context7' })).toBeEnabled();
});

test('extension catalogue respects read-only modes and ignores an installation response from a previous project', async ({ page }) => {
  await openChatProject(page); await openExtensions(page);
  const catalog = page.getByRole('region', { name: 'Catálogo de extensiones' });
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts'); useDesktopStore.getState().set('mode', 'Plan');
  });
  await expect(catalog.getByRole('button', { name: 'Instalar Diseño web' })).toBeDisabled();
  await expect(catalog.getByText(/Para instalar, usa Auto o Build/)).toBeVisible();
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts'); useDesktopStore.setState({ mode: 'Auto', permission: 'Lectura' });
  });
  await expect(catalog.getByRole('button', { name: 'Conectar Context7' })).toBeDisabled();
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts'); useDesktopStore.getState().set('permission', 'Guiado');
    Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdExtensionInstall: true });
  });
  await catalog.getByRole('button', { name: 'Conectar Context7' }).click();
  await expect(catalog.getByRole('status')).toContainText('Conectando MCP…');
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts'); const state = useDesktopStore.getState();
    state.set('session', { ...state.session!, id: 'other-project', projectPath: 'C:/fixtures/other-project' });
    Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdExtensionInstall: false });
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { extensionResolved?: boolean } }).auditFixture.extensionResolved)).toBe(true);
  await expect(catalog.getByRole('button', { name: 'Conectar Context7' })).toBeEnabled();
  await expect(catalog.getByRole('button', { name: 'Conectado Context7' })).toHaveCount(0);
  await expect(catalog.getByText('Lista para usar en tu próxima tarea.')).toHaveCount(0);
});

test('selects enabled specialists and restores the continuous task indicator after navigating away', async ({ page }) => {
  await openChatProject(page);
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, {
    customAgents: [
      { id: 'custom-docs', name: 'Docs activo', description: 'Documentación del proyecto', enabled: true },
      { id: 'custom-disabled', name: 'Perfil desactivado', description: 'No disponible', enabled: false },
    ],
    holdRun: true,
    customEvents: [{ id: 'continuous-start', sessionId: 'new-project', runId: 'run', sequence: 1501, type: 'session.state', payload: { state: 'RUNNING', continueUntilDone: true } }],
  }));
  const message = page.getByRole('textbox', { name: 'Mensaje para OrderCode' });
  await message.fill('/agents'); await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.locator('.agent-picker-option')).toHaveCount(9);
  await expect(page.getByRole('button', { name: /Perfil desactivado/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Docs activo Documentación/ }).click();
  await page.setViewportSize({ width: 480, height: 580 });
  await expect(page.getByRole('button', { name: 'Cerrar panel', exact: true })).toBeInViewport({ ratio: 1 });
  const pickerBounds = (await page.getByRole('region', { name: 'Agentes disponibles' }).boundingBox())!;
  expect(pickerBounds.y).toBeGreaterThanOrEqual(11);
  expect(pickerBounds.y + pickerBounds.height).toBeLessThanOrEqual(569);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Cerrar panel', exact: true }).click();
  await page.getByRole('button', { name: 'Activar modo continuo' }).click();
  await message.fill('Completa y verifica el objetivo');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { runRequests: number } }).auditFixture.runRequests)).toBe(1);
  for (const trigger of await page.locator('.composer .dropdown-trigger').all()) await expect(trigger).toBeDisabled();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Conversación', exact: true }).click();
  const continuous = page.locator('.continuous-toggle');
  await expect(continuous).toHaveAttribute('aria-pressed', 'true');
  await expect(continuous).toBeDisabled();
  await message.fill('/mode'); await message.press('Enter');
  await expect(page.getByText('Termina o detén la tarea antes de cambiar modelo, esfuerzo, modo o permisos.')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar panel', exact: true }).click();
  await page.evaluate(() => {
    const state = (window as unknown as { auditFixture: { holdRun: boolean; customEvents: unknown[] } }).auditFixture;
    state.customEvents.push({ id: 'continuous-complete', sessionId: 'new-project', runId: 'run', sequence: 1502, type: 'run.completed', payload: {} });
    state.holdRun = false;
  });
  await expect(page.getByText('Persisted final answer', { exact: true })).toBeVisible();
  await expect(continuous).toHaveAttribute('aria-pressed', 'false');
  await expect(continuous).toBeEnabled();
  await expect(page.locator('.composer-dropdown--model .dropdown-trigger')).toBeEnabled();
  await message.fill('Una consulta normal'); await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { runRequests: number } }).auditFixture.runRequests)).toBe(2);
  const runs = await page.evaluate(() => (window as unknown as { auditFixture: { requests: Array<{ method: string; params: Record<string, unknown> }> } }).auditFixture.requests.filter((request) => request.method === 'run').map((request) => request.params));
  expect(runs[0]).toMatchObject({ agentId: 'custom-docs', continueUntilDone: true });
  expect(runs[1]).toMatchObject({ continueUntilDone: false });
});

test('ignores late settings failures and context results after switching conversations', async ({ page }) => {
  await openChatProject(page);
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdUpdate: true, failUpdate: true }));
  await page.locator('.composer-dropdown--effort .dropdown-trigger').click();
  await page.getByRole('option', { name: 'Alto', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { requests: Array<{ method: string }> } }).auditFixture.requests.filter((request) => request.method === 'session.update').length)).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const path = '/src/lib/store.ts'; const { useDesktopStore } = await import(path); const state = useDesktopStore.getState();
    state.set('session', { ...state.session, id: 'other-project', projectPath: 'C:/fixtures/other-project', providerId: 'lmstudio', reasoningEffort: undefined });
    state.set('model', 'lmstudio::local-code'); state.set('mode', 'Plan'); state.set('permission', 'Lectura');
    Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdUpdate: false });
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { updateRejected?: boolean } }).auditFixture.updateRejected)).toBe(true);
  await expect(page.locator('.conversation-header h1')).toHaveText('other-project');
  await expect(page.locator('.composer-dropdown--mode .dropdown-trigger')).toContainText('Plan');
  await expect(page.locator('.composer-dropdown--options .dropdown-trigger')).toContainText('Lectura');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdUsage: true }));
  const message = page.getByRole('textbox', { name: 'Mensaje para OrderCode' });
  await message.fill('/context'); await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByText('Consultando el uso de esta conversación…')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/lib/store.ts'; const { useDesktopStore } = await import(path); const state = useDesktopStore.getState();
    state.set('session', { ...state.session, id: 'third-project', projectPath: 'C:/fixtures/third-project' });
    Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdUsage: false });
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { usageResolved?: boolean } }).auditFixture.usageResolved)).toBe(true);
  await expect(page.getByRole('region', { name: 'Uso del contexto' })).toHaveCount(0);
  await expect(page.locator('.conversation-header h1')).toHaveText('third-project');
});

test('toggles Workspace from the rail, closes it explicitly and keeps chrome compact in both themes', async ({ page }) => {
  await page.addInitScript(() => { const key = 'ordercode.desktop.preferences.v1'; localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), reducedMotion: true })); });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const workspace = page.getByRole('button', { name: 'Proyecto', exact: true });
  const panel = page.getByRole('complementary', { name: 'Proyecto' });
  await workspace.click(); await expect(panel).toBeVisible();
  await expect(workspace).toHaveAttribute('aria-expanded', 'true');
  await workspace.click(); await expect(panel).toBeHidden();
  await workspace.click(); await page.getByRole('button', { name: 'Cerrar proyecto', exact: true }).click();
  await expect(panel).toBeHidden();
  await workspace.click(); await page.keyboard.press('Escape'); await expect(panel).toBeHidden();
  await workspace.click(); await page.getByRole('button', { name: 'Ajustes', exact: true }).click(); await expect(panel).toBeHidden();
  const chrome = page.locator('.topbar');
  expect((await chrome.boundingBox())!.height).toBe(38);
  await expect(chrome.locator('.project-selector')).toHaveCount(0);
  await expect(chrome.locator('img')).toHaveAttribute('src', /LogoSinFondo/);
  await setTestTheme(page, 'light');
  await expect(chrome.locator('.brand-lockup')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await workspace.click();
  await expect(panel).toHaveCSS('width', '248px');
  if (process.env.TEMP) await page.screenshot({ path: `${process.env.TEMP}/ordercode-chrome-light.png`, animations: 'disabled' });
  await setTestTheme(page, 'dark');
  if (process.env.TEMP) await page.screenshot({ path: `${process.env.TEMP}/ordercode-chrome-dark.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 479, height: 700 });
  await expect(panel).toBeHidden();
  await workspace.click(); await expect(panel).toBeVisible();
  await page.locator('.workspace-panel-backdrop').click({ position: { x: 350, y: 150 } });
  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('expands navigation without covering Workspace and keeps tool navigation in sync with window resizing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  const workspace = nav.getByRole('button', { name: 'Proyecto', exact: true });
  const panel = page.getByRole('complementary', { name: 'Proyecto' });
  const workStack = page.locator('.work-stack');

  expect(await nav.evaluate((element) => getComputedStyle(element).transitionProperty)).toContain('flex-basis');
  await page.mouse.move(18, 100);
  await expect.poll(() => nav.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(196);
  let navBounds = (await nav.boundingBox())!;
  let workBounds = (await workStack.boundingBox())!;
  expect(workBounds.x).toBeGreaterThanOrEqual(navBounds.x + navBounds.width - 1);

  await workspace.click();
  await expect(panel).toBeVisible();
  navBounds = (await nav.boundingBox())!;
  let panelBounds = (await panel.boundingBox())!;
  expect(panelBounds.x).toBeGreaterThanOrEqual(navBounds.x + navBounds.width - 1);

  await page.setViewportSize({ width: 900, height: 700 });
  await workspace.click();
  await expect(panel).toBeVisible();
  await page.mouse.move(18, 100);
  await expect.poll(() => nav.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(56);
  navBounds = (await nav.boundingBox())!;
  panelBounds = (await panel.boundingBox())!;
  expect(panelBounds.x).toBeGreaterThanOrEqual(navBounds.x + navBounds.width - 1);

  await panel.getByRole('button', { name: 'Cerrar proyecto', exact: true }).click();
  await nav.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await nav.getByRole('button', { name: 'Cambios', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Cambios', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 500, height: 700 });
  await expect(nav.getByRole('button', { name: 'Cambios', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(nav.getByRole('button', { name: 'Cambios', exact: true })).toBeVisible();
});

test('explores a clean folder tree, searches nested files and opens them in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir proyecto' }).click();
  const panel = page.getByRole('complementary', { name: 'Proyecto' });
  const src = panel.getByRole('treeitem', { name: 'src', exact: true });
  await expect(src).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('treeitem', { name: /console-/ })).toHaveCount(0);
  await expect(panel.getByRole('treeitem', { name: '.gitignore', exact: true })).toBeVisible();
  await expect(panel.locator('.workspace-git')).toContainText('main');
  await expect(panel.locator('.workspace-git')).toContainText('1 cambio');
  await src.click();
  await expect(panel.getByRole('treeitem', { name: 'App.tsx', exact: true })).toBeVisible();
  await src.press('ArrowRight');
  await expect(panel.getByRole('treeitem', { name: 'components', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('treeitem', { name: 'Button.tsx', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Contraer carpetas' }).click();
  await expect(panel.getByRole('treeitem', { name: 'App.tsx', exact: true })).toHaveCount(0);
  const search = panel.getByRole('textbox', { name: 'Buscar archivos' });
  await search.fill('Button');
  await expect(panel.getByRole('treeitem', { name: 'Button.tsx', exact: true })).toBeVisible();
  await expect(src).toHaveAttribute('aria-expanded', 'true');
  await src.click();
  await expect(panel.getByRole('treeitem', { name: 'Button.tsx', exact: true })).toHaveCount(0);
  await src.press('ArrowRight');
  await expect(panel.getByRole('treeitem', { name: 'Button.tsx', exact: true })).toBeVisible();
  await search.fill('no-existe');
  await expect(panel.getByText('Sin archivos coincidentes')).toBeVisible();
  await search.press('Escape');
  await expect(panel).toBeVisible();
  await expect(search).toHaveValue('');
  const filter = panel.getByRole('button', { name: 'Mostrar carpetas ocultas y auxiliares' });
  await filter.click();
  await panel.getByRole('treeitem', { name: '.playwright-mcp', exact: true }).click();
  await expect(panel.getByRole('treeitem', { name: 'console-2026-10-18.log' })).toBeVisible();
  await filter.click();
  await expect(panel.getByRole('treeitem', { name: /console-/ })).toHaveCount(0);
  await src.click();
  await panel.getByRole('treeitem', { name: 'App.tsx', exact: true }).click();
  await expect(panel.getByRole('treeitem', { name: 'App.tsx', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.editor-toolbar code')).toHaveText('src/App.tsx');
  await page.getByRole('button', { name: 'Cerrar revisión' }).click();
  await panel.getByRole('treeitem', { name: 'App.tsx', exact: true }).click();
  await expect(page.locator('.editor-toolbar code')).toBeVisible();
  expect(await panel.locator('.workspace-tree-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  if (process.env.TEMP) await panel.screenshot({ path: `${process.env.TEMP}/ordercode-workspace-dark.png`, animations: 'disabled' });
  await setTestTheme(page, 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(panel.getByRole('treeitem', { name: 'App.tsx', exact: true })).toHaveCSS('color', await page.locator('html').evaluate((element) => getComputedStyle(element).color));
  if (process.env.TEMP) await panel.screenshot({ path: `${process.env.TEMP}/ordercode-workspace-light.png`, animations: 'disabled' });
  await panel.getByRole('button', { name: 'Actualizar archivos' }).click();
  await expect(src).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(page.locator('.theme-switch')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByRole('button', { name: 'Abrir control de versiones' }).click();
  await expect(panel).toBeHidden();
});

test('previews images safely, protects binary files and keeps the full text editor', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const dataUrl = `data:image/png;base64,${(await readFile(new URL('../../../brand/LogoSinFondo.png', import.meta.url))).toString('base64')}`;
  await page.evaluate((imageData) => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { imageData }), dataUrl);
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir proyecto' }).click();
  const panel = page.getByRole('complementary', { name: 'Proyecto' });
  await panel.getByRole('treeitem', { name: 'img', exact: true }).click();
  await panel.getByRole('treeitem', { name: 'campo.jpg', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Vista previa: img/campo.jpg', exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.diff-empty')).toHaveCount(0);
  await expect(preview.getByRole('button', { name: 'Guardar', exact: true })).toHaveCount(0);
  await expect(page.locator('.monaco-editor-shell')).toHaveCount(0);
  await preview.getByRole('button', { name: 'Ampliar imagen' }).click();
  await expect(preview.locator('.image-preview-scale')).toHaveText('125%');
  await preview.getByRole('button', { name: 'Ajustar imagen' }).click();
  await expect(preview.locator('.image-preview-scale')).toHaveText('Ajustar');
  if (process.env.TEMP) await page.screenshot({ path: `${process.env.TEMP}/ordercode-preview-fix.png`, animations: 'disabled' });
  await panel.getByRole('treeitem', { name: 'archive.bin', exact: true }).click();
  await expect(page.getByText('Archivo binario', { exact: true })).toBeVisible();
  await expect(page.locator('.monaco-editor-shell')).toHaveCount(0);
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { imageData: 'data:image/png;base64,bm90LWFuLWltYWdl' }));
  await panel.getByRole('treeitem', { name: 'campo.jpg', exact: true }).click();
  await expect(page.getByText('No se pudo mostrar la imagen', { exact: true })).toBeVisible();
  await panel.getByRole('treeitem', { name: 'src', exact: true }).click();
  await panel.getByRole('treeitem', { name: 'App.tsx', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Editor de código: src/App.tsx' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { auditFixture: { requests: Array<{ method: string }> } }).auditFixture.requests.some((item) => item.method === 'tool.invoke'))).toBe(false);
  await expect(page.getByRole('region', { name: 'Ejecución de tareas' })).toHaveCount(0);
});

test('discovers and safely previews SVG graphics and static HTML from the project', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const dataUrl = `data:image/png;base64,${(await readFile(new URL('../../../brand/LogoSinFondo.png', import.meta.url))).toString('base64')}`;
  await page.evaluate((imageData) => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { imageData }), dataUrl);
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir proyecto' }).click();
  await page.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  await page.getByRole('tab', { name: /Imágenes y gráficas/ }).click();
  await expect(page.getByRole('button', { name: 'graphs/curve.svg' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'graphs/report.html' })).toBeVisible();
  await page.getByRole('button', { name: 'img/campo.jpg' }).click();
  const raster = page.getByRole('img', { name: 'Gráfica: img/campo.jpg' });
  await expect.poll(() => raster.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'graphs/curve.svg' }).click();
  const image = page.getByRole('img', { name: 'Gráfica: graphs/curve.svg' });
  await expect(image).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await page.getByRole('button', { name: 'graphs/report.html' }).click();
  const chartFrame = page.locator('iframe[title="Gráfica graphs/report.html"]');
  await expect(chartFrame).toHaveAttribute('sandbox', '');
  await expect(page.frameLocator('iframe[title="Gráfica graphs/report.html"]').getByText('Gráfica estática')).toBeVisible();
  await expect(page.locator('.visualizer-security-note')).toContainText('se omitieron los scripts');
  await expect(page.frameLocator('iframe[title="Gráfica graphs/report.html"]').getByText('Este script no debe ejecutarse')).toHaveCount(0);
});

test('changing conversations during a graphic read does not block later previews or show stale content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChatProject(page);
  await page.getByRole('button', { name: 'Abrir vista previa', exact: true }).click();
  const preview = page.getByRole('complementary', { name: 'Vista previa' });
  await preview.getByRole('tab', { name: /Imágenes y gráficas/ }).click();
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdGraphicRead: true }));
  await preview.getByRole('button', { name: 'graphs/curve.svg' }).click();
  await expect(preview.getByText('Cargando vista previa…')).toBeVisible();
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { sessionsCreated: number } }).auditFixture.sessionsCreated)).toBe(2);
  await page.getByRole('button', { name: 'Abrir vista previa', exact: true }).click();
  await preview.getByRole('button', { name: 'graphs/report.html' }).click();
  const chart = preview.locator('iframe[title="Gráfica graphs/report.html"]');
  await expect(chart).toBeVisible();
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdGraphicRead: false }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { graphicReadResolved?: boolean } }).auditFixture.graphicReadResolved)).toBe(true);
  await expect(chart).toBeVisible();
  await expect(preview.getByRole('img', { name: 'Gráfica: graphs/curve.svg' })).toHaveCount(0);
});

test('keeps the web preview within its project when switching to a different workspace', async ({ page }) => {
  await page.route('https://project.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<main>Primer proyecto</main>' }));
  await openChatProject(page);
  await page.getByRole('button', { name: 'Abrir vista previa', exact: true }).click();
  const preview = page.getByRole('complementary', { name: 'Vista previa' });
  const address = preview.getByRole('textbox', { name: 'Dirección web' });
  await address.fill('https://project.example.test/');
  await preview.getByRole('button', { name: 'Abrir', exact: true }).click();
  await expect(preview.locator('iframe[title="Vista previa web"]')).toHaveAttribute('src', 'https://project.example.test/');
  await page.evaluate(async () => {
    const path = '/src/lib/store.ts'; const { useDesktopStore } = await import(path); const state = useDesktopStore.getState();
    state.set('session', { ...state.session, id: 'other-workspace', projectPath: 'C:/fixtures/other-workspace' });
  });
  await expect(address).toHaveValue('');
  await expect(preview.locator('iframe[title="Vista previa web"]')).toHaveCount(0);
  await expect(page.locator('.conversation-header h1')).toHaveText('other-workspace');
});

test('opens code-formatted chat URLs in the quick web preview and preserves the address', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('https://project.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<main>Proyecto visible</main>' }));
  await openChatProject(page);
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts');
    useDesktopStore.setState({ messages: [{ id: 'url', role: 'assistant', content: 'Tu proyecto está en `https://project.example.test/`.', timestamp: '12:00' }] });
  });
  await page.locator('.chat-markdown code').getByRole('link').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { lastOpenedUrl?: string } }).auditFixture.lastOpenedUrl)).toBe('https://project.example.test/');
  await page.getByRole('button', { name: 'Ver en vista previa: https://project.example.test/' }).click();
  const preview = page.getByRole('complementary', { name: 'Vista previa' });
  await expect(preview.getByRole('textbox', { name: 'Dirección web' })).toHaveValue('https://project.example.test/');
  await expect(preview.frameLocator('iframe[title="Vista previa web"]').getByText('Proyecto visible')).toBeVisible();
  await expect(preview.getByText('Comprobando enlace…')).toHaveCount(0);
  await preview.getByRole('button', { name: 'Cerrar vista previa' }).click();
  await expect(preview.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir vista previa', exact: true }).click();
  await expect(preview.getByRole('textbox', { name: 'Dirección web' })).toHaveValue('https://project.example.test/');
  await expect(preview.frameLocator('iframe[title="Vista previa web"]').getByText('Proyecto visible')).toBeVisible();
  await preview.getByRole('button', { name: '¿No se ve la página?' }).click();
  await expect(preview.getByText(/La web puede bloquear la vista integrada/)).toBeVisible();
});

test('web preview explains HTTP, embedding and local connection failures and ignores stale checks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChatProject(page);
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { previewChecks: {
    'https://missing.example.test/': { url: 'https://missing.example.test/', status: 404, issue: 'http' },
    'https://blocked.example.test/': { url: 'https://blocked.example.test/', status: 200, issue: 'embedded' },
    'http://localhost:3999/': { url: 'http://localhost:3999/', status: null, issue: 'unavailable' },
  } }));
  await page.getByRole('button', { name: 'Abrir vista previa', exact: true }).click();
  const preview = page.getByRole('complementary', { name: 'Vista previa' });
  const address = preview.getByRole('textbox', { name: 'Dirección web' });
  const go = preview.getByRole('button', { name: 'Abrir', exact: true });
  for (const [url, title] of [
    ['https://missing.example.test', 'No hay una página en esta dirección'],
    ['https://blocked.example.test', 'Esta web no permite la vista integrada'],
    ['localhost:3999', 'No se pudo abrir la página'],
  ]) {
    await address.fill(url!); await go.click();
    await expect(preview.getByRole('alert').getByText(title!)).toBeVisible();
    await expect(preview.locator('iframe')).toHaveCount(0);
  }
  await expect(preview.getByText(/servidor del proyecto esté iniciado/)).toBeVisible();
  await preview.getByRole('alert').getByRole('button', { name: 'Abrir en el navegador' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { lastOpenedUrl?: string } }).auditFixture.lastOpenedUrl)).toBe('http://localhost:3999/');
  if (process.env.TEMP) await preview.screenshot({ path: `${process.env.TEMP}/ordercode-web-preview-error.png`, animations: 'disabled' });
  await setTestTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(address).toBeInViewport();
  await expect(preview.getByRole('alert').getByRole('button', { name: 'Reintentar' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.TEMP) await preview.screenshot({ path: `${process.env.TEMP}/ordercode-web-preview-light-mobile.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await address.fill('javascript:alert(1)'); await go.click();
  await expect(preview.getByText(/Usa una dirección HTTPS válida/)).toBeVisible();
  await address.fill('http://127.0.0.1:5174/'); await go.click();
  await expect(preview.getByText('Esta dirección pertenece a OrderCode')).toBeVisible();
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdPreview: true }));
  await address.fill('https://slow-preview.example.test/'); await go.click();
  await expect(preview.getByRole('status')).toHaveText('Comprobando enlace…');
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts');
    const state = useDesktopStore.getState();
    state.set('session', { ...state.session!, id: 'next-project', projectPath: 'C:/fixtures/next-project' });
    Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdPreview: false });
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { previewResolved?: boolean } }).auditFixture.previewResolved)).toBe(true);
  await expect(address).toHaveValue('');
  await expect(preview.locator('iframe')).toHaveCount(0);
  await expect(preview.getByText('Mira aquí lo que estás creando')).toBeVisible();
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts');
    useDesktopStore.getState().set('language', 'en');
  });
  await preview.getByRole('textbox', { name: 'Web address' }).fill('https://missing.example.test/');
  await preview.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(preview.getByText('There is no page at this address')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('installed-shell preview loads module apps while CSP prevents navigation back to the native app', async ({ page }) => {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  let escapedRequests = 0;
  await page.route('http://tauri.localhost/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/escape') escapedRequests += 1;
    const response = await route.fetch({ url: `http://127.0.0.1:5174${url.pathname}${url.search}` });
    await route.fulfill({ response, headers: { ...response.headers(), ...(url.pathname === '/' ? { 'content-security-policy': config.app.security.csp } : {}) } });
  });
  await page.route('https://interactive.example.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: `const data = await fetch('/data.json').then(r => r.json()); document.querySelector('h1').textContent = data.title; try { window.parent.document.body.dataset.escaped = 'yes'; } catch { document.querySelector('p').textContent = 'Acceso al chat bloqueado'; } document.querySelector('button').onclick = () => { location.href = 'http://tauri.localhost/escape'; };` });
    if (path === '/data.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'Web interactiva lista' }) });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Cargando app</h1><p></p><button>Volver al origen nativo</button><script type="module" src="/app.js"></script>' });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChatProject(page, 'http://tauri.localhost/');
  await page.getByRole('button', { name: 'Abrir vista previa', exact: true }).click();
  const preview = page.getByRole('complementary', { name: 'Vista previa' });
  await preview.getByRole('textbox', { name: 'Dirección web' }).fill('https://interactive.example.test/');
  await preview.getByRole('button', { name: 'Abrir', exact: true }).click();
  const frame = preview.frameLocator('iframe[title="Vista previa web"]');
  await expect(frame.getByText('Web interactiva lista')).toBeVisible();
  await expect(frame.getByText('Acceso al chat bloqueado')).toBeVisible();
  await expect(preview.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
  expect(await page.evaluate(() => document.body.dataset.escaped)).toBeUndefined();
  if (process.env.TEMP) await preview.screenshot({ path: `${process.env.TEMP}/ordercode-web-preview-interactive.png`, animations: 'disabled' });
  await frame.getByRole('button', { name: 'Volver al origen nativo' }).click();
  await page.waitForTimeout(200);
  expect(escapedRequests).toBe(0);
  await expect(page.locator('.conversation-header h1')).toHaveText('new-project');
  await preview.getByRole('tab', { name: /Imágenes y gráficas/ }).click();
  await preview.getByRole('button', { name: 'graphs/report.html' }).click();
  await expect(preview.frameLocator('iframe[title="Gráfica graphs/report.html"]').getByText('Gráfica estática')).toBeVisible();
});

test('pairs parallel tools and resolves permission activity without changing the run state', async ({ page }) => {
  await page.goto('/');
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await page.getByRole('option', { name: /Fast local code/ }).click();
  await page.evaluate(() => {
    const base = { sessionId: 'new-project', runId: 'activity-run' };
    const customEvents = [
      { ...base, id: 'run-start', sequence: 1501, type: 'run.started', payload: { state: 'RUNNING' } },
      { ...base, id: 'start-a', sequence: 1502, type: 'tool.started', payload: { toolName: 'git.diff', invocationId: 'a' } },
      { ...base, id: 'start-b', sequence: 1503, type: 'tool.started', payload: { toolName: 'git.diff', invocationId: 'b' } },
      { ...base, id: 'end-b', sequence: 1504, type: 'tool.completed', payload: { toolName: 'git.diff', invocationId: 'b', result: { status: 'failed', summary: 'Second request failed.' } } },
      { ...base, id: 'end-a', sequence: 1505, type: 'tool.completed', payload: { toolName: 'git.diff', invocationId: 'a', result: { status: 'completed', summary: 'First request completed.' } } },
      { ...base, id: 'legacy-start', sequence: 1506, type: 'tool.started', payload: { toolName: 'git.status' } },
      { ...base, id: 'legacy-end', sequence: 1507, type: 'tool.completed', payload: { toolName: 'git.status', result: { status: 'completed', summary: 'Legacy task completed.' } } },
    ];
    Object.assign((window as unknown as { auditFixture: object }).auditFixture, { customEvents, holdRun: true });
  });
  await page.getByRole('textbox', { name: 'Mensaje para OrderCode' }).fill('Comprueba el proyecto');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  const activity = page.getByRole('region', { name: 'Ejecución de tareas' });
  const toggle = activity.getByRole('button', { name: 'Mostrar actividad de tareas' });
  await expect(activity.locator('.activity-item')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Detener ejecución' })).toBeVisible();
  await expect(toggle).toContainText('En curso');
  await expect(activity.locator('.activity-item').nth(0)).toContainText('First request completed.');
  await expect(activity.locator('.activity-item').nth(1)).toContainText('Second request failed.');
  await expect(activity.locator('.activity-item').nth(1)).toContainText('Falló');
  await page.evaluate(() => {
    const fixture = (window as unknown as { auditFixture: { customEvents: unknown[]; holdRun: boolean } }).auditFixture;
    fixture.customEvents.push(
      { id: 'permission-request', sequence: 1508, sessionId: 'new-project', runId: 'activity-run', type: 'permission.requested', payload: { request: { id: 'permission-1', toolName: 'process.exec', reason: 'Execute approved command.' } } },
      { id: 'permission-resolution', sequence: 1509, sessionId: 'new-project', runId: 'activity-run', type: 'permission.resolved', payload: { requestId: 'permission-1', decision: 'once' } },
      { id: 'run-end', sequence: 1510, sessionId: 'new-project', runId: 'activity-run', type: 'run.completed', payload: {} },
    );
    fixture.holdRun = false;
  });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('Completado');
  await toggle.click();
  await expect(activity.locator('.activity-item')).toHaveCount(4);
  await expect(activity.locator('.activity-item').nth(3)).toContainText('Autorización concedida: process.exec');
  await expect(activity.locator('.activity-item').nth(3)).toContainText('Completado');
  await expect(activity.locator('.activity-item').nth(3)).not.toContainText('Pendiente de autorización');
  await expect(activity.locator('.activity-item').getByText('En curso', { exact: true })).toHaveCount(0);
  const pendingPermission = await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts');
    const current = useDesktopStore.getState();
    useDesktopStore.setState({ pendingPermission: { id: 'permission-store-test' } });
    current.addEvent({ id: 'permission-store-resolution', sessionId: current.session!.id, sequence: Math.max(...current.events.map((event) => event.sequence), 0) + 1, state: 'COMPLETED', type: 'permission.resolved', summary: 'Autorización concedida: process.exec', permissionRequestId: 'permission-store-test', permissionDecision: 'once' });
    return useDesktopStore.getState().pendingPermission;
  });
  expect(pendingPermission).toBeNull();
});

test('renders Markdown tables, lists and code safely in final and streamed answers', async ({ page, context }) => {
  await openChatProject(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const content = [
    '## Evaluación del proyecto', '', '**Resultado:** listo para continuar.', '',
    '| Criterio | Evidencia | Puntaje |', '| --- | --- | ---: |', '| Estructura | `src/App.tsx` organizado | 9/10 |', '| Velocidad | Respuesta inmediata | 10/10 |', '',
    '### Próximos pasos', '', '- [x] Revisar archivos', '- [ ] Optimizar recursos', '', '> Cambios pequeños y verificables.', '',
    '```python', 'print("Listo")', '```', '',
    '[Ver documentación](https://example.com/docs) y https://example.com/status', '',
    '[No ejecutar](javascript:alert(1))', '<script>window.markdownExecuted = true</script>', '<img src="https://tracker.example.test/pixel" onerror="alert(1)">',
    '![Imagen externa](https://tracker.example.test/plot.png)',
  ].join('\n');
  await page.evaluate(async (content) => {
    const { useDesktopStore } = await import('/src/lib/store.ts');
    useDesktopStore.setState({ messages: [{ id: 'prompt', role: 'user', content: 'Revisa el proyecto', timestamp: '12:00' }, { id: 'answer', role: 'assistant', content, timestamp: '12:01' }], runtimeState: 'COMPLETED', events: [], streamingText: '' });
  }, content);
  const answer = page.locator('.message--assistant .chat-markdown');
  await expect(answer.getByRole('heading', { name: 'Evaluación del proyecto', level: 2 })).toBeVisible();
  await expect(answer.getByRole('table').getByRole('row')).toHaveCount(3);
  await expect(answer.locator('strong')).toContainText('Resultado:');
  await expect(answer.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(answer.locator('blockquote')).toContainText('Cambios pequeños');
  await expect(answer.locator('pre code')).toHaveText('print("Listo")\n');
  await answer.getByRole('button', { name: 'Copiar código' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('print("Listo")');
  await answer.getByRole('link', { name: 'Ver documentación' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { lastOpenedUrl?: string } }).auditFixture.lastOpenedUrl)).toBe('https://example.com/docs');
  await expect(answer.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(answer.locator('script,img,iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { markdownExecuted?: boolean }).markdownExecuted)).toBeUndefined();
  await page.screenshot({ path: `${process.env.TEMP}/ordercode-chat-markdown-code.png` });
  await page.locator('.conversation-scroll').evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: `${process.env.TEMP}/ordercode-chat-markdown-dark.png` });
  await setTestTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(answer.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `${process.env.TEMP}/ordercode-chat-markdown-light-mobile.png` });
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts');
    useDesktopStore.setState({ messages: [{ id: 'stream-prompt', role: 'user', content: 'Sigue', timestamp: '12:02' }], runtimeState: 'RUNNING', streamingText: '### Escribiendo\n\n```ts\nconst value =' });
  });
  await expect(answer).toHaveAttribute('aria-busy', 'true');
  await expect(answer.getByRole('heading', { name: 'Escribiendo' })).toBeVisible();
  await expect(answer.locator('pre code')).toContainText('const value =');
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts');
    useDesktopStore.setState({ streamingText: '### Escribiendo\n\n```ts\nconst value = 1;\n```\n\n| Listo | Estado |\n| --- | --- |\n| Código | Correcto |' });
  });
  await expect(answer.getByRole('table')).toContainText('Correcto');
});

test('shows the current task and specialist while hiding payloads and isolating each run', async ({ page }) => {
  await openChatProject(page);
  await page.evaluate(() => {
    const base = { sessionId: 'new-project', runId: 'visible-run', createdAt: new Date().toISOString() };
    Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdRun: true, customEvents: [
      { ...base, id: 'old', runId: 'older-run', sequence: 1501, type: 'tool.completed', payload: { toolName: 'fs.read', result: { status: 'completed', summary: 'Do not show old execution' } } },
      { ...base, id: 'start', sequence: 1502, type: 'run.started', payload: { state: 'RUNNING' } },
      { ...base, id: 'agent', sequence: 1503, type: 'agent.started', payload: { agentRunId: 'explore-child', agentName: 'Explore', depth: 1, state: 'RUNNING' } },
      { ...base, id: 'read-start', sequence: 1504, type: 'tool.started', payload: { agentRunId: 'explore-child', toolName: 'fs.read', invocationId: 'read', input: { path: 'src/App.tsx' } } },
      { ...base, id: 'read-end', sequence: 1505, type: 'tool.completed', payload: { agentRunId: 'explore-child', toolName: 'fs.read', invocationId: 'read', result: { status: 'completed', summary: 'fs.read completed. {"content":"INTERNAL_FILE_PAYLOAD"}' } } },
      { ...base, id: 'exec', sequence: 1506, type: 'tool.started', payload: { toolName: 'process.exec', invocationId: 'exec', input: { command: 'pnpm typecheck' } } },
    ] });
  });
  await page.getByRole('textbox', { name: 'Mensaje para OrderCode' }).fill('Revisa los archivos y comprueba los tipos');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  const activity = page.getByRole('region', { name: 'Ejecución de tareas' });
  const toggle = activity.getByRole('button', { name: 'Mostrar actividad de tareas' });
  await expect(activity.locator('.activity-live')).toContainText('Ejecutando comando');
  await expect(activity.locator('.activity-live')).toContainText('pnpm typecheck');
  await expect(activity.locator('.activity-item')).toHaveCount(3);
  await expect(activity.locator('.activity-item--agent').first()).toContainText('Explore');
  await expect(activity.locator('.activity-copy').filter({ hasText: 'Leer archivo' })).toContainText('src/App.tsx');
  await expect(activity).not.toContainText('Do not show old execution');
  await expect(activity).not.toContainText('INTERNAL_FILE_PAYLOAD');
  expect(await toggle.evaluate((element) => getComputedStyle(element).display)).toBe('flex');
  await page.screenshot({ path: `${process.env.TEMP}/ordercode-chat-task-live.png` });
  await activity.getByLabel('Detalles de Leer archivo', { exact: true }).click();
  await expect(activity.locator('.activity-detail')).toContainText('INTERNAL_FILE_PAYLOAD');
  await toggle.click();
  await expect(activity.locator('.activity-item')).toHaveCount(0);
  await expect(activity.locator('.activity-live')).toContainText('Ejecutando comando');
  await page.evaluate(() => {
    const fixture = (window as unknown as { auditFixture: { customEvents: unknown[] } }).auditFixture;
    const base = { sessionId: 'new-project', runId: 'visible-run', createdAt: new Date().toISOString() };
    fixture.customEvents.push(
      { ...base, id: 'exec-end', sequence: 1507, type: 'tool.completed', payload: { toolName: 'process.exec', invocationId: 'exec', result: { status: 'completed', summary: 'Types checked.' } } },
      { ...base, id: 'agent-end', sequence: 1508, type: 'agent.completed', payload: { agentRunId: 'explore-child', agentName: 'Explore', state: 'COMPLETED' } },
      { ...base, id: 'stream', sequence: 1509, type: 'provider.chunk', payload: { chunk: '### Resultado\n\nTipos verificados.' } },
    );
  });
  await expect(activity.locator('.activity-live')).toContainText('Redactando la respuesta');
  await expect(page.getByRole('heading', { name: 'Resultado' })).toBeVisible();
  await page.evaluate(() => {
    const fixture = (window as unknown as { auditFixture: { customEvents: unknown[]; holdRun: boolean } }).auditFixture;
    fixture.customEvents.push({ id: 'done', sessionId: 'new-project', runId: 'visible-run', sequence: 1510, type: 'run.completed', payload: {} });
    fixture.holdRun = false;
  });
  await expect(toggle).toContainText('Completado');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(activity.locator('.activity-live')).toHaveCount(0);
  await toggle.click();
  await expect(activity.locator('.activity-item[data-state="COMPLETED"]')).toHaveCount(3);
});

test('bounds long task history and never marks a missing tool result as successful', async ({ page }) => {
  await openChatProject(page);
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts');
    const base = { sessionId: 'new-project', runId: 'long-run' };
    useDesktopStore.setState({ runtimeState: 'COMPLETED', messages: [{ id: 'user', role: 'user', content: 'Revisa el historial', timestamp: '12:00' }], events: [
      { ...base, id: 'orphan', sequence: 1, type: 'tool.started', toolName: 'fs.read', invocationId: 'orphan', state: 'RUNNING', summary: 'fs.read', target: 'missing.txt' },
      ...Array.from({ length: 40 }, (_, index) => ({ ...base, id: `task-${index}`, sequence: index + 2, type: 'tool.completed', toolName: 'fs.read', invocationId: `task-${index}`, state: 'COMPLETED' as const, summary: 'fs.read', target: `src/file-${index}.ts` })),
    ] });
  });
  const activity = page.getByRole('region', { name: 'Ejecución de tareas' });
  const toggle = activity.getByRole('button', { name: 'Mostrar actividad de tareas' });
  await toggle.click();
  await expect(activity.locator('.activity-item')).toHaveCount(30);
  await activity.getByRole('button', { name: 'Ver 11 tareas anteriores' }).click();
  await expect(activity.locator('.activity-item')).toHaveCount(41);
  const missing = activity.locator('.activity-item[data-state="RECOVERY_REQUIRED"]');
  await expect(missing).toContainText('missing.txt');
  await expect(missing).toContainText('Sin resultado registrado');
  await expect(missing.locator('.task-spinner')).toHaveCount(0);
  await expect(activity.locator('.activity-summary')).toContainText('40 de 41 completadas');
  await page.evaluate(async () => {
    const { useDesktopStore } = await import('/src/lib/store.ts');
    const events = useDesktopStore.getState().events.slice(0, 1);
    useDesktopStore.setState({ events, runtimeState: 'CANCELLED' });
  });
  await expect(activity.locator('.activity-item[data-state="CANCELLED"]')).toHaveCount(1);
  await expect(activity.locator('.activity-item')).not.toContainText('Completado');
});

test('selects model-specific effort and chats with a project through the composer', async ({ page }) => {
  await page.goto('/');
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await page.getByRole('option', { name: /Fast local code/ }).click();
  const mode = page.locator('.composer-dropdown--mode .dropdown-trigger');
  await mode.click(); await page.getByRole('option', { name: /^Build/ }).click();
  const permissions = page.locator('.composer-dropdown--options .dropdown-trigger');
  await permissions.click(); await page.getByRole('option', { name: /^Auto/ }).click();
  const effort = page.locator('.composer-dropdown--effort .dropdown-trigger');
  await effort.click();
  await expect(page.getByRole('option', { name: 'Medio', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Alto', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mensaje para OrderCode' }).fill('Hola');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByText('Persisted final answer', { exact: true })).toBeVisible();
  const requests = await page.evaluate(() => (window as unknown as { auditFixture: { requests: Array<{ method: string; params: Record<string, unknown> }> } }).auditFixture.requests);
  expect(requests.find((request) => request.method === 'session.create')!.params).toMatchObject({ mode: 'build', permissionProfile: 'auto', reasoningEffort: 'high' });
  expect(requests.find((request) => request.method === 'run')!.params).toMatchObject({ goal: 'Hola', mode: 'build', permissionProfile: 'auto', reasoningEffort: 'high' });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await effort.click(); await page.getByRole('option', { name: /^Automático/ }).click();
  await expect.poll(() => page.evaluate(() => {
    const requests = (window as unknown as { auditFixture: { requests: Array<{ method: string; params: { patch?: Record<string, unknown> } }> } }).auditFixture.requests;
    return requests.filter((request) => request.method === 'session.update').at(-1)?.params.patch?.reasoningEffort;
  })).toBeNull();
  for (const name of ['Auto', 'Plan', 'Build']) {
    await mode.click(); await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
    await expect.poll(() => page.evaluate(() => {
      const requests = (window as unknown as { auditFixture: { requests: Array<{ method: string; params: { patch?: Record<string, unknown> } }> } }).auditFixture.requests;
      return requests.filter((request) => request.method === 'session.update').at(-1)?.params.patch?.mode;
    })).toBe(name.toLowerCase());
  }
  for (const name of ['Lectura', 'Guiado', 'Auto', 'Avanzado']) {
    await permissions.click(); await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
    await expect.poll(() => page.evaluate(() => {
      const requests = (window as unknown as { auditFixture: { requests: Array<{ method: string; params: { patch?: Record<string, unknown> } }> } }).auditFixture.requests;
      return requests.filter((request) => request.method === 'session.update').at(-1)?.params.patch?.permissionProfile;
    })).toBe(({ Lectura: 'reading', Guiado: 'guided', Auto: 'auto', Avanzado: 'advanced' } as const)[name as 'Lectura' | 'Guiado' | 'Auto' | 'Avanzado']);
  }
});

test('recovers from a code graph error, inspects relationships and opens the real file', async ({ page }) => {
  await page.goto('/');
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await page.getByRole('option', { name: /Fast local code/ }).click();
  await page.getByRole('textbox', { name: 'Mensaje para OrderCode' }).fill('Hola');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByText('Persisted final answer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await page.getByRole('button', { name: 'Herramientas avanzadas', exact: true }).click();
  await page.getByRole('button', { name: 'Mapa del código', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Buscar símbolos' })).toBeEnabled();
  await page.getByRole('button', { name: 'Mapa', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo cargar el grafo');
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await expect(page.getByText('Indexando archivos y preparando relaciones…')).toHaveCount(0);

  await page.evaluate(() => { (window as unknown as { auditFixture: { graphFailure: boolean } }).auditFixture.graphFailure = false; });
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.locator('.code-graph-panel')).toBeVisible();
  await expect(page.locator('.code-graph-footer')).toContainText('2 relaciones');
  await expect(page.locator('.code-graph-canvas')).toBeVisible();
  await page.locator('[data-graph-node][aria-label^="Archivo main.ts"]').click();
  await expect(page.getByRole('complementary', { name: 'Detalles del nodo' })).toContainText('src/main.ts');
  await page.getByRole('button', { name: 'Abrir en el editor' }).click();
  await expect(page.locator('.editor-toolbar code')).toHaveText('src/main.ts');
  expect(await page.evaluate(() => (window as unknown as { auditFixture: { lastFileRead: string } }).auditFixture.lastFileRead)).toBe('src/main.ts');
});

test('cancelling folder selection preserves the draft without a failed conversation', async ({ page }) => {
  await page.goto('/');
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await page.getByRole('option', { name: /Fast local code/ }).click();
  await page.evaluate(() => { (window as unknown as { auditFixture: { folderResult: string | null } }).auditFixture.folderResult = null; });
  const draft = page.getByRole('textbox', { name: 'Mensaje para OrderCode' });
  await draft.fill('Conserva mi mensaje'); await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(draft).toHaveValue('Conserva mi mensaje');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { auditFixture: { runRequests: number } }).auditFixture.runRequests)).toBe(0);
});

test('creates a project session without optional limits, updates it and sends a message', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const ipcPath = '/src/lib/ipc.ts';
    const { createSession, updateSession, sendSessionMessage } = await import(ipcPath);
    const session = await createSession({ projectPath: 'C:/fixtures/new-project', mode: 'Build', permission: 'Guiado', model: 'ollama::local-code', freeOnly: false });
    await updateSession({ ...session, budget: undefined, reasoningEffort: 'high' });
    const sent = await sendSessionMessage(session.id, 'Hola', session.mode, session.model, session.permission, session.providerId, undefined, false, 'high');
    const fixture = (window as unknown as { auditFixture: { requests: Array<{ method: string; params: Record<string, unknown> }> } }).auditFixture;
    const created = fixture.requests.find((request) => request.method === 'session.create')!.params;
    const updated = fixture.requests.find((request) => request.method === 'session.update')!.params.patch as Record<string, unknown>;
    const run = fixture.requests.find((request) => request.method === 'run')!.params;
    return { created, updated, run, state: sent.state, detail: sent.detail };
  });
  expect(result.created).toMatchObject({ projectPath: 'C:/fixtures/new-project', freeOnly: false, providerId: 'ollama', modelId: 'local-code' });
  expect(Object.hasOwn(result.created, 'budget')).toBe(false);
  expect(Object.hasOwn(result.updated, 'budget')).toBe(false);
  expect(result.updated.reasoningEffort).toBe('high');
  expect(result.run).toMatchObject({ sessionId: 'new-project', goal: 'Hola', reasoningEffort: 'high', freeOnly: false });
  expect(result.state).toBe('COMPLETED');
  expect(result.detail).toBe('Persisted final answer');
});

test('normalizes nested optional values and preserves JSON validation before transport', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const ipcPath = '/src/lib/ipc.ts';
    const { saveCustomAgent } = await import(ipcPath);
    const base = { name: 'Example', description: '', instructions: 'Help', toolAllowlist: [] as string[], enabled: false };
    await saveCustomAgent({ ...base, id: undefined, metadata: { absent: undefined, empty: null, zero: 0, disabled: false, nested: [{ absent: undefined, value: 'kept' }] } });
    const fixture = (window as unknown as { auditFixture: { requests: Array<{ method: string; params: Record<string, unknown> }> } }).auditFixture;
    const profile = fixture.requests.find((request) => request.method === 'agents.save')!.params.profile;
    const before = fixture.requests.length;
    let invalidNumberRejected = false;
    let invalidArrayRejected = false;
    try { await saveCustomAgent({ ...base, metadata: { value: Number.NaN } }); } catch { invalidNumberRejected = true; }
    try { await saveCustomAgent({ ...base, metadata: { value: [undefined] } }); } catch { invalidArrayRejected = true; }
    return { profile, invalidNumberRejected, invalidArrayRejected, noInvalidRequests: fixture.requests.length === before };
  });
  expect(result.profile).toMatchObject({ enabled: false, metadata: { empty: null, zero: 0, disabled: false, nested: [{ value: 'kept' }] } });
  expect(Object.hasOwn(result.profile as object, 'id')).toBe(false);
  expect(result.invalidNumberRejected).toBe(true);
  expect(result.invalidArrayRejected).toBe(true);
  expect(result.noInvalidRequests).toBe(true);
});

test('retries catalogs after native startup and shows fast providers before slow discovery completes', async ({ page }) => {
  await page.goto('/');
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await expect(page.getByRole('option', { name: /Fast local code/ })).toBeVisible();
  const discovery = await page.evaluate(() => (window as unknown as { auditFixture: { modelRequests: number; slowResolved: boolean } }).auditFixture);
  expect(discovery.modelRequests).toBeGreaterThan(1);
  expect(discovery.slowResolved).toBe(false);
});

test('loads recent history and follows execution with one poll at a time and native cursors', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const ipcPath = '/src/lib/ipc.ts'; const followPath = performance.getEntriesByType('resource').map((entry) => entry.name).find((url) => new URL(url).pathname === '/src/lib/sessionExecution.ts') ?? '/src/lib/sessionExecution.ts';
    const followSource = await fetch(followPath).then((response) => response.text());
    const storePath = followSource.match(/from [\"']([^\"']*\/store\.ts[^\"']*)[\"']/)?.[1] ?? '/src/lib/store.ts';
    const { loadSession, sendSessionMessage } = await import(ipcPath);
    const { useDesktopStore } = await import(storePath);
    const { followSessionOperation } = await import(followPath);
    const saved = await loadSession('a');
    useDesktopStore.getState().set('session', saved.session);
    const event = await followSessionOperation('a', () => sendSessionMessage('a', 'hello', 'Build', 'ollama::local-code', 'Guiado'));
    const state = useDesktopStore.getState();
    const fixture = (window as unknown as { auditFixture: { maxPolls: number; cursors: number[] } }).auditFixture;
    return { sequence: event.sequence, streaming: state.streamingText, message: state.messages[0]?.content, maxPolls: fixture.maxPolls, cursors: fixture.cursors };
  });
  expect(result.sequence).toBe(0);
  expect(result.cursors[0]).toBe(1000);
  expect(result.cursors.every((cursor) => cursor < 10000)).toBe(true);
  expect(result.maxPolls).toBe(1);
  expect(result.streaming).toBe('');
  expect(result.message).toBe('Persisted final answer');
});

test('ignores a completed operation after switching to another session', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const ipcPath = '/src/lib/ipc.ts'; const followPath = performance.getEntriesByType('resource').map((entry) => entry.name).find((url) => new URL(url).pathname === '/src/lib/sessionExecution.ts') ?? '/src/lib/sessionExecution.ts';
    const followSource = await fetch(followPath).then((response) => response.text());
    const storePath = followSource.match(/from [\"']([^\"']*\/store\.ts[^\"']*)[\"']/)?.[1] ?? '/src/lib/store.ts';
    const { loadSession, sendSessionMessage } = await import(ipcPath);
    const { useDesktopStore } = await import(storePath);
    const { followSessionOperation } = await import(followPath);
    const saved = await loadSession('a');
    useDesktopStore.getState().set('session', saved.session);
    const running = followSessionOperation('a', () => sendSessionMessage('a', 'hello', 'Build', 'ollama::local-code', 'Guiado'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    useDesktopStore.getState().set('session', { ...saved.session, id: 'b' });
    useDesktopStore.setState({ messages: [{ id: 'b', role: 'user', content: 'Session B', timestamp: 'now' }], streamingText: 'B stream', events: [] });
    await running;
    const state = useDesktopStore.getState();
    return { id: state.session.id, message: state.messages[0].content, streaming: state.streamingText, events: state.events.length };
  });
  expect(result).toEqual({ id: 'b', message: 'Session B', streaming: 'B stream', events: 0 });
});

test('resumes live event tracking when opening a session that is already executing', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const followPath = performance.getEntriesByType('resource').map((entry) => entry.name).find((url) => new URL(url).pathname === '/src/lib/sessionExecution.ts') ?? '/src/lib/sessionExecution.ts';
    const followSource = await fetch(followPath).then((response) => response.text());
    const storePath = followSource.match(/from ["']([^"']*\/store\.ts[^"']*)["']/)?.[1] ?? '/src/lib/store.ts';
    const { useDesktopStore } = await import(storePath);
    const ipcPath = '/src/lib/ipc.ts'; const { loadSession } = await import(ipcPath);
    const saved = await loadSession('restored');
    (window as unknown as { auditFixture: { completeEvents: boolean } }).auditFixture.completeEvents = true;
    useDesktopStore.getState().set('session', saved.session);
    useDesktopStore.getState().set('runtimeState', 'RUNNING');
  });
  await expect(page.getByText('Persisted final answer', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Detener ejecución' })).toHaveCount(0);
});


test('starts a new conversation in the same project and preserves previous history', async ({ page }) => {
  await page.goto('/');
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await page.getByRole('option', { name: /Fast local code/ }).click();
  await page.getByRole('textbox', { name: 'Mensaje para OrderCode' }).fill('Hola');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByText('Persisted final answer', { exact: true })).toBeVisible();
  await page.evaluate(() => { Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdCreate: true }); });
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  await expect(page.locator('.app-body')).toHaveAttribute('inert');
  await expect(page.getByRole('status').filter({ hasText: /^Creando conversación…$/ })).toBeVisible();
  await page.evaluate(() => { Object.assign((window as unknown as { auditFixture: object }).auditFixture, { holdCreate: false }); });
  await expect(page.getByText('Persisted final answer', { exact: true })).toHaveCount(0);
  await expect(page.getByText('¿Qué quieres crear?', { exact: true })).toBeVisible();
  const result = await page.evaluate(async () => { const path = '/src/lib/store.ts'; const { useDesktopStore } = await import(path); const state = useDesktopStore.getState(); return { session: state.session, sessions: state.sessions, model: state.model, mode: state.mode, permission: state.permission }; });
  expect(result.sessions).toHaveLength(2);
  expect(result.session.id).toBe('new-project-2');
  expect(result.session.projectPath).toBe('C:/fixtures/new-project');
  expect(result.model).toBe('ollama::local-code');
  expect(result.mode).toBe('Auto'); expect(result.permission).toBe('Guiado');
});

test('agent editor filters capabilities, preserves selections, and saves the complete profile', async ({ page }, testInfo) => {
  await openChatProject(page);
  await page.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await page.getByRole('button', { name: 'Agentes', exact: true }).click();
  await page.getByRole('button', { name: 'Crear agente', exact: true }).click();
  const editor = page.locator('.agent-editor');
  await expect(editor).toBeVisible();
  await expect(page.locator('.agent-grid')).toHaveCount(0);
  await editor.getByRole('button', { name: /^Desarrollo/ }).click();
  await editor.getByLabel(/^Nombre/).fill('Frontend cuidadoso');
  await editor.getByLabel('Cuándo usarlo', { exact: false }).fill('Cuando hay que mejorar una interfaz.');
  await editor.locator('.agent-wizard-steps button').filter({ hasText: 'Capacidades' }).click();
  const publishing = editor.locator('.agent-tool-choice').filter({ hasText: 'git.push' }).getByRole('checkbox');
  await expect(publishing).not.toBeChecked();
  await editor.getByRole('textbox', { name: 'Buscar herramientas' }).fill('archivos');
  await expect(editor.locator('.agent-tool-choice')).toHaveCount(2);
  await editor.locator('.agent-tool-choice').filter({ hasText: 'fs.write' }).getByRole('checkbox').uncheck();
  await editor.getByRole('button', { name: 'Limpiar búsqueda de herramientas' }).click();
  await expect(editor.locator('.agent-tool-choice').filter({ hasText: 'code.search' }).getByRole('checkbox')).toBeChecked();
  await expect(editor.locator('.agent-tool-choice').filter({ hasText: 'fs.write' }).getByRole('checkbox')).not.toBeChecked();
  await editor.getByRole('button', { name: 'Solo lectura', exact: true }).click();
  await editor.getByRole('button', { name: /^Seleccionadas/ }).click();
  await expect(editor.locator('.agent-tool-choice')).toHaveCount(3);
  await editor.getByRole('button', { name: /^Seleccionadas/ }).click();
  await editor.getByRole('textbox', { name: 'Buscar herramientas' }).fill('inexistente');
  await expect(editor.getByText('No hay herramientas que coincidan con los filtros.')).toBeVisible();
  await editor.getByRole('button', { name: 'Limpiar búsqueda de herramientas' }).click();
  await editor.locator('.agent-editor-content').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({ path: testInfo.outputPath('agent-capabilities-dark.png') });
  await editor.locator('.agent-wizard-steps button').filter({ hasText: 'Colaboración' }).click();
  await editor.getByRole('switch', { name: /^Puede delegar tareas/ }).check();
  await editor.getByLabel(/^Explore/).check();
  await editor.locator('.agent-wizard-steps button').filter({ hasText: 'Revisar' }).click();
  await editor.getByRole('button', { name: 'Probar ahora' }).click();
  await expect(editor.getByText('Hallazgos verificados en la prueba controlada.')).toBeVisible();
  await editor.getByRole('button', { name: 'Editar objetivo', exact: true }).click();
  await editor.getByLabel(/^Nombre/).fill('Frontend verificado');
  await editor.locator('.agent-wizard-steps button').filter({ hasText: 'Revisar' }).click();
  await expect(editor.locator('.agent-test-result')).toHaveCount(0);
  await editor.locator('.agent-editor-content').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({ path: testInfo.outputPath('agent-review-dark.png') });
  await setTestTheme(page, 'light');
  await page.setViewportSize({ width: 480, height: 720 });
  await expect(editor.getByRole('button', { name: 'Guardar y activar' })).toBeInViewport({ ratio: 1 });
  expect(await editor.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await editor.locator('.agent-editor-content').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({ path: testInfo.outputPath('agent-review-light-compact.png') });
  await page.evaluate(async () => {
    const path = '/src/lib/store.ts';
    (await import(path)).useDesktopStore.getState().set('language', 'en');
  });
  await expect(editor.getByRole('heading', { name: 'Review and save' })).toBeVisible();
  await editor.getByRole('button', { name: 'Save and activate' }).click();
  await expect(page.locator('.agent-editor')).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const fixture = (window as unknown as { auditFixture: { requests: Array<{ method: string; params: Record<string, unknown> }> } }).auditFixture;
    const path = '/src/lib/store.ts';
    return { profile: fixture.requests.findLast((request) => request.method === 'agents.save')!.params.profile, selected: (await import(path)).useDesktopStore.getState().agentId };
  });
  expect(saved.profile).toMatchObject({ name: 'Frontend verificado', enabled: true, canDelegate: true, delegateAllowlist: ['explore'], toolAllowlist: ['fs.read', 'code.search', 'mcp.docs.search'], skillAllowlist: ['style-guide'] });
  expect(saved.selected).toBe('custom-1');
});

test('agent editor protects edits, preserves active status, and recovers from a save error', async ({ page }) => {
  await openChatProject(page);
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, {
    customAgents: [{ id: 'custom-active', name: 'Activo', description: 'Revisa interfaces', instructions: 'Conserva estas instrucciones.', toolAllowlist: ['fs.read'], skillAllowlist: [], templateId: 'review', outcome: 'Hallazgos', autoAssign: false, canDelegate: false, delegateAllowlist: [], delegationDepth: 0, enabled: true }],
    failAgentSave: true,
  }));
  await page.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await page.getByRole('button', { name: 'Agentes', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Activo', exact: true }).click();
  const editor = page.locator('.agent-editor');
  await editor.getByLabel(/^Instrucciones/).fill('Instrucciones que no deben perderse.');
  await editor.getByRole('button', { name: 'Volver a agentes' }).click();
  await expect(editor.getByText('Hay cambios sin guardar')).toBeVisible();
  await editor.getByRole('button', { name: 'Seguir editando' }).click();
  await editor.locator('.agent-template-picker > summary').click();
  await editor.getByRole('button', { name: /^Desarrollo/ }).click();
  await expect(editor.getByText('¿Aplicar esta plantilla?')).toBeVisible();
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(editor.getByLabel(/^Instrucciones/)).toHaveValue('Instrucciones que no deben perderse.');
  await editor.locator('.agent-wizard-steps button').filter({ hasText: 'Revisar' }).click();
  await expect(editor.getByRole('button', { name: 'Guardar borrador' })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(editor.getByRole('alert')).toHaveText('Controlled agent save failure');
  await expect(editor.getByRole('button', { name: 'Guardar cambios', exact: true })).toBeEnabled();
  await page.evaluate(() => Object.assign((window as unknown as { auditFixture: object }).auditFixture, { failAgentSave: false }));
  await editor.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.locator('.agent-editor')).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const fixture = (window as unknown as { auditFixture: { customAgents: Array<Record<string, unknown>> } }).auditFixture;
    const path = '/src/lib/store.ts';
    return { profile: fixture.customAgents[0], selected: (await import(path)).useDesktopStore.getState().agentId };
  });
  expect(saved.profile).toMatchObject({ id: 'custom-active', enabled: true, instructions: 'Instrucciones que no deben perderse.' });
  expect(saved.selected).toBe('general');
  await page.locator('.agent-card-select').filter({ hasText: 'Activo' }).click();
  await page.getByRole('button', { name: 'Editar Activo', exact: true }).click();
  await editor.locator('.agent-wizard-steps button').filter({ hasText: 'Revisar' }).click();
  await editor.getByRole('button', { name: 'Guardar y desactivar', exact: true }).click();
  await expect(page.locator('.agent-editor')).toHaveCount(0);
  await expect(page.locator('.agent-card-select').filter({ hasText: 'Activo' })).toBeDisabled();
  expect(await page.evaluate(async () => { const path = '/src/lib/store.ts'; return (await import(path)).useDesktopStore.getState().agentId; })).toBe('general');
  await page.getByRole('button', { name: 'Crear agente', exact: true }).click();
  await page.getByRole('region', { name: 'Editor de agente' }).getByLabel(/^Nombre/).fill('Descartar este borrador');
  await page.getByRole('button', { name: 'Volver a agentes' }).click();
  await page.getByRole('button', { name: 'Descartar cambios' }).click();
  await expect(page.locator('.agent-editor')).toHaveCount(0);
});


async function seedModelCatalog(page: Page) {
  await page.goto('/');
  await expect(page.locator('.composer-dropdown--model .dropdown-trigger')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { auditFixture: { ready: boolean } }).auditFixture.ready)).toBe(true);
  await page.evaluate(() => {
    const free = { available: true, providerId: 'openrouter', priceKind: 'free', capabilities: ['chat', 'streaming', 'tool-calling'], pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 }, contextWindowTokens: 128000 };
    Object.assign((window as unknown as { auditFixture: object }).auditFixture, {
      providers: [{ id: 'openrouter', label: 'OpenRouter', configured: true }, { id: 'anthropic', label: 'Anthropic', configured: true }],
      providerModels: {
        openrouter: [
          { ...free, id: 'openrouter/free', label: 'Free Models Router', catalogRank: 999 },
          { ...free, id: 'nvidia/nemotron-ultra:free', label: 'NVIDIA: Nemotron Ultra (free)', catalogRank: 1, reasoningEfforts: ['low', 'high'] },
          { ...free, id: 'google/gemma-code:free', label: 'Google: Gemma Code (free)', catalogRank: 2 },
          { ...free, id: 'deepseek/code:free', label: 'DeepSeek: Code (free)', catalogRank: 3 },
          { ...free, id: 'cohere/command:free', label: 'Cohere: Command (free)', catalogRank: 4 },
          ...Array.from({ length: 65 }, (_, index) => ({ ...free, id: 'qwen/code-' + index + ':free', label: 'Qwen: Code ' + index + ' (free)', catalogRank: index + 5 })),
        ],
        anthropic: [{ id: 'claude-code', providerId: 'anthropic', label: 'Claude Code', available: true, priceKind: 'paid', capabilities: ['chat', 'tool-calling'], pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 }, reasoningEfforts: ['low', 'medium', 'high'] }],
      },
    });
    window.dispatchEvent(new Event('ordercode:providers-updated'));
  });
}

test('organizes OpenRouter into a short starter list, creator groups, search, and persistent favorites', async ({ page }) => {
  await seedModelCatalog(page);
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  const menu = page.locator('.model-picker-menu');
  await expect(menu.getByRole('option', { name: /Free Models Router/ })).toBeVisible();
  await expect.poll(async () => Math.round((await menu.boundingBox())!.x - (await page.locator('.composer-dropdown--model .dropdown-trigger').boundingBox())!.x)).toBe(0);
  await expect(menu.getByRole('group', { name: 'OpenRouter', exact: true }).getByRole('option')).toHaveCount(6);
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option').first()).toContainText('Free Models Router');
  await menu.getByRole('textbox', { name: 'Buscar modelos' }).fill('nvidia ultra');
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option')).toHaveCount(1);
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option')).toContainText('Nemotron Ultra');
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option')).not.toContainText('(free)');
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option')).toContainText('Razonamiento');
  await menu.getByRole('button', { name: 'Añadir a favoritos: NVIDIA: Nemotron Ultra (free)', exact: true }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Borrar búsqueda', exact: true }).click();
  await menu.getByRole('button', { name: /^Favoritos/ }).click();
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option')).toHaveCount(1);
  await menu.getByRole('option', { name: /Nemotron Ultra/ }).click();
  await expect(menu).not.toBeVisible();
  await expect(page.locator('.composer-dropdown--model .dropdown-trigger')).toContainText('Nemotron Ultra');
  await page.locator('.composer-dropdown--effort .dropdown-trigger').click();
  await expect(page.getByRole('option', { name: 'Medio', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Alto', exact: true }).click();
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await menu.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await menu.getByRole('combobox', { name: 'Filtrar por proveedor' }).selectOption('openrouter');
  await expect(menu.getByRole('group', { name: 'OpenRouter / NVIDIA', exact: true })).toBeVisible();
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option')).toHaveCount(40);
  await menu.locator('.model-picker-body').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(menu.getByRole('textbox', { name: 'Buscar modelos' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Gestionar modelos' })).toBeVisible();
  await menu.getByRole('button', { name: 'Mostrar más modelos' }).click();
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option')).toHaveCount(70);
  await menu.getByRole('textbox', { name: 'Buscar modelos' }).fill('gemma');
  await menu.getByRole('option', { name: /Gemma Code/ }).click();
  await expect(page.locator('.composer-dropdown--effort')).toHaveCount(0);
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ordercode.desktop.preferences.v1')!).favoriteModels)).toContain('openrouter::nvidia/nemotron-ultra:free');
});

test('keeps free-only restrictions when exploring providers and favorite paid models', async ({ page }) => {
  await seedModelCatalog(page);
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  const menu = page.locator('.model-picker-menu');
  await menu.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await menu.getByRole('combobox', { name: 'Filtrar por proveedor' }).selectOption('anthropic');
  await menu.getByRole('combobox', { name: 'Filtrar por proveedor' }).press('ArrowUp');
  await expect(menu.getByRole('combobox', { name: 'Filtrar por proveedor' })).toHaveValue('openrouter');
  await menu.getByRole('combobox', { name: 'Filtrar por proveedor' }).press('ArrowDown');
  await expect(menu.getByRole('combobox', { name: 'Filtrar por proveedor' })).toHaveValue('anthropic');
  await menu.getByRole('button', { name: 'Añadir a favoritos: Claude Code', exact: true }).click();
  await menu.getByRole('button', { name: 'Solo gratuitos', exact: true }).click();
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option')).toHaveCount(0);
  await menu.getByRole('button', { name: /^Favoritos/ }).click();
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option')).toHaveCount(0);
  await menu.getByRole('combobox', { name: 'Filtrar por proveedor' }).selectOption('openrouter');
  await menu.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option').first()).toContainText('Free Models Router');
  await expect.poll(() => page.evaluate(async () => { const path = '/src/lib/store.ts'; return (await import(path)).useDesktopStore.getState().freeOnly; })).toBe(true);
  await menu.getByRole('textbox', { name: 'Buscar modelos' }).press('ArrowDown');
  await expect(menu.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.composer-dropdown--model .dropdown-trigger')).toBeFocused();
});

test('manages individual OpenRouter favorites in Settings without changing the active conversation model', async ({ page }) => {
  await seedModelCatalog(page);
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await page.getByRole('option', { name: /Free Models Router/ }).click();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Modelos', exact: true }).click();
  const library = page.locator('.model-library');
  await library.locator(':scope > summary').click();
  await expect(library.getByRole('combobox', { name: 'Catálogo del proveedor' })).toHaveValue('openrouter');
  await library.getByRole('textbox', { name: 'Buscar en el catálogo' }).fill('nvidia ultra');
  await expect(library.locator('.model-choice')).toHaveCount(1);
  await library.getByRole('button', { name: 'Añadir a favoritos: NVIDIA: Nemotron Ultra (free)', exact: true }).click();
  await expect(library.getByRole('button', { name: 'Quitar de favoritos: NVIDIA: Nemotron Ultra (free)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(async () => { const path = '/src/lib/store.ts'; return (await import(path)).useDesktopStore.getState().model; })).toBe('openrouter::openrouter/free');
  await library.getByRole('combobox', { name: 'Catálogo del proveedor' }).selectOption('anthropic');
  await library.getByRole('button', { name: 'Ver gratuitos' }).click();
  await expect(library.locator('.model-choice')).toHaveCount(0);
});


test('fits the model picker on narrow light screens and translates model details to English', async ({ page }) => {
  await seedModelCatalog(page);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.evaluate(async () => { const path = '/src/lib/store.ts'; const { useDesktopStore } = await import(path); const state = useDesktopStore.getState(); state.set('language', 'en'); state.set('themePreference', 'light'); state.set('reducedMotion', true); });
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  const menu = page.locator('.model-picker-menu');
  await expect(menu.locator('.model-picker-title strong')).toHaveText('Choose model');
  await expect(menu.getByRole('button', { name: 'Recommended', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Manage models' })).toBeVisible();
  await expect(menu.getByRole('option', { name: /Nemotron Ultra/ })).toContainText('Reasoning');
  await expect(menu.getByRole('option', { name: /Nemotron Ultra/ })).toHaveAttribute('title', /per 1M tokens/);
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(12);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(378);
  expect(bounds!.y).toBeGreaterThanOrEqual(12);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(748);
  await menu.getByRole('option', { name: /Free Models Router/ }).click();
  await page.evaluate(async () => { const path = '/src/lib/store.ts'; const { useDesktopStore } = await import(path); useDesktopStore.getState().set('hiddenModelProviders', ['openrouter']); });
  await expect(page.locator('.composer-dropdown--model .dropdown-trigger')).toContainText('Free Models Router');
  await page.locator('.composer textarea').fill('Check selection availability');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
});

test('offers connection for unconfigured models while keeping restricted models unavailable', async ({ page }) => {
  await seedModelCatalog(page);
  await page.evaluate(() => {
    const fixture = (window as unknown as { auditFixture: { providers: Array<{ id: string; configured: boolean }>; providerModels: Record<string, Array<Record<string, unknown>>> } }).auditFixture;
    fixture.providers = [{ id: 'openrouter', configured: false }, { id: 'opencode_zen', configured: false }];
    fixture.providerModels.openrouter = fixture.providerModels.openrouter.map((model) => ({ ...model, available: false, availabilityReason: 'Conecta una clave gratuita de OpenRouter.' }));
    fixture.providerModels.opencode_zen = [{ id: 'restricted-free', providerId: 'opencode_zen', label: 'Restricted Free', priceKind: 'free', available: false, availabilityReason: 'Los modelos gratuitos de OpenCode solo pueden usarse en su aplicación. Elige otro proveedor o un modelo local.' }];
    window.dispatchEvent(new Event('ordercode:providers-updated'));
  });
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  const menu = page.locator('.model-picker-menu');
  await expect(menu.getByRole('option', { name: /Free Models Router/ })).toContainText('Conecta una clave');
  await menu.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await menu.getByRole('combobox', { name: 'Filtrar por proveedor' }).selectOption('opencode_zen');
  await expect(menu.getByRole('option', { name: /Restricted Free/ })).toBeDisabled();
  await menu.getByRole('combobox', { name: 'Filtrar por proveedor' }).selectOption('openrouter');
  await menu.getByRole('option', { name: /Free Models Router/ }).click();
  await expect(page.getByRole('heading', { name: 'Modelos', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { auditFixture: { runRequests: number } }).auditFixture.runRequests)).toBe(0);
});


test('keeps the redesigned control bar readable, responsive, and fully operable', async ({ page }) => {
  await seedModelCatalog(page);
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await page.getByRole('option', { name: /Nemotron Ultra/ }).click();
  await page.locator('.composer-dropdown--effort .dropdown-trigger').click();
  await page.getByRole('option', { name: 'Alto', exact: true }).click();
  await page.locator('.composer-dropdown--options .dropdown-trigger').click();
  await page.getByRole('option', { name: /^Auto/ }).click();
  await expect(page.locator('.composer-dropdown--options .dropdown-trigger')).toContainText('Permisos');
  await expect(page.locator('.composer-dropdown--effort .dropdown-trigger')).toContainText('Esfuerzo');
  const toggle = page.getByRole('button', { name: 'Activar modo continuo', exact: true });
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Desactivar modo continuo', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const width of [1280, 760, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const bar = page.locator('.composer-toolbar');
    await expect(bar).toBeVisible();
    const metrics = await bar.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, children: [...element.children].map((child) => { const c = child.getBoundingClientRect(); return { left: c.left, right: c.right, top: c.top, bottom: c.bottom }; }) };
    });
    for (const child of metrics.children) {
      expect(child.left).toBeGreaterThanOrEqual(metrics.left);
      expect(child.right).toBeLessThanOrEqual(metrics.right);
      expect(child.bottom).toBeLessThanOrEqual(metrics.bottom);
    }
    await expect(page.locator('.composer-dropdown--effort .dropdown-trigger')).toBeVisible();
    await expect(page.locator('.continuous-toggle')).toBeVisible();
  }
  await page.locator('.composer-dropdown--mode .dropdown-trigger').click();
  await page.getByRole('option', { name: /^Plan/ }).click();
  await expect(page.locator('.composer-dropdown--mode .dropdown-value')).toHaveText('Plan');
  await expect(page.locator('.composer-dropdown--effort .dropdown-value')).toHaveText('Alto');
  await page.locator('.composer-dropdown--options .dropdown-trigger').click();
  await page.getByRole('option', { name: /^Avanzado/ }).click();
  const permissionFits = await page.locator('.composer-dropdown--options .dropdown-value').evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(permissionFits).toBe(true);
  await page.locator('.composer-dropdown--options .dropdown-trigger').click();
  await page.getByRole('option', { name: /^Auto/ }).click();
  await expect(page.locator('.composer-dropdown--options .dropdown-value')).toHaveText('Auto');
});

test('reviews one Git diff at a time and preserves staging and save-version actions behind the simplified UI', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const native = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> }; auditFixture: { requests: Array<{ method: string; params: Record<string, unknown> }> } });
    const previous = native.__TAURI_INTERNALS__.invoke;
    let staged = false;
    let committed = false;
    native.__TAURI_INTERNALS__.invoke = async (command, args) => {
      const request = args.request as { method: string; params: { name: string; input: Record<string, unknown> } } | undefined;
      if (command !== 'harness_request' || request?.method !== 'tool.invoke' || !request.params.name.startsWith('git.')) return previous(command, args);
      native.auditFixture.requests.push(request);
      const { name, input } = request.params;
      if (name === 'git.stage') staged = true;
      if (name === 'git.unstage') staged = false;
      if (name === 'git.commit') { committed = true; staged = false; }
      const diff = 'diff --git a/src/App.tsx b/src/App.tsx\n+verified change';
      const stdout = name === 'git.status' ? '## main\0' + (committed ? '' : (staged ? 'M  ' : ' M ') + 'src/App.tsx\0')
        : name === 'git.diff' ? !committed && Boolean(input.staged) === staged ? diff : ''
        : name === 'git.branches' ? '* main'
        : name === 'git.remotes' ? 'origin\thttps://example.com/project.git'
        : '';
      return { result: { status: 'completed', summary: 'Controlled Git action', data: { stdout } } };
    };
  });
  await page.getByRole('button', { name: 'Abrir carpeta', exact: true }).click();
  await page.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await page.getByRole('button', { name: 'Cambios', exact: true }).click();
  await expect(page.locator('.git-file-row')).toHaveCount(1);
  await expect(page.locator('.git-status-output')).toBeHidden();
  await expect(page.getByRole('tabpanel', { name: 'Sin preparar' })).toContainText('+verified change');
  await expect(page.getByRole('button', { name: 'Guardar versión', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Preparar todos', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Sin preparar' })).toContainText('No hay cambios sin preparar.');
  await page.getByRole('tab', { name: 'Preparados', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Preparados' })).toContainText('+verified change');
  await page.getByRole('textbox', { name: 'Describe esta versión' }).fill('Mejorar interfaz');
  await page.getByRole('button', { name: 'Guardar versión', exact: true }).click();
  await expect(page.locator('.git-file-row')).toHaveCount(0);
  const actions = await page.evaluate(() => (window as unknown as { auditFixture: { requests: Array<{ method: string; params: Record<string, unknown> }> } }).auditFixture.requests.filter((r) => r.method === 'tool.invoke').map((r) => r.params));
  expect(actions.some((action) => action.name === 'git.stage' && (action.input as { all?: boolean }).all)).toBe(true);
  expect(actions.some((action) => action.name === 'git.commit' && (action.input as { message?: string }).message === 'Mejorar interfaz')).toBe(true);
  expect(actions.some((action) => action.name === 'git.push')).toBe(false);
});


test('carries an initial idea into the first project and keeps drafts separate between conversations', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Mensaje para OrderCode' });
  await composer.fill('Mi idea inicial');
  await page.getByRole('button', { name: 'Abrir carpeta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'new-project' })).toBeVisible();
  await expect(composer).toHaveValue('Mi idea inicial');
  await page.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await page.getByRole('button', { name: 'Agentes', exact: true }).click();
  await page.getByRole('button', { name: 'Volver a la conversación' }).click();
  await expect(composer).toHaveValue('Mi idea inicial');
  await page.evaluate(async () => {
    const path = '/src/lib/store.ts';
    const { useDesktopStore } = await import(path);
    const current = useDesktopStore.getState().session!;
    useDesktopStore.getState().set('session', { ...current, id: 'another-conversation' });
  });
  await expect(composer).toHaveValue('');
  await composer.fill('Otra idea');
  await page.evaluate(async () => {
    const path = '/src/lib/store.ts';
    const { useDesktopStore } = await import(path);
    const current = useDesktopStore.getState().session!;
    useDesktopStore.getState().set('session', { ...current, id: 'new-project' });
  });
  await expect(composer).toHaveValue('Mi idea inicial');
  expect(await page.evaluate(() => localStorage.getItem('ordercode.desktop.preferences.v1'))).not.toContain('Mi idea inicial');
});
