import { test, expect } from '@playwright/test';
const state = {schemaVersion:1,profile:'core',account:{signedIn:false},credentials:[],customProviders:[],providers:[{id:'openai',name:'OpenAI'}],models:[]};
for (const legacy of [false,true]) {
 test(`control center ${legacy ? 'rejects old protocol without crashing' : 'opens all tabs'}`, async ({page}) => {
  const errors: string[]=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.addInitScript(({state,legacy}) => {
   (window as any).isTauri = true;
   (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
   localStorage.setItem('jouzu.ui.language','en');
   (window as any).__TAURI_INTERNALS__ = {
    metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
    transformCallback:()=>1, unregisterCallback:()=>{},
    invoke:async (command:string, args?:any) => {
     if(command==='launcher_state') return {ready:true,bash:true,recent:[],platform:'windows'};
     if(command==='component_versions') return {jouzu:'0.1.18',development:true};
     if(command==='control_request') {if(args?.request?.action==='profile')state.profile=args.request.profile;const result={...state};if(legacy)delete (result as any).customProviders;return result;}
     if(command==='environment_read') return [];
     if(command.includes('version'))return '0.1.0';
     return 1;
    }
   };
  },{state,legacy});
  await page.goto('http://localhost:1420');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  if(legacy) await expect(dialog.getByRole('alert')).toContainText('incompatible');
  else { await dialog.getByRole('button',{name:'Add provider',exact:true}).click(); await expect(dialog.getByRole('combobox',{name:'Service',exact:true})).toBeVisible(); await expect(dialog.getByRole('button',{name:'Add provider',exact:true})).toHaveCount(0); await expect(dialog.getByRole('combobox')).toHaveCount(1); await dialog.getByRole('combobox',{name:'Service',exact:true}).click(); await page.getByRole('option',{name:'Custom provider',exact:true}).click(); await expect(dialog.getByRole('textbox',{name:'API base URL'})).toBeVisible(); }
  await dialog.getByRole('tab',{name:'Environment',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Add variable',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Add variable',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Name',exact:true}).fill('TEST_TOKEN');
  await dialog.getByLabel('Value',{exact:true}).fill('fixture-secret');
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog.getByLabel('Value',{exact:true})).toHaveCount(0);
  await expect(dialog.getByText('TEST_TOKEN',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(dialog.getByLabel('Value',{exact:true})).toHaveValue('fixture-secret');
  await dialog.getByRole('tab',{name:'Language',exact:true}).click();
  await expect(dialog.getByRole('combobox',{name:'Launcher interface language'})).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveCount(1);
  const toggle=dialog.getByRole('switch',{name:'Japanese-first mode',exact:true});
  if(!legacy) {
   await expect(toggle).not.toBeChecked();
   await toggle.click(); await expect(toggle).toBeChecked();
   await toggle.click(); await expect(toggle).not.toBeChecked();
  } else await expect(toggle).toBeDisabled();
  await expect(dialog.getByText(/Changing the launcher language does not turn this off/)).toBeVisible();
  expect(errors).toEqual([]);
 });
}

const updateStub = (config: {
  jouzuVersion: string; jouzuTarget: string; jouzuNotes?: string;
  launcherVersion: string; launcherTarget?: string; launcherAvailable: boolean;
  configured: [boolean, boolean]; failInstall?: boolean;
}) => {
  const callbacks: Record<number, Function> = {};
  const listeners: Record<string, number[]> = {};
  let next = 1;
  (window as any).isTauri = true;
  (window as any).__confirms = 0;
  (window as any).__installs = 0;
  (window as any).__emit = (event: string, payload: any) => (listeners[event] ?? []).forEach(id => callbacks[id]({event, id, payload}));
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  (window as any).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    unregisterCallback: () => {},
    transformCallback: (fn: Function) => { callbacks[next] = fn; return next++; },
    invoke: async (command: string, args: any) => {
      if (command === 'plugin:event|listen') { (listeners[args.event] ??= []).push(args.handler); return next++; }
      if (command === 'plugin:event|unlisten' || command === 'plugin:event|emit') return null;
      if (command === 'launcher_state') return { ready: true, bash: true, recent: [], platform: 'windows' };
      if (command === 'component_versions') return {
        jouzu: config.jouzuVersion, launcher: config.launcherVersion, development: true,
        jouzuUpdaterConfigured: config.configured[0], launcherUpdaterConfigured: config.configured[1],
      };
      if (command === 'control_request') return { schemaVersion: 1, profile: 'core', account: { signedIn: false }, credentials: [], customProviders: [], providers: [], models: [] };
      if (command === 'environment_read') return [];
      if (command === 'git_bash' || command === 'terminal') return 1;
      if (command === 'plugin:dialog|confirm' || command === 'plugin:dialog|message') return true;
      if (command === 'jouzu_update') {
        if (args.action === 'check') return { version: config.jouzuTarget, available: true, notes: config.jouzuNotes ?? '', notesSource: 'Jouzu ' + config.jouzuTarget };
        (window as any).__installs++;
        if (config.failInstall && (window as any).__installs === 1) throw new Error('Download failed. Your current version is unchanged.');
        return new Promise(resolve => { (window as any).__finishInstall = () => resolve({ version: config.jouzuTarget, available: false }); });
      }
      if (command === 'plugin:updater|check') return config.launcherAvailable
        ? { rid: 1, currentVersion: config.launcherVersion, version: config.launcherTarget, body: 'Launcher only', date: null, rawJson: '{}' }
        : null;
      if (command.startsWith('plugin:updater|')) return { rid: 1 };
      if (command.includes('version')) return config.launcherVersion;
      return 1;
    },
  };
};

async function openSystem(page: any) {
  await page.goto('http://localhost:1420');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'System', exact: true }).click();
  return dialog;
}

test('the System section shows both update rows with their state and notes', async ({ page }) => {
  await page.addInitScript(updateStub, {
    jouzuVersion: '0.1.17', jouzuTarget: '0.1.18',
    jouzuNotes: '### Release notes\n- Git Bash is prepared during installation.\n- Startup no longer fails after an update.',
    launcherVersion: '0.1.20', launcherAvailable: false, configured: [true, true],
  });
  const dialog = await openSystem(page);
  const jouzu = dialog.locator('section[aria-label="Jouzu"]');
  await expect(jouzu.getByText('Current version 0.1.17', { exact: true })).toBeVisible();
  await expect(jouzu.getByText('Available 0.1.18', { exact: true })).toBeVisible();
  // Notes live in a bounded, scrollable area rather than a clipped box.
  const notes = jouzu.locator('div.max-h-40');
  await expect(notes).toHaveClass(/overflow-auto/);
  expect(await notes.evaluate((node: HTMLElement) => node.scrollHeight >= node.clientHeight)).toBe(true);
  const launcher = dialog.locator('section[aria-label="Launcher"]');
  await expect(launcher.getByText('Current version 0.1.20', { exact: true })).toBeVisible();
  await expect(launcher.getByText('Up to date', { exact: true })).toBeVisible();
});

test('installing a Jouzu update reports progress and needs no further confirmation', async ({ page }) => {
  await page.addInitScript(updateStub, {
    jouzuVersion: '0.1.17', jouzuTarget: '0.1.18', launcherVersion: '0.1.20', launcherAvailable: false, configured: [true, true],
  });
  const dialog = await openSystem(page);
  const jouzu = dialog.locator('section[aria-label="Jouzu"]');
  await jouzu.getByRole('button', { name: 'Update Jouzu', exact: true }).click();
  await page.evaluate(() => (window as any).__emit('jouzu-update-progress', { phase: 'downloading', downloaded: 5, total: 10 }));
  await expect(jouzu.getByText('Downloading…', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__emit('jouzu-update-progress', { phase: 'installing' }));
  await expect(jouzu.getByText('Installing…', { exact: true })).toBeVisible();
  await page.waitForFunction(() => typeof (window as any).__finishInstall === 'function');
  await page.evaluate(() => (window as any).__finishInstall());
  await expect(jouzu.getByText('Updated', { exact: true })).toBeVisible();
  await expect(jouzu.getByRole('button', { name: 'Update Jouzu', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__confirms)).toBe(0);
  expect(await page.evaluate(() => (window as any).__installs)).toBe(1);
});

test('a failed install offers Retry and the launcher update confirms once', async ({ page }) => {
  await page.addInitScript(updateStub, {
    jouzuVersion: '0.1.17', jouzuTarget: '0.1.18', launcherVersion: '0.1.20', launcherTarget: '0.1.21',
    launcherAvailable: true, configured: [true, true], failInstall: true,
  });
  const dialog = await openSystem(page);
  const jouzu = dialog.locator('section[aria-label="Jouzu"]');
  await jouzu.getByRole('button', { name: 'Update Jouzu', exact: true }).click();
  await expect(jouzu.getByRole('alert')).toContainText('Your current version is unchanged');
  // Retrying the same row installs without asking again.
  await jouzu.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => typeof (window as any).__finishInstall === 'function');
  await page.evaluate(() => (window as any).__finishInstall());
  await expect(jouzu.getByText('Updated', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__confirms)).toBe(0);
  // The launcher asks once before it restarts.
  const launcher = dialog.locator('section[aria-label="Launcher"]');
  await launcher.getByRole('button', { name: 'Update and restart', exact: true }).click();
  await expect(page.getByText('The launcher restarts after updating.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__confirms)).toBe(0);
});

test('the System section shows each component state and installs one only while it is missing', async ({page})=>{
 await page.addInitScript(()=>{
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  const environment=(git:string,root:string)=>({path:`${root}\bin\bash.exe`,git,bash:'GNU bash, version 5.2.37(1)-release'});
  const state:any={bundled:null,managed:null,system:environment('git version 2.51.0.windows.1','C:\Program Files\Git'),preferred:null,archive:true,choice:'bundled',effective:null};
  const settle=()=>{state.effective=state.choice==='system'?state.system:state.bundled;return {...state};};
  const terminal:any={bundled:null,system:null,effective:null,archive:false,version:'1.25.2733.0'};
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string,args?:any)=>{
    if(command==='launcher_state')return {ready:true,bash:false,recent:[],platform:'windows'};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='terminal')return {...terminal};
    if(command==='terminal_install'){terminal.bundled={path:'C:\Program Files\Jouzu\terminal\WindowsTerminal.exe',version:'1.25.2733.0'};terminal.effective=terminal.bundled.path;return {...terminal};}
    if(command==='git_bash')return {...state};
    if(command==='git_bash_install'){
     state.bundled=environment('git version 2.55.0.windows.5','C:\Users\test\AppData\Local\Shisa.ai\Jouzu\runtime\git\installed');
     return settle();
    }
    if(command==='git_bash_choose'){state.choice=args.provider;return settle();}
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('tab',{name:'System',exact:true}).click();
 const row=dialog.locator('section[aria-label="Git Bash"]');
 // No copy is usable yet, so the row asks for an installation and offers no source to switch to.
 await expect(row.getByText('Not installed',{exact:true})).toBeVisible();
 await expect(row.getByText(/Jouzu needs a Git Bash/)).toBeVisible();
 await expect(row.getByRole('button',{name:'Install Git Bash',exact:true})).toBeVisible();
 await expect(row.getByRole('button',{name:"Use this PC's Git Bash",exact:true})).toHaveCount(0);
 // Installing replaces the state without a reload, and a usable component offers nothing to install.
 await row.getByRole('button',{name:'Install Git Bash',exact:true}).click();
 await expect(row.getByText(/2\.55\.0\.windows\.5/)).toBeVisible();
 await expect(row.getByRole('button',{name:'Install Git Bash',exact:true})).toHaveCount(0);
 // Both copies exist now, so the row offers the other one, and switching is not an installation.
 await row.getByRole('button',{name:"Use this PC's Git Bash",exact:true}).click();
 await expect(row.getByText(/Git Bash installed on this PC/)).toBeVisible();
 await expect(row.getByRole('button',{name:'Install Git Bash',exact:true})).toHaveCount(0);
 await expect(row.getByRole('button',{name:'Use the bundled Git Bash',exact:true})).toBeVisible();
 // The terminal host follows the same rule.
 const terminalRow=dialog.locator('section[aria-label="Windows Terminal"]');
 await expect(terminalRow.getByText('Not installed',{exact:true})).toBeVisible();
 await terminalRow.getByRole('button',{name:'Install Windows Terminal',exact:true}).click();
 await expect(terminalRow.getByText(/1\.25\.2733\.0/)).toBeVisible();
 await expect(terminalRow.getByRole('button',{name:'Install Windows Terminal',exact:true})).toHaveCount(0);
});

