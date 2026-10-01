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
  else { await dialog.getByRole('button',{name:'Add connection',exact:true}).click(); await expect(dialog.getByRole('combobox',{name:'Service',exact:true})).toBeVisible(); await expect(dialog.getByRole('button',{name:'Add connection',exact:true})).toHaveCount(0); await expect(dialog.getByRole('combobox')).toHaveCount(1); await dialog.getByRole('combobox',{name:'Service',exact:true}).click(); await page.getByRole('option',{name:'Custom provider',exact:true}).click(); await expect(dialog.getByRole('textbox',{name:'API base URL'})).toBeVisible(); }
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

test('known Jouzu update opens directly to install without rechecking', async ({page}) => {
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
 await page.goto('http://localhost:1420');
 await page.getByRole('button',{name:'Update available',exact:true}).click();
 const dialog=page.getByRole('dialog');
 const install=dialog.getByRole('button',{name:'Jouzu → 0.1.18',exact:true});
 await expect(install).toBeVisible();
 expect(await page.evaluate(()=>(window as any).updateChecks)).toBe(1);
 await install.click();
 await expect(install).toHaveCount(0);
 await expect(dialog.getByText('Up to date',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).updateInstalls)).toBe(1);
 expect(await page.evaluate(()=>(window as any).updateChecks)).toBe(1);
});
