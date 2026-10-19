import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Controlled native transport: regression checks, without paid calls or a user account.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ordercode.desktop.preferences.v1', JSON.stringify({ language: 'es', autoCheckUpdates: false }));
    const fixture = { sessionsCreated: 0, ready: false, slowResolved: false, modelRequests: 0, polls: 0, maxPolls: 0, cursors: [] as number[], runRequests: 0, completeEvents: false, graphFailure: true, folderResult: 'C:/fixtures/new-project' as string | null, requests: [] as Array<{ method: string; params: Record<string, unknown> }> };
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
        if (command === 'workspace_read_file') {
          Object.assign(fixture, { lastFileRead: args.path });
          if (args.path === 'img/campo.jpg') return { kind: 'image', mimeType: 'image/png', dataUrl: (fixture as unknown as { imageData: string }).imageData, size: 2048 };
          if (args.path === 'graphs/curve.svg') return { kind: 'text', size: 96, content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><path d="M3 35L35 8L72 24" stroke="blue" fill="none"/></svg>' };
          if (args.path === 'graphs/report.html') return { kind: 'text', size: 120, content: '<!doctype html><html><body><strong>Gráfica estática</strong><script>document.body.append("Este script no debe ejecutarse")</script></body></html>' };
          if (args.path === 'archive.bin') return { kind: 'binary', size: 256 };
          return { kind: 'text', size: 44, content: 'export function main() { return helper(); }' };
        }
        if (command === 'plugin:dialog|open') return fixture.folderResult;
        if (command === 'plugin:event|listen') return 1;
        if (command === 'plugin:event|unlisten') return null;
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
          result = [{ id: 'ollama', configured: true }, { id: 'lmstudio', configured: true }];
        } else if (method === 'provider.models') {
          if (params.providerId === 'lmstudio') { await pause(2500); fixture.slowResolved = true; }
          result = [{ id: 'local-code', providerId: params.providerId, label: params.providerId === 'ollama' ? 'Fast local code' : 'Slow local code', available: true, priceKind: 'local', reasoningEfforts: params.providerId === 'ollama' ? ['low', 'high'] : [] }];
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
        else if (method === 'skills.list') result = [{ id: 'style-guide', name: 'Guía del proyecto', description: 'Convenciones de interfaz.', enabled: true }];
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
          result = { status: 'completed', summary: 'File opened', data: { path: input.path, content: 'export function main() { return helper(); }' } };
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
  });
});

async function setTestTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(async (value) => { const path = '/src/lib/store.ts'; const { useDesktopStore } = await import(path); useDesktopStore.getState().set('theme', value); }, theme);
}

async function openChatProject(page: Page) {
  await page.goto('/');
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await page.getByRole('option', { name: /Fast local code/ }).click();
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir proyecto' }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('new-project');
  await page.getByRole('button', { name: 'Cerrar proyecto', exact: true }).click();
}

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
  await nav.getByRole('button', { name: 'Cambios y Git', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Cambios y Git', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 500, height: 700 });
  await expect(nav.getByRole('button', { name: 'Cambios y Git', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(nav.getByRole('button', { name: 'Cambios y Git', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Web y gráficas', exact: true }).click();
  await page.getByRole('tab', { name: /Gráficas/ }).click();
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
  await page.getByRole('button', { name: 'Grafo y código', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Buscar símbolos' })).toBeEnabled();
  await page.getByRole('button', { name: 'Abrir grafo' }).click();
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
  await expect(page.getByRole('status')).toHaveText('Creando conversación…');
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
