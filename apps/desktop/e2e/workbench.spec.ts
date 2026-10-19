import { expect, test } from '@playwright/test';

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
  await expect(dropdowns).toHaveCount(4);
  const modeControl = dropdowns.filter({ has: page.locator('.dropdown-label').filter({ hasText: /^Modo$/ }) });
  const effortControl = page.locator('.composer-dropdown--effort');
  const permissionControl = page.locator('.composer-dropdown--options');

  await expect(effortControl.locator('.dropdown-value')).toHaveText('Auto');
  await expect(effortControl.locator('.dropdown-label')).toBeVisible();
  await effortControl.locator('.dropdown-trigger').click();
  await expect(page.getByText('Selecciona un modelo para ver sus niveles de esfuerzo.')).toBeVisible();
  await page.keyboard.press('Escape');

  await modeControl.locator('.dropdown-trigger').click();
  await page.getByRole('option', { name: /Auto/ }).click();
  await expect(modeControl.locator('.dropdown-value')).toHaveText('Auto');

  await permissionControl.locator('.dropdown-trigger').click();
  await page.getByRole('option', { name: /Lectura/ }).click();
  await expect(permissionControl.locator('.dropdown-value')).toHaveText('Opciones · Lectura');

  await page.locator('.composer-dropdown--model .dropdown-trigger').click();
  await expect(page.locator('.dropdown-empty')).toContainText(/requiere la app de escritorio|Configura un proveedor/i);
  await expect(page.getByRole('option')).toHaveCount(0);
});

test('shows usage, savings and session event tabs without inventing browser-preview metrics', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await page.getByRole('button', { name: 'Uso y actividad', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Uso y ahorro' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Uso y ahorro filters' })).toBeVisible();
  await expect(page.getByText('Abre un workspace y ejecuta una tarea para empezar a registrar uso.')).toBeVisible();
  await page.getByRole('tab', { name: 'Eventos de sesión' }).click();
  await expect(page.getByText('Sin eventos guardados para la sesión activa.')).toBeVisible();
  await page.getByRole('tab', { name: 'Uso y ahorro' }).click();
  await expect(page.getByRole('heading', { name: 'Uso y ahorro' })).toBeVisible();
});

test('localizes the usage dashboard when English is selected', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ordercode.desktop.preferences.v1', JSON.stringify({ language: 'en', themePreference: 'light' }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
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

test('keeps product surfaces visible without inventing unavailable runtime state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Herramientas', exact: true }).click();
  await page.getByRole('button', { name: 'Agentes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agentes' })).toBeVisible();
  await expect(page.getByText('General', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Skills y MCP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Extensiones' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Skills/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Nuevo' })).toBeDisabled();
  await expect(page.getByText('Conecta un workspace para crear, importar y administrar Skills.')).toBeVisible();
  await page.getByRole('tab', { name: /MCPs/ }).click();
  await expect(page.getByRole('tab', { name: /MCPs/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Servidores MCP', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar' })).toBeDisabled();
  await expect(page.getByText('Marketplace MCP', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: /Skills/ }).click();
  await expect(page.getByRole('tab', { name: /Skills/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible();
  await page.getByRole('button', { name: 'Grafo y código', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inteligencia de código' })).toBeVisible();
  await expect(page.getByLabel('Buscar símbolos')).toBeDisabled();

  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.locator('.settings-nav-advanced > summary').click();
  await page.getByRole('button', { name: /Uso y límites/ }).click();
  await expect(page.getByText('Coste máximo (USD)')).toBeVisible();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Processes' }).click();
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
  await expect(page.locator('.settings-nav > button')).toHaveCount(4);
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
