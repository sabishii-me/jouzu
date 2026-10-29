import { test, expect } from '@playwright/test';

// The launcher's real workspace surface, with the native layer stubbed at the
// Tauri command boundary. The test covers the user path, not the runtime spawn.
test('adds a workspace through the folder picker and opens Jouzu without errors', async ({ page }) => {
 const errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

 await page.addInitScript(() => {
  localStorage.setItem('jouzu.ui.language', 'en');
  (window as any).isTauri = true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  const recent: { id: string; path: string; environment: { kind: string } }[] = [];
  let launched: string | null = null;
  (window as any).__launched = () => launched;
  (window as any).__TAURI_INTERNALS__ = {
   metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
   transformCallback: () => 1,
   unregisterCallback: () => {},
   invoke: async (command: string, args: any) => {
    if (command === 'plugin:event|listen') return 1;
    if (command === 'launcher_state') return { ready: true, bash: true, platform: 'windows', recent };
    if (command === 'component_versions') return {
     jouzu: '0.2.3', launcher: '0.2.3', development: false,
     jouzuUpdaterConfigured: false, launcherUpdaterConfigured: false,
    };
    if (command === 'control_request') return {
     schemaVersion: 1, modelReady: true, profile: 'core',
     account: { signedIn: false }, credentials: [], customProviders: [],
     providers: [{ id: 'openai', name: 'OpenAI' }], models: [],
    };
    if (command === 'environment_read') return [];
    if (command === 'plugin:dialog|open') return 'C:/Projects/Demo';
    if (command === 'add_workspaces') {
     recent.push({ id: 'w1', path: args.paths[0], environment: { kind: 'windows' } });
     return 1;
    }
    if (command === 'console_repair_needed') return false;
    if (command === 'launch_jouzu') { launched = args.path; return 1; }
    return 1;
   },
  };
 });

 await page.goto('http://localhost:1420');
 await expect(page.getByRole('heading', { name: 'Where will you work?' })).toBeVisible();

 await page.getByRole('button', { name: 'Add folder', exact: true }).click();
 await expect(page.getByText('C:/Projects/Demo', { exact: true })).toBeVisible();

 await page.getByRole('button', { name: /Open Jouzu here/ }).click();
 await expect.poll(() => page.evaluate(() => (window as any).__launched())).toBe('C:/Projects/Demo');
 await expect(page.getByText('Launch requested. Jouzu opens in a separate terminal.')).toBeVisible();
 await expect(page.getByRole('alert')).toHaveCount(0);
 expect(errors).toEqual([]);
});
