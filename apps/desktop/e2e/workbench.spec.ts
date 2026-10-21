import { expect, test, type Page } from '@playwright/test';

async function openTools(page: Page, advanced = false) {
  const tools = page.locator('[aria-controls="navigation-tools"]');
  if (await tools.getAttribute('aria-expanded') !== 'true') await tools.click();
  if (advanced) {
    const more = page.locator('[aria-controls="navigation-advanced-tools"]');
    if (await more.getAttribute('aria-expanded') !== 'true') await more.click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('ordercode.desktop.preferences.v1')) return;
    localStorage.setItem('ordercode.desktop.preferences.v1', JSON.stringify({
      language: 'es', themePreference: 'dark', density: 'comfortable', reducedMotion: false,
      editorFontSize: 12, tabSize: 2, terminalFontSize: 11,
    }));
  });
});

test('shows the honest browser preview and keeps effort, work mode and permission controls usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nueva conversación' })).toBeVisible();
  await expect(page.getByText('¿Qué quieres crear?')).toBeVisible();
  const dropdowns = page.locator('.composer-dropdown');
  await expect(dropdowns).toHaveCount(3);
  const modeControl = dropdowns.filter({ has: page.locator('.dropdown-label').filter({ hasText: /^Modo$/ }) });
  const effortControl = page.locator('.composer-dropdown--effort');
  const permissionControl = page.locator('.composer-dropdown--options');

  await expect(effortControl).toHaveCount(0);

  await modeControl.locator('.dropdown-trigger').click();
  await page.getByRole('option', { name: /Auto/ }).click();
  await expect(modeControl.locator('.dropdown-value')).toHaveText('Auto');

  await permissionControl.locator('.dropdown-trigger').click();
  await page.getByRole('option', { name: /Lectura/ }).click();
  await expect(permissionControl.locator('.dropdown-value')).toHaveText('Lectura');

  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await expect(page.locator('.model-picker-empty')).toContainText(/requiere la app de escritorio|Conecta un proveedor/i);
  await expect(page.getByRole('listbox', { name: 'Modelos disponibles' }).getByRole('option')).toHaveCount(0);
});

test('shows usage, savings and session event tabs without inventing browser-preview metrics', async ({ page }) => {
  await page.goto('/');
  await openTools(page, true);
  await page.getByRole('button', { name: 'Uso y actividad', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Uso y ahorro' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Uso y ahorro filters' })).toBeVisible();
  await expect(page.getByText('Abre un workspace y ejecuta una tarea para empezar a registrar uso.')).toBeVisible();
  await page.getByRole('tab', { name: 'Detalles de actividad' }).click();
  await expect(page.getByText('Sin eventos guardados para la sesión activa.')).toBeVisible();
  await page.getByRole('tab', { name: 'Uso y ahorro' }).click();
  await expect(page.getByRole('heading', { name: 'Uso y ahorro' })).toBeVisible();
});

test('opens preview beside chat, keeps the selected website, pauses it when closed, and fits mobile screens', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('http://localhost:4175/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><main>Web del proyecto desplegada</main></body></html>' }));
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: 'Mensaje para OrderCode' });
  await draft.fill('Conservar mientras miro mi web');
  await page.getByRole('button', { name: 'Abrir vista previa' }).click();
  await expect(page.getByRole('heading', { name: 'Nueva conversación' })).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'Vista previa' });
  await expect(panel).toBeVisible();
  const address = panel.getByRole('textbox', { name: 'Dirección web' });
  await address.fill('localhost:4175/demo');
  await panel.getByRole('button', { name: 'Abrir', exact: true }).click();
  const website = panel.locator('iframe[title="Vista previa web"]');
  await expect(page.frameLocator('#preview-context-panel iframe[title="Vista previa web"]').getByText('Web del proyecto desplegada')).toBeVisible();
  if (process.env.TEMP) await page.screenshot({ path: `${process.env.TEMP}/ordercode-chat-preview-panel.png`, animations: 'disabled' });
  await panel.getByRole('button', { name: 'Cerrar vista previa' }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('iframe[title="Vista previa web"]')).toHaveCount(0);
  await expect(draft).toHaveValue('Conservar mientras miro mi web');
  await page.getByRole('button', { name: 'Abrir vista previa' }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Dirección web' })).toHaveValue('http://localhost:4175/demo');
  await expect(website).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir vista previa', exact: true }).click();
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 390, height: 750 });
  await expect(page.getByRole('heading', { name: 'Nueva conversación' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByRole('button', { name: 'Cerrar vista previa' }).click();
  await expect(page.getByRole('heading', { name: 'Nueva conversación' })).toBeVisible();
  await expect(draft).toHaveValue('Conservar mientras miro mi web');
});

test('returns to a visible, focused chat from contextual panels on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 750 });
  await page.goto('/');
  const chat = page.getByRole('textbox', { name: 'Mensaje para OrderCode' });
  await expect(chat).toBeVisible();
  await page.keyboard.press('Control+Shift+d');
  await expect(page.locator('.review-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Conversación', exact: true }).click();
  await expect(chat).toBeVisible();
  await page.keyboard.press('Control+Shift+d');
  await expect(page.locator('.review-panel')).toBeVisible();
  await page.keyboard.press('Control+l');
  await expect(chat).toBeVisible();
  await expect(chat).toBeFocused();
  await page.getByRole('button', { name: 'Abrir vista previa', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Vista previa' })).toBeVisible();
  await page.keyboard.press('Control+l');
  await expect(chat).toBeVisible();
  await expect(chat).toBeFocused();
});

test('opens a local website in the isolated viewer and rejects unsafe web addresses', async ({ page }) => {
  await page.route('http://localhost:4175/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><main>Servidor de desarrollo visible</main></body></html>' }));
  await page.goto('/');
  await openTools(page);
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  const address = page.getByRole('textbox', { name: 'Dirección web' });
  await address.fill('localhost:4175/demo');
  await page.getByRole('button', { name: 'Abrir', exact: true }).click();
  const preview = page.locator('iframe[title="Vista previa web"]');
  await expect(preview).toHaveAttribute('src', 'http://localhost:4175/demo');
  await expect(preview).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
  await expect(page.frameLocator('iframe[title="Vista previa web"]').getByText('Servidor de desarrollo visible')).toBeVisible();
  await address.fill('http://example.com');
  await page.getByRole('button', { name: 'Abrir', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('dirección HTTPS válida');
  await expect(preview).toHaveAttribute('src', 'http://localhost:4175/demo');
});

test('localizes the usage dashboard when English is selected', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ordercode.desktop.preferences.v1', JSON.stringify({ language: 'en', themePreference: 'light' }));
  });
  await page.goto('/');
  await openTools(page, true);
  await page.getByRole('button', { name: 'Usage & activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Usage & savings' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('region', { name: 'Usage & savings filters' })).toBeVisible();
  await expect(page.getByText('Open a workspace and run a task to start collecting usage.')).toBeVisible();
});

