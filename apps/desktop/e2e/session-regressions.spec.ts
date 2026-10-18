import { expect, test } from '@playwright/test';

// Controlled native transport: regression checks, without paid calls or a user account.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ordercode.desktop.preferences.v1', JSON.stringify({ language: 'es', autoCheckUpdates: false }));
    const fixture = { ready: false, slowResolved: false, modelRequests: 0, polls: 0, maxPolls: 0, cursors: [] as number[], runRequests: 0, completeEvents: false, folderResult: 'C:/fixtures/new-project' as string | null, requests: [] as Array<{ method: string; params: Record<string, unknown> }> };
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const rawSession = (id: string) => ({ id, projectPath: `C:/fixtures/${id}`, title: id, modelId: 'local-code', providerId: 'ollama', mode: 'build', permissionProfile: 'guided', state: 'COMPLETED', createdAt: new Date().toISOString(), sequence: 1500 });
    Object.assign(window, { auditFixture: fixture, __TAURI_INTERNALS__: {
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      invoke: async (command: string, args: Record<string, unknown>) => {
        if (command === 'harness_start') { await pause(150); fixture.ready = true; return { ok: true, harnessConnected: true, version: 'fixture', platform: 'windows' }; }
        if (command === 'workspace_open') return args.projectPath;
        if (command === 'plugin:dialog|open') return fixture.folderResult;
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
        else if (method === 'session.create') result = { ...rawSession('new-project'), ...params };
        else if (method === 'session.update') result = true;
        else if (method === 'session.get') result = rawSession(String(params.sessionId));
        else if (method === 'session.messages') result = [{ id: 'answer', role: 'assistant', content: 'Persisted final answer', createdAt: new Date().toISOString() }];
        else if (method === 'session.events') {
          fixture.cursors.push(Number(params.afterSequence)); fixture.polls += 1; fixture.maxPolls = Math.max(fixture.maxPolls, fixture.polls);
          await pause(350); fixture.polls -= 1;
          result = fixture.completeEvents ? [{ id: 'complete', sessionId: params.sessionId, runId: 'run', sequence: 1502, type: 'run.completed', payload: {} }] : Number(params.afterSequence) < 1501 ? [{ id: 'chunk', sessionId: params.sessionId, runId: 'run', sequence: 1501, type: 'provider.chunk', payload: { chunk: 'A streamed chunk' } }] : [];
        } else if (method === 'permission.pending') result = [];
        else if (method === 'run') { fixture.runRequests += 1; await pause(900); result = { runId: 'run', state: 'COMPLETED', assistantMessage: { content: 'Persisted final answer' } }; }
        else result = [];
        return { result };
      },
    } });
  });
});

test('toggles Workspace from the rail, closes it explicitly and keeps chrome compact in both themes', async ({ page }) => {
  await page.addInitScript(() => { const key = 'ordercode.desktop.preferences.v1'; localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), reducedMotion: true })); });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const workspace = page.getByRole('button', { name: 'Workspace', exact: true });
  const panel = page.getByRole('complementary', { name: 'Workspace' });
  await workspace.click(); await expect(panel).toBeVisible();
  await expect(workspace).toHaveAttribute('aria-expanded', 'true');
  await workspace.click(); await expect(panel).toBeHidden();
  await workspace.click(); await page.getByRole('button', { name: 'Cerrar Workspace', exact: true }).click();
  await expect(panel).toBeHidden();
  await workspace.click(); await page.keyboard.press('Escape'); await expect(panel).toBeHidden();
  await workspace.click(); await page.getByRole('button', { name: 'Ajustes', exact: true }).click(); await expect(panel).toBeHidden();
  const chrome = page.locator('.topbar');
  expect((await chrome.boundingBox())!.height).toBe(38);
  await expect(chrome.locator('.project-selector')).toHaveCount(0);
  await expect(chrome.locator('img')).toHaveAttribute('src', /LogoSinFondo/);
  await page.getByRole('button', { name: 'Tema claro' }).click();
  await expect(chrome.locator('.brand-lockup')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await workspace.click();
  await expect(panel).toHaveCSS('width', '216px');
  if (process.env.TEMP) await page.screenshot({ path: `${process.env.TEMP}/ordercode-chrome-light.png`, animations: 'disabled' });
  await page.getByRole('button', { name: 'Tema oscuro' }).click();
  if (process.env.TEMP) await page.screenshot({ path: `${process.env.TEMP}/ordercode-chrome-dark.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 479, height: 700 });
  await expect(panel).toBeHidden();
  await workspace.click(); await expect(panel).toBeVisible();
  await page.locator('.workspace-panel-backdrop').click({ position: { x: 350, y: 150 } });
  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('selects model-specific effort and chats with a project through the composer', async ({ page }) => {
  await page.goto('/');
  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await page.getByRole('option', { name: /Fast local code/ }).click();
  const effort = page.locator('.composer-dropdown--effort .dropdown-trigger');
  await effort.click();
  await expect(page.getByRole('option', { name: 'Medio', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Alto', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mensaje para OrderCode' }).fill('Hola');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByText('Persisted final answer', { exact: true })).toBeVisible();
  const requests = await page.evaluate(() => (window as unknown as { auditFixture: { requests: Array<{ method: string; params: Record<string, unknown> }> } }).auditFixture.requests);
  expect(requests.find((request) => request.method === 'session.create')!.params.reasoningEffort).toBe('high');
  expect(requests.find((request) => request.method === 'run')!.params).toMatchObject({ goal: 'Hola', reasoningEffort: 'high' });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await effort.click(); await page.getByRole('option', { name: /^Automático/ }).click();
  await expect.poll(() => page.evaluate(() => {
    const requests = (window as unknown as { auditFixture: { requests: Array<{ method: string; params: { patch?: Record<string, unknown> } }> } }).auditFixture.requests;
    return requests.filter((request) => request.method === 'session.update').at(-1)?.params.patch?.reasoningEffort;
  })).toBeNull();
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
