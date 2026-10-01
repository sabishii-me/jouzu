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
    invoke:async (command:string) => {
     if(command==='launcher_state') return {ready:true,bash:true,recent:[],platform:'windows'};
     if(command==='component_versions') return {jouzu:'0.1.18',development:true};
     if(command==='control_request') {const result={...state};if(legacy)delete (result as any).customProviders;return result;}
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
  else { await dialog.getByRole('button',{name:'Add connection',exact:true}).click(); await expect(dialog.getByRole('combobox',{name:'Service',exact:true})).toBeVisible(); await expect(dialog.getByRole('button',{name:'Add connection',exact:true})).toHaveCount(0); await dialog.getByRole('combobox',{name:'Connection type'}).click(); await page.getByRole('option',{name:'Custom provider',exact:true}).click(); await expect(dialog.getByRole('textbox',{name:'API base URL'})).toBeVisible(); }
  await dialog.getByRole('tab',{name:'Environment',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Add variable',exact:true})).toBeVisible();
  await dialog.getByRole('tab',{name:'General',exact:true}).click();
  await expect(dialog.getByRole('combobox',{name:'Interface language'})).toBeVisible();
  expect(errors).toEqual([]);
 });
}