test('does not pretend browser-preview messages ran through the Harness', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Mensaje para OrderCode').fill('Cambia un archivo y ejecuta las comprobaciones.');
  await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  await page.getByLabel('Mensaje para OrderCode').press('Enter');
  await expect(page.getByRole('alert')).toContainText('Conecta un modelo para empezar.');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText(/no pude completar la solicitud/i)).toHaveCount(0);
  await expect(page.getByLabel('Mensaje para OrderCode')).toHaveValue('Cambia un archivo y ejecuta las comprobaciones.');
});

test('chat slash commands open help and context controls without sending a model request', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Mensaje para OrderCode' });
  await composer.fill('/');
  await expect(page.getByRole('listbox', { name: 'Comandos disponibles' })).toBeVisible();
  await composer.fill('/help');
  await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeEnabled();
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByRole('region', { name: 'Comandos de chat' })).toBeVisible();
  await expect(page.getByText('/compact', { exact: true })).toBeVisible();
  await composer.fill('/context');
  await composer.press('Enter');
  await expect(page.getByRole('region', { name: 'Uso del contexto' })).toBeVisible();
  await expect(page.getByText('Abre un workspace y ejecuta una tarea para ver el contexto.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('keeps product surfaces visible without inventing unavailable runtime state', async ({ page }) => {
  await page.goto('/');
  await openTools(page);
  await page.getByRole('button', { name: 'Agentes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agentes' })).toBeVisible();
  await expect(page.getByText('General', { exact: true })).toBeVisible();

  await openTools(page, true);
  await page.getByRole('button', { name: 'Extensiones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Extensiones' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Instrucciones/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Nuevo' })).toBeDisabled();
  await expect(page.getByText('Conecta un workspace para crear, importar y administrar Skills.')).toBeVisible();
  await page.getByRole('tab', { name: /Conexiones/ }).click();
  await expect(page.getByRole('tab', { name: /Conexiones/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Servidores MCP', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar' })).toBeDisabled();
  await expect(page.getByText('Marketplace MCP', { exact: true })).toBeHidden();
  await page.getByText('Buscar nuevas conexiones', { exact: true }).click();
  await expect(page.getByText('Marketplace MCP', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: /Instrucciones/ }).click();
  await expect(page.getByRole('tab', { name: /Instrucciones/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible();
  await openTools(page, true);
  await page.getByRole('button', { name: 'Mapa del código', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mapa del código' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Elige un proyecto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir proyecto', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: /Uso y límites/ }).click();
  await expect(page.getByText('Coste máximo (USD)')).toBeVisible();
  await openTools(page);
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Procesos' }).click();
  await expect(page.getByText('No hay procesos de terminal')).toBeVisible();
});

test('persists accessible language, theme and density preferences and traps command palette focus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Idioma', { exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Conversation', exact: true })).toBeVisible();
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.getByLabel('Interface density', { exact: true }).selectOption('compact');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Control+p');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('textbox', { name: 'Search commands' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button').last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Search commands' })).toBeFocused();
});


test('guides first use and keeps advanced tools out of the main path in both themes and narrow windows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(nav.getByRole('button', { name: 'Conversación', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Proyecto', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Historial', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Agentes', exact: true })).toHaveCount(0);
  await expect(page.locator('.start-steps > li')).toHaveCount(2);
  await expect(page.locator('.composer-dropdown--mode .dropdown-value')).toHaveText('Auto');
  await expect(page.locator('.statusbar, .theme-switch')).toHaveCount(0);
  const lighting = page.locator('.ambient-lights');
  await expect(lighting).toHaveCSS('animation-name', 'ambient-balance');
  const lights = page.locator('.ambient-light');
  const initialTransforms = await lights.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).transform));
  expect(initialTransforms[0]).not.toBe(initialTransforms[1]);
  await expect.poll(() => lights.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).transform)).then((values) => values.every((value, index) => value !== initialTransforms[index]))).toBe(true);
  await page.getByRole('textbox', { name: 'Mensaje para OrderCode' }).focus();
  await expect.poll(() => page.locator('.composer-aura').evaluate((element) => getComputedStyle(element, '::before').animationPlayState)).toBe('running');
  await page.getByRole('heading', { name: 'Nueva conversación' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(lighting).toHaveCSS('animation-name', 'none');
  for (const light of await lights.all()) await expect(light).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(lighting).toHaveCSS('animation-name', 'ambient-balance');
  if (process.env.TEMP) {
    await page.screenshot({ path: process.env.TEMP + '/ordercode-aurora-dark.png', animations: 'disabled' });
    await page.setViewportSize({ width: 1586, height: 992 });
    await page.screenshot({ path: process.env.TEMP + '/ordercode-aurora-concept-match.png', animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await nav.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Agentes', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await page.getByRole('list', { name: 'Primeros pasos' }).getByRole('button', { name: 'Conectar modelo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Modelos', exact: true })).toBeVisible();
  await expect(page.locator('.settings-nav-advanced')).not.toHaveAttribute('open');
  await expect(page.locator('.settings-nav > button')).toHaveCount(5);
  expect(await page.locator('.settings-provider-summary').evaluate((element) => {
    const title = element.querySelector('strong')!.getBoundingClientRect();
    const description = element.querySelector('small')!.getBoundingClientRect();
    return title.bottom <= description.top && title.width > 100;
  })).toBe(true);
  if (process.env.TEMP) await page.screenshot({ path: process.env.TEMP + '/ordercode-aurora-settings.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByLabel('Tema', { exact: true }).selectOption('light');
  await page.getByLabel('Movimiento reducido', { exact: true }).check();
  await page.getByRole('button', { name: 'Volver a la conversación' }).click();
  await expect(lighting).toHaveCSS('animation-name', 'none');
  if (process.env.TEMP) await page.screenshot({ path: process.env.TEMP + '/ordercode-aurora-light.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav.getByRole('button', { name: 'Proyecto', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.composer-controls').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const controlsDoNotOverlap = () => page.locator('.composer').evaluate((element) => {
    const options = element.querySelector('.composer-dropdown--options')!.getBoundingClientRect();
    const send = element.querySelector('.send-button')!.getBoundingClientRect();
    return options.right <= send.left && options.bottom <= send.bottom + 1;
  });
  expect(await controlsDoNotOverlap()).toBe(true);
  if (process.env.TEMP) await page.screenshot({ path: process.env.TEMP + '/ordercode-aurora-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.composer-controls').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await controlsDoNotOverlap()).toBe(true);
  if (process.env.TEMP) await page.screenshot({ path: process.env.TEMP + '/ordercode-aurora-mobile-small.png', animations: 'disabled' });
});

test('keeps four everyday tools, reveals advanced tools on demand, and closes the terminal without losing a draft', async ({ page }) => {
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: 'Mensaje para OrderCode' });
  await draft.fill('Conserva esta idea');
  await openTools(page);
  const menu = page.locator('#navigation-tools');
  await expect(menu.locator(':scope > button:not(.tools-advanced-toggle)')).toHaveCount(4);
  await expect(page.locator('#navigation-advanced-tools')).toHaveCount(0);
  await menu.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('#terminal-dock')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar terminal', exact: true }).click();
  await expect(page.locator('#terminal-dock')).toBeHidden();
  await expect(draft).toHaveValue('Conserva esta idea');
  await openTools(page, true);
  await expect(page.locator('#navigation-advanced-tools > button')).toHaveCount(4);
  await page.getByRole('button', { name: 'Publicar proyecto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Publicar proyecto' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Proyecto' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar proyecto', exact: true }).click();
  await expect(draft).toHaveValue('Conserva esta idea');
  await page.setViewportSize({ width: 390, height: 750 });
  await openTools(page, true);
  await page.getByRole('button', { name: 'Herramientas avanzadas', exact: true }).press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Herramientas', exact: true })).toBeFocused();
  await openTools(page);
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Vista previa' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Imágenes y gráficas' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
