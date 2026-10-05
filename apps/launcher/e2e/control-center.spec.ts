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

test('development update preview never invokes real update commands', async ({page}) => {
 await page.addInitScript(() => {
  (window as any).isTauri = true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  (window as any).updateChecks=0;
  (window as any).updateInstalls=0;
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1,unregisterCallback:()=>{},
   invoke:async(command:string,args?:any)=>{
    if(command==='launcher_state')return {ready:true,bash:true,recent:[],platform:'windows'};
    if(command==='component_versions')return {jouzu:(window as any).updateInstalls?'0.1.18':'0.1.17',development:true,jouzuUpdaterConfigured:true};
    if(command==='jouzu_update'){
     if(args.action==='check'){(window as any).updateChecks++;return {available:true,version:'0.1.18'};}
     (window as any).updateInstalls++;return {available:false,version:'0.1.18'};
    }
    if(command==='control_request')return {schemaVersion:1,profile:'core',account:{signedIn:false},credentials:[],customProviders:[],providers:[],models:[]};
    if(command==='environment_read')return [];
    if(command.includes('version'))return '0.1.20';
    if(command.includes('confirm'))throw Error('Jouzu update must not ask for another confirmation');
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420/?updates=1');
 await page.getByRole('button',{name:'Update available',exact:true}).click();
 const dialog=page.getByRole('dialog');
 const install=dialog.getByRole('button',{name:'Update Jouzu',exact:true});
 await expect(install).toBeVisible();
 expect(await page.evaluate(()=>(window as any).updateChecks)).toBe(0);
 await install.click();
 await expect(install).toHaveCount(0);
 await expect(dialog.getByText('Updated',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).updateInstalls)).toBe(0);
 expect(await page.evaluate(()=>(window as any).updateChecks)).toBe(0);
});

test('update preview supports failed download, retry and independent components', async ({page}) => {
 await page.addInitScript(()=>{localStorage.setItem('jouzu.ui.language','en');});
 await page.goto('http://localhost:1420/?updates=1');
 await page.getByRole('button',{name:'Update available',exact:true}).click();
 const dialog=page.getByRole('dialog');
 const scenarios=dialog.getByRole('combobox');
 await scenarios.click();await page.getByRole('option',{name:'Download fails',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Update Jouzu',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('alert')).toContainText('Your current version is unchanged');
 await expect(dialog.getByText('Current version 0.1.17',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(dialog.getByText('Updated',{exact:true})).toBeVisible();
 await expect(dialog.getByText('Current version 0.1.18',{exact:true})).toBeVisible();
 await scenarios.click();await page.getByRole('option',{name:'Launcher only',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Update Jouzu',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Update and restart',exact:true})).toBeVisible();
 await scenarios.click();await page.getByRole('option',{name:'Check failed',exact:true}).click();
 await dialog.getByRole('button',{name:'Check for updates',exact:true}).click();
 await expect(dialog.getByRole('alert')).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Update Jouzu',exact:true})).toBeVisible();
});

test('update preview keeps row height stable and exposes persistent progress scenes', async ({page}) => {
 await page.addInitScript(()=>localStorage.setItem('jouzu.ui.language','en'));
 await page.goto('http://localhost:1420/?updates=1');
 await page.getByRole('button',{name:'Update available',exact:true}).click();
 const dialog=page.getByRole('dialog');const rows=dialog.locator('section');
 const height=(await rows.first().boundingBox())!.height;
 for(const [scene,status] of [['Downloading','Downloading…'],['Installing','Installing…'],['No updates','Up to date'],['Check failed','Could not check for updates']]){
  await dialog.getByRole('combobox').click();await page.getByRole('option',{name:scene,exact:true}).click();
  await expect(rows.first().getByText(status,{exact:true})).toBeVisible();
  expect((await rows.first().boundingBox())!.height).toBe(height);
  expect((await rows.nth(1).boundingBox())!.height).toBe(height);
 }
});

test('launcher preview icon asks once before simulated restart', async ({page})=>{
 await page.addInitScript(()=>localStorage.setItem('jouzu.ui.language','en'));
 await page.goto('http://localhost:1420/?updates=1');
 await page.getByRole('button',{name:'Update available',exact:true}).click();
 await page.getByRole('button',{name:'Update and restart',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'Update and restart',exact:true});
 await expect(confirmation).toBeVisible();
 await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(confirmation).toHaveCount(0);
 await expect(page.getByText('Current version 0.1.20',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Update and restart',exact:true}).click();
 await confirmation.getByRole('button',{name:'Update and restart',exact:true}).click();
 await expect(confirmation).toHaveCount(0);
 await expect(page.getByText('Current version 0.1.21',{exact:true})).toBeVisible();
});

test('each update item shows what changed', async ({page})=>{
 await page.addInitScript(()=>localStorage.setItem('jouzu.ui.language','en'));
 await page.goto('http://localhost:1420/?updates=1');
 await page.getByRole('button',{name:'Update available',exact:true}).click();
 const dialog=page.getByRole('dialog');const rows=dialog.locator('section');
 // The Jouzu row describes the Jouzu release and the Launcher row describes the Launcher release,
 // so the two rows never show the same note.
 await expect(rows.nth(0).getByText("What's new",{exact:true})).toBeVisible();
 await expect(rows.nth(0).getByText(/Git Bash is prepared during installation/)).toBeVisible();
 await expect(rows.nth(1).getByText(/install only launcher-owned files/)).toBeVisible();
 await expect(rows.nth(1).getByText(/Git Bash is prepared during installation/)).toHaveCount(0);
});
test('the System section installs and selects the Git Bash component', async ({page})=>{
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
    if(command==='terminal_install'){terminal.bundled={path:'C:\\Program Files\\Jouzu\\terminal\\WindowsTerminal.exe',version:'1.25.2733.0'};terminal.effective=terminal.bundled.path;return {...terminal};}
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
 // An installation without the bundled Git says so and offers both choices.
 await expect(row.getByText('Not installed',{exact:true})).toBeVisible();
 await expect(row.getByText(/Jouzu needs a Git Bash to open folders/)).toBeVisible();
 await expect(row.getByRole('button',{name:"Use this PC's Git Bash",exact:true})).toBeVisible();
 // Installing the bundled Git Bash replaces the state without a reload.
 await row.getByRole('button',{name:'Install the bundled Git Bash',exact:true}).click();
 await expect(row.getByText(/2\.55\.0\.windows\.5/)).toBeVisible();
 await expect(row.getByText('Not installed',{exact:true})).toHaveCount(0);
 // Choosing the machine's own Git Bash says so and offers the way back.
 await row.getByRole('button',{name:"Use this PC's Git Bash",exact:true}).click();
 await expect(row.getByText(/Jouzu is using this PC's Git Bash/)).toBeVisible();
 await expect(row.getByRole('button',{name:'Use the bundled Git Bash',exact:true})).toBeVisible();
 // The terminal host is the second component, and it installs the same way.
 const terminalRow=dialog.locator('section[aria-label="Windows Terminal"]');
 await expect(terminalRow.getByText('Not installed',{exact:true})).toBeVisible();
 await terminalRow.getByRole('button',{name:'Install the bundled Windows Terminal',exact:true}).click();
 await expect(terminalRow.getByText(/1\.25\.2733\.0/)).toBeVisible();
});
