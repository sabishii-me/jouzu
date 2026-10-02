import {test,expect} from '@playwright/test';

test('model setup and workspaces preserve preferences and share settings', async ({page}) => {
 await page.addInitScript(()=>localStorage.setItem('jouzu.ui.language','en'));
 await page.goto('http://localhost:1420/?onboarding=1');
 await expect(page.getByRole('heading',{name:'Make Jouzu yours'})).toBeVisible();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Connect a model'})).toBeVisible();
 await page.getByRole('button',{name:'Return to workspaces',exact:true}).click();
 await page.getByRole('button',{name:'Return to model setup',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Connect a model'})).toBeVisible();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'Sign in to Shisa',exact:true}).click();
 await dialog.getByRole('button',{name:'Complete demo authorization'}).click();
 await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Return to model setup',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Connect a model'})).toHaveCount(0);
});

test('languages are discoverable and provider search includes custom credentials', async ({page}) => {
 await page.addInitScript(()=>localStorage.setItem('jouzu.ui.language','en'));
 await page.goto('http://localhost:1420/?onboarding=1');
 for(const name of ['English','日本語','简体中文','繁體中文']) await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('button',{name:'Add provider',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Sign in to Shisa',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Search services'})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Service',exact:true}).click();
 await page.getByRole('textbox',{name:'Search services'}).fill('custom');
 await page.getByRole('option',{name:'Custom provider',exact:true}).click();
 await expect(page.getByLabel('API key',{exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'API base URL'})).toBeVisible();
});

test('page frame remains stable across preferences, model setup and workspaces', async ({page}) => {
 await page.addInitScript(()=>localStorage.setItem('jouzu.ui.language','en'));
 await page.goto('http://localhost:1420/?onboarding=1');
 const geometry=async()=>({heading:await page.locator('[data-slot="page-heading"]').boundingBox(),body:await page.locator('[data-slot="page-body"]').boundingBox()});
 const initial=await geometry();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 expect(await geometry()).toEqual(initial);
 await page.getByRole('combobox',{name:'Service',exact:true}).click();
 await page.getByRole('option',{name:'Custom provider',exact:true}).click();
 expect(await geometry()).toEqual(initial);
 await page.getByRole('button',{name:'Return to workspaces',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Where will you work?'})).toBeVisible();
 expect(await geometry()).toEqual(initial);
 await page.getByRole('button',{name:'Return to model setup',exact:true}).click();
 expect(await geometry()).toEqual(initial);
 await expect(page.getByLabel('API key',{exact:true})).toBeVisible();
});

test('Japanese-first defaults follow language until explicitly chosen', async ({page}) => {
 await page.addInitScript(()=>localStorage.setItem('jouzu.ui.language','en'));
 await page.goto('http://localhost:1420/?onboarding=1');
 const toggle=page.getByRole('switch');
 await expect(toggle).not.toBeChecked();
 await page.getByRole('button',{name:'日本語',exact:true}).click();
 await expect(toggle).toBeChecked();
 await page.getByRole('button',{name:'English',exact:true}).click();
 await expect(toggle).not.toBeChecked();
 await toggle.click();
 await page.getByRole('button',{name:'简体中文',exact:true}).click();
 await expect(toggle).toBeChecked();
});

test('Shisa authorization actions stay together and cancellation preserves setup', async ({page}) => {
 await page.addInitScript(()=>localStorage.setItem('jouzu.ui.language','en'));
 await page.goto('http://localhost:1420/?onboarding=1');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Sign in to Shisa',exact:true}).click();
 const open=page.getByRole('button',{name:'Open in browser',exact:true});
 const cancel=page.getByRole('button',{name:'Cancel',exact:true});
 const a=await open.boundingBox(), b=await cancel.boundingBox();
 expect(a?.y).toBe(b?.y);
 expect(b!.x+b!.width).toBeLessThan(a!.x);
 await cancel.click();
 await expect(open).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Sign in to Shisa',exact:true})).toBeVisible();
});

test('overlapping configuration requests never surface a busy error', async ({page}) => {
 const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  localStorage.setItem('jouzu.ui.language','en');
  let active=false;
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:()=>1, unregisterCallback:()=>{},
   invoke:async (command:string)=>{
    if(command==='launcher_state') return {ready:true,bash:true,recent:[],platform:'windows'};
    if(command==='component_versions') return {jouzu:'0.1.18',development:true};
    if(command==='control_request') {
     if(active) throw new Error('Another configuration operation is running');
     active=true;
     try { await new Promise(resolve=>setTimeout(resolve,150)); return {schemaVersion:1,modelReady:true,profile:'core',account:{signedIn:false},credentials:[],customProviders:[],providers:[],models:[]}; }
     finally { active=false; }
    }
    if(command==='environment_read') return [];
    if(command.includes('version')) return '0.1.0';
    return 1;
   }
  };
 });
 await page.goto('http://localhost:1420');
 await expect(page.getByRole('heading',{name:'Where will you work?'})).toBeVisible();
 await expect(page.getByText('Another configuration operation is running')).toHaveCount(0);
 expect(errors).toEqual([]);
});
