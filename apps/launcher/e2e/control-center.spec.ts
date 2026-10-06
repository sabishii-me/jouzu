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
  configured: [boolean, boolean]; failInstall?: boolean; launcherCheckFails?: boolean;
}) => {
  const callbacks: Record<number, Function> = {};
  const listeners: Record<string, number[]> = {};
  let next = 1;
  (window as any).isTauri = true;
  (window as any).__confirms = 0;
  (window as any).__installs = 0;
  (window as any).__logs = [];
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
      if (command === 'log_event') { (window as any).__logs.push(args.message); return null; }
      if (command === 'plugin:updater|check') {
        if (config.launcherCheckFails) throw new Error('network');
        return config.launcherAvailable
        ? { rid: 1, currentVersion: config.launcherVersion, version: config.launcherTarget, body: 'Launcher only', date: null, rawJson: '{}' }
        : null;
      }
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
  // The check's outcome reaches the log, because the interface is where that check runs.
  expect(await page.evaluate(() => (window as any).__logs)).toContain('launcher update check result=current');
});

test('a failed update check is reported and recorded', async ({ page }) => {
  await page.addInitScript(updateStub, {
    jouzuVersion: '0.1.17', jouzuTarget: '0.1.18', launcherVersion: '0.1.20',
    launcherAvailable: false, configured: [true, true], launcherCheckFails: true,
  });
  const dialog = await openSystem(page);
  const launcher = dialog.locator('section[aria-label="Launcher"]');
  await expect(launcher.getByRole('alert')).toContainText('Error: network');
  const logs: string[] = await page.evaluate(() => (window as any).__logs);
  expect(logs.some(line => line.startsWith('launcher update check failed error='))).toBe(true);
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

test('the System section names the copy in use and offers installing the ones Jouzu ships', async ({page})=>{
 await page.addInitScript(()=>{
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  const environment=(git:string,root:string)=>({path:root+'\bin\bash.exe',git,bash:'GNU bash, version 5.2.37(1)-release'});
  const state:any={bundled:null,managed:null,system:environment('git version 2.51.0.windows.1','C:\Program Files\Git'),preferred:null,archive:true,effective:null};
  const settle=()=>({...state,effective:state.bundled??state.managed??state.system});
  state.effective=settle().effective;
  const terminal:any={bundled:null,system:{path:'C:\Program Files\WindowsApps\wt.exe',version:'1.25.2733.0'},preferred:null,archive:false,version:'1.25.2733.0',effective:null};
  const settleTerminal=()=>({...terminal,effective:terminal.bundled?.path??terminal.system?.path});
  terminal.effective=settleTerminal().effective;
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string)=>{
    if(command==='launcher_state')return {ready:true,bash:false,recent:[],platform:'windows'};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='terminal')return {...terminal};
    if(command==='terminal_install'){terminal.bundled={path:'C:\Program Files\Jouzu\terminal\WindowsTerminal.exe',version:'1.25.2733.0'};return settleTerminal();}
    if(command==='git_bash')return {...state};
    if(command==='git_bash_install'){state.bundled=environment('git version 2.55.0.windows.5','C:\Users\test\AppData\Local\Shisa.ai\Jouzu\runtime\git\installed');return settle();}
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('tab',{name:'System',exact:true}).click();
 // Nothing here switches copies: the row names the one in use and offers installing the shipped one.
 await expect(dialog.getByRole('radio')).toHaveCount(0);
 const bash=dialog.locator('section[aria-label="Git Bash"]');
 await expect(bash.getByText(/Git Bash installed on this PC/)).toBeVisible();
 const installBash=bash.getByRole('button',{name:/Install and use Jouzu's Git Bash/});
 await expect(installBash).toBeVisible();
 await installBash.click();
 await expect(bash.getByText(/Jouzu's Git Bash/)).toBeVisible();
 await expect(bash.getByRole('button',{name:/Install and use Jouzu's Git Bash/})).toHaveCount(0);
 // The console host follows the same rule.
 const terminalRow=dialog.locator('section[aria-label="Windows Terminal"]');
 await expect(terminalRow.getByText(/Windows Terminal installed on this PC/)).toBeVisible();
 const installTerminal=terminalRow.getByRole('button',{name:/Install and use Jouzu's Windows Terminal/});
 await installTerminal.click();
 await expect(terminalRow.getByText(/Jouzu's Windows Terminal/)).toBeVisible();
 await expect(terminalRow.getByRole('button',{name:/Install and use Jouzu's Windows Terminal/})).toHaveCount(0);
});
test('a component row keeps its height while an action runs', async ({page})=>{
 await page.addInitScript(()=>{
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  const terminal={bundled:null,system:null,preferred:null,effective:null,archive:true,version:'1.25.2733.0',choice:'bundled'};
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string)=>{
    if(command==='launcher_state')return {ready:true,bash:false,recent:[],platform:'windows'};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='terminal')return {...terminal};
    if(command==='terminal_install')return new Promise(()=>{});
    if(command==='git_bash')return 1;
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('tab',{name:'System',exact:true}).click();
 const row=dialog.locator('section[aria-label="Windows Terminal"]');
 const before=(await row.boundingBox())!.height;
 await row.getByRole('button',{name:/Install and use Jouzu's Windows Terminal/}).click();
 await expect(row.locator('svg.animate-spin')).toBeVisible();
 await page.waitForTimeout(600);
 const during=(await row.boundingBox())!.height;
 expect(during).toBe(before);
});

test('a console this machine cannot draw is repaired before Jouzu starts', async ({page})=>{
 await page.addInitScript(()=>{
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  (window as any).__calls={installs:0, launches:0};
  const terminal={bundled:null,system:null,preferred:null,effective:null,archive:false,legacy:true,version:'1.25.2733.0'};
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string)=>{
    if(command==='console_repair_needed')return true;
    if(command==='terminal')return {...terminal};
    if(command==='terminal_install'){
     (window as any).__calls.installs++;
     return new Promise(resolve => { (window as any).__finishRepair = () => { terminal.bundled={path:'C:\Program Files\Jouzu\terminal\WindowsTerminal.exe',version:'1.25.2733.0'}; resolve({...terminal,effective:terminal.bundled.path}); }; });
    }
    if(command==='launch_jouzu'){(window as any).__calls.launches++;return null;}
    if(command==='control_request')return {schemaVersion:1,profile:'core',account:{signedIn:true},credentials:[],customProviders:[],providers:[],models:[]};
    if(command==='launcher_state')return {ready:true,bash:true,recent:[{id:'1',path:'E:\AI\ideas\jouzu',environment:{kind:'native'}}],platform:'windows'};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='git_bash')return 1;
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:/Open Jouzu here/}).click();
 // The repair is shown while it runs, and Jouzu only starts once it is done.
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByText('Installing Windows Terminal',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__calls.launches)).toBe(0);
 await page.evaluate(()=>(window as any).__finishRepair());
 await expect.poll(()=>page.evaluate(()=>(window as any).__calls.launches)).toBe(1);
 expect(await page.evaluate(()=>(window as any).__calls.installs)).toBe(1);
});

test('a component copy that is here but does not run is repaired, not installed', async ({page})=>{
 await page.addInitScript(()=>{
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  // Both components have a directory on disk and nothing in it that answers a launch.
  const git:any={bundled:null,managed:null,system:null,bundled_present:true,managed_present:false,system_present:false,archive:true,effective:null};
  const terminal:any={bundled:null,system:null,bundled_present:true,archive:false,version:'1.25.2733.0',effective:null};
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string)=>{
    if(command==='launcher_state')return {ready:true,bash:false,recent:[],platform:'windows'};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='git_bash')return {...git};
    if(command==='terminal')return {...terminal};
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('tab',{name:'System',exact:true}).click();
 const bash=dialog.locator('section[aria-label="Git Bash"]');
 await expect(bash.getByText("Jouzu's Git Bash is here but does not run",{exact:true})).toBeVisible();
 await expect(bash.getByRole('button',{name:"Repair and use Jouzu's Git Bash",exact:true})).toBeVisible();
 await expect(bash.getByRole('button',{name:/Install and use/})).toHaveCount(0);
 const terminalRow=dialog.locator('section[aria-label="Windows Terminal"]');
 await expect(terminalRow.getByText("Jouzu's Windows Terminal is here but does not run",{exact:true})).toBeVisible();
 await expect(terminalRow.getByRole('button',{name:"Repair and use Jouzu's Windows Terminal",exact:true})).toBeVisible();
 await expect(terminalRow.getByRole('button',{name:/Install and use/})).toHaveCount(0);
});

test('the terminal command row names what answers and takes precedence only when asked', async ({page})=>{
 await page.addInitScript(()=>{
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  const shadowed:any={directory:'C:/managed/bin',shims:true,onPath:true,position:'later',first:false,shadowed:true,commands:[{name:'jz',path:'C:/Users/test/AppData/Roaming/npm/jz.cmd'},{name:'jouzu',path:null}]};
  const answered:any={directory:'C:/managed/bin',shims:true,onPath:true,position:'first',first:true,shadowed:false,commands:[{name:'jz',path:'C:/managed/bin/jz.cmd'},{name:'jouzu',path:'C:/managed/bin/jouzu.cmd'}]};
  let entry:any={...shadowed};
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string)=>{
    if(command==='launcher_state')return {ready:true,bash:false,recent:[],platform:'windows'};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='command_entry_report')return {...entry};
    if(command==='command_entry_use'){entry={...answered};return {...entry};}
    if(command==='command_entry_restore'){entry={...shadowed,commands:[{name:'jz',path:'C:/managed/bin/jz.cmd'},{name:'jouzu',path:'C:/Users/test/AppData/Roaming/npm/jouzu.cmd'}]};return {...entry};}
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('tab',{name:'System',exact:true}).click();
 const row=dialog.locator('section[aria-label="Terminal command"]');
 // The command another installation answers with is named before anything is changed.
 await expect(row.getByText(/Another installation provides them/)).toBeVisible();
 await expect(row.getByText(/npm.jz.cmd/)).toBeVisible();
 await row.getByRole('button',{name:"Use Jouzu's commands instead",exact:true}).click();
 await expect(row.getByText('jz and jouzu come from Jouzu.',{exact:true})).toBeVisible();
 // Putting the previous one back is offered as its own action.
 await row.getByRole('button',{name:"Stop using Jouzu's commands",exact:true}).click();
 await expect(row.getByText(/Another installation provides them/)).toBeVisible();
});

test('the header opens a terminal in a chosen folder and starts nothing', async ({page})=>{
 await page.addInitScript(()=>{
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  (window as any).__terminals=[];
  (window as any).__dialogs=0;
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string,args:any)=>{
    if(command==='launcher_state')return {ready:true,bash:false,recent:[{id:'windows:C:/work/prts-web',path:'C:/work/prts-web',environment:{kind:'windows'}}],platform:'windows'};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='plugin:dialog|open'){(window as any).__dialogs++;return 'C:/picked/other';}
    if(command==='terminal_open'){(window as any).__terminals.push(args.path);return null;}
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:'Open a terminal',exact:true}).click();
 await page.waitForFunction(()=> (window as any).__terminals.length===1);
 // The folder the picker returned is the one the terminal opens in, and nothing else ran.
 expect(await page.evaluate(()=> (window as any).__terminals)).toEqual(['C:/work/prts-web']);
 // No folder dialog was used: the folder the launcher already works with is the one that opens.
 expect(await page.evaluate(()=> (window as any).__dialogs)).toBe(0);
 expect(await page.getByRole('button',{name:'Open a terminal',exact:true}).isEnabled()).toBe(true);
});

test('a report is drafted by the payload and sent only when asked', async ({page})=>{
 await page.addInitScript(()=>{
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  (window as any).__submitted=[];
  (window as any).__confirms=0;
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string,args:any)=>{
    if(command==='launcher_state')return {ready:true,bash:false,recent:[],platform:'windows'};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='bug_report_can_submit')return true;
    if(command==='bug_report')return {available:true,title:'Jouzu closed the window right after opening the folder.',body:['## What happened','','Jouzu closed the window right after opening the folder.','','## Environment','','- Runtime: Jouzu Launcher 0.3.6',''].join(String.fromCharCode(10)),issueUrl:'https://github.com/shisa-ai/jouzu/issues/new'};
    if(command==='bug_report_submit'){(window as any).__submitted.push({title:args.title,body:args.body});return 'https://github.com/shisa-ai/jouzu/issues/7';}
    // confirm() compares the answer with its ok label, so the stub answers as the dialog would.
    if(command==='plugin:dialog|confirm'||command==='plugin:dialog|message'){(window as any).__confirms++;return 'Ok';}
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('tab',{name:'System',exact:true}).click();
 await dialog.getByLabel('What happened').fill('Jouzu closed the window right after opening the folder.');
 // Nothing is sent while the draft is being built.
 expect(await page.evaluate(()=> (window as any).__submitted.length)).toBe(0);
 await dialog.getByRole('button',{name:'Build the draft',exact:true}).click();
 await expect(dialog.getByLabel('Draft')).toHaveValue(/## What happened/);
 await expect(dialog.getByLabel('Draft')).toHaveValue(/Runtime: Jouzu Launcher 0.3.6/);
 await expect(dialog.getByRole('button',{name:'Submit with gh',exact:true})).toBeEnabled();
 await dialog.getByRole('button',{name:'Submit with gh',exact:true}).click();
 await page.waitForFunction(()=> (window as any).__confirms>0);
 await page.waitForFunction(()=> (window as any).__submitted.length===1);
 // It was sent only after the confirmation, and it carried the reviewed draft.
 expect(await page.evaluate(()=> (window as any).__confirms)).toBe(1);
 expect(await page.evaluate(()=> (window as any).__submitted[0].body)).toContain('## What happened');
 await expect(dialog.getByText(/Issue created:/)).toBeVisible();
});

test('a terminal command whose files are gone is repaired from its row', async ({page})=>{
 await page.addInitScript(()=>{
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  (window as any).__repairs=0;
  const missing:any={directory:'C:/managed/bin',shims:false,onPath:false,position:'absent',first:false,shadowed:false,commands:[{name:'jz',path:null},{name:'jouzu',path:null}]};
  const repaired:any={directory:'C:/managed/bin',shims:true,onPath:true,position:'later',first:false,shadowed:false,commands:[{name:'jz',path:'C:/managed/bin/jz.cmd'},{name:'jouzu',path:'C:/managed/bin/jouzu.cmd'}]};
  let entry:any={...missing};
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string)=>{
    if(command==='launcher_state')return {ready:true,bash:false,recent:[],platform:'windows'};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='command_entry_report')return {...entry};
    if(command==='command_entry_repair'){(window as any).__repairs++;entry={...repaired};return {...entry};}
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('tab',{name:'System',exact:true}).click();
 const row=dialog.locator('section[aria-label="Terminal command"]');
 await expect(row.getByText('The command files are missing.',{exact:true})).toBeVisible();
 await row.getByRole('button',{name:'Repair',exact:true}).click();
 await page.waitForFunction(()=> (window as any).__repairs===1);
 // The row then says what answers, and the repair action is gone.
 await expect(row.getByText('jz and jouzu come from Jouzu.',{exact:true})).toBeVisible();
 await expect(row.getByRole('button',{name:'Repair',exact:true})).toHaveCount(0);
});

test('without a signed in gh the form opens with the draft instead of a disabled action', async ({page})=>{
 await page.addInitScript(()=>{
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  (window as any).__submitted=[];
  (window as any).__opened=[];
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string,args:any)=>{
    if(command==='launcher_state')return {ready:true,bash:false,recent:[],platform:'windows'};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='bug_report_can_submit')return false;
    if(command==='bug_report')return {available:true,title:'Jouzu closed the window',body:'## What happened (Jouzu closed the window)',issueUrl:'https://github.com/shisa-ai/jouzu/issues/new'};
    if(command==='bug_report_submit'){(window as any).__submitted.push(args);return 'x';}
    if(command==='plugin:opener|open_url'){(window as any).__opened.push(args.url);return null;}
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('tab',{name:'System',exact:true}).click();
 await dialog.getByLabel('What happened').fill('Jouzu closed the window');
 await dialog.getByRole('button',{name:'Build the draft',exact:true}).click();
 await expect(dialog.getByLabel('Draft')).toHaveValue(/## What happened/);
 // No gh here, so the row says so and the form carries the draft when it opens.
 await expect(dialog.getByText(/gh is not signed in here/)).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Submit with gh',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Open the issue form',exact:true}).click();
 await page.waitForFunction(()=> (window as any).__opened.length===1);
 const url = await page.evaluate(()=> (window as any).__opened[0]);
 expect(url).toContain('/issues/new?');
 // The form carries the draft: spaces travel as + in a query string.
 expect(decodeURIComponent(url.replaceAll('+',' '))).toContain('Jouzu closed the window');
 expect(await page.evaluate(()=> (window as any).__submitted.length)).toBe(0);
});
