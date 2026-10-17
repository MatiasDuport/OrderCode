import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ordercode.desktop.preferences.v1', JSON.stringify({
      language: 'es', themePreference: 'dark', density: 'comfortable', reducedMotion: false,
      editorFontSize: 12, tabSize: 2, terminalFontSize: 11,
    }));
  });
});

test('shows the honest browser preview and keeps work mode and permission controls usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nueva sesión' })).toBeVisible();
  await expect(page.getByText('¿Qué quieres construir?')).toBeVisible();
  const dropdowns = page.locator('.composer-dropdown');
  await expect(dropdowns).toHaveCount(3);

  await dropdowns.nth(1).locator('.dropdown-trigger').click();
  await page.getByRole('option', { name: /Auto/ }).click();
  await expect(dropdowns.nth(1).locator('.dropdown-value')).toHaveText('Auto');

  await dropdowns.nth(2).locator('.dropdown-trigger').click();
  await page.getByRole('option', { name: /Lectura/ }).click();
  await expect(dropdowns.nth(2).locator('.dropdown-value')).toHaveText('Lectura');

  await dropdowns.nth(0).locator('.dropdown-trigger').click();
  await expect(page.locator('.dropdown-empty')).toContainText(/requiere la app de escritorio|Configura un proveedor/i);
  await expect(page.getByRole('option')).toHaveCount(0);
});

test('shows usage, savings and session event tabs without inventing browser-preview metrics', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Activity' }).click();
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
  await page.getByRole('button', { name: 'Activity' }).click();
  await expect(page.getByRole('heading', { name: 'Usage & savings' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('region', { name: 'Usage & savings filters' })).toBeVisible();
  await expect(page.getByText('Open a workspace and run a task to start collecting usage.')).toBeVisible();
});

test('does not pretend browser-preview messages ran through the Harness', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Mensaje para OrderCode').fill('Cambia un archivo y ejecuta las comprobaciones.');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByText('Selecciona un modelo descubierto y conecta un workspace antes de ejecutar.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText(/no pude completar la solicitud/i)).toBeVisible();
});

test('keeps product surfaces visible without inventing unavailable runtime state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agents' }).click();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expect(page.getByText('General', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Extensions' }).click();
  await expect(page.getByRole('heading', { name: 'Extensions' })).toBeVisible();
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

  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await page.getByRole('button', { name: 'Code Intelligence' }).click();
  await expect(page.getByRole('heading', { name: 'Code Intelligence' })).toBeVisible();
  await expect(page.getByLabel('Buscar símbolos')).toBeDisabled();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /Uso y límites/ }).click();
  await expect(page.getByText('Coste máximo (USD)')).toBeVisible();
  await page.getByRole('button', { name: 'Alternar terminal' }).click();
  await page.getByRole('button', { name: 'Processes' }).click();
  await expect(page.getByText('No hay procesos de terminal')).toBeVisible();
});
