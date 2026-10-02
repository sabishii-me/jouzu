import {test,expect,type Page} from '@playwright/test';

// Drives the real onboarding surface through a stateful configuration backend.
async function openSetup(page:Page, initial:{profile?:string|null;modelReady?:boolean;recent?:{id:string;path:string;environment:{kind:string}}[]}={}) {
 await page.addInitScript(state=>{
  localStorage.setItem('jouzu.ui.language','en');
  (window as any).isTauri=true;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  const callbacks:Record<string,unknown>={};
  const s={profile:state.profile ?? null,modelReady:state.modelReady ?? false,signedIn:false,recent:state.recent ?? []};
  let cancelPending:(()=>void)|null=null;
  const snapshot=()=>({schemaVersion:1,modelReady:s.modelReady,profile:s.profile,account:{signedIn:s.signedIn},credentials:[],customProviders:[],providers:[{id:'openai',name:'OpenAI'}],models:[]});
  (window as any).__TAURI_INTERNALS__={
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
   transformCallback:(callback:unknown)=>{const id=String(Math.random());callbacks[id]=callback;return id;},
   unregisterCallback:()=>{},
   invoke:async (command:string,args:any)=>{
    if(command==='plugin:event|listen'){if(args.event==='control-device')(window as any).__deviceHandler=args.handler;return 1;}
    if(command==='launcher_state')return {ready:true,bash:true,platform:'windows',recent:s.recent};
    if(command==='component_versions')return {jouzu:'0.1.18',development:true};
    if(command==='environment_read')return [];
    if(command==='cancel_control'){cancelPending?.();return 1;}
    if(command==='control_request'){
     const action=args?.request?.action;
     if(action==='profile')s.profile=String(args.request.profile);
     if(action==='shisa-logout')s.signedIn=false;
     if(action==='custom-provider')s.modelReady=true;
     if(action==='shisa-login'){
      s.signedIn=true;
      // The device panel stays until sign-in settles, mirroring the blocking backend call.
      (callbacks[(window as any).__deviceHandler] as any)?.({event:'control-device',id:1,payload:{url:'https://platform.shisa.ai/connect',code:'DEMO-1234'}});
      return new Promise((resolve,reject)=>{cancelPending=()=>{cancelPending=null;reject(new Error('cancelled'));};setTimeout(()=>{cancelPending=null;resolve(snapshot());},8000);});
     }
     return snapshot();
    }
    if(command.includes('version'))return '0.1.0';
    return 1;
   }
  };
 },initial);
 await page.goto('http://localhost:1420');
}

test('routing follows usable model availability', async ({page}) => {
 await openSetup(page,{modelReady:false});
 await expect(page.getByRole('heading',{name:'Make Jouzu yours'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Where will you work?'})).toHaveCount(0);
});

test('a configured model opens workspaces with a path back to setup', async ({page}) => {
 await openSetup(page,{modelReady:true,profile:'core',recent:[{id:'w1',path:'C:/Projects/Jouzu',environment:{kind:'windows'}}]});
 await expect(page.getByRole('heading',{name:'Where will you work?'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Return to model setup',exact:true})).toHaveCount(0);
});

test('preferences lead to provider setup and the page frame stays put', async ({page}) => {
 await openSetup(page,{recent:[{id:'w1',path:'C:/Projects/Jouzu',environment:{kind:'windows'}}]});
 const geometry=async()=>({heading:await page.locator('[data-slot="page-heading"]').boundingBox(),body:await page.locator('[data-slot="page-body"]').boundingBox()});
 const initial=await geometry();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Connect a model'})).toBeVisible();
 expect(await geometry()).toEqual(initial);
 await page.getByRole('button',{name:'Return to workspaces',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Where will you work?'})).toBeVisible();
 expect(await geometry()).toEqual(initial);
 await page.getByRole('button',{name:'Return to model setup',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Connect a model'})).toBeVisible();
 expect(await geometry()).toEqual(initial);
});

test('languages are discoverable and custom providers accept a key', async ({page}) => {
 await openSetup(page,{});
 for(const name of ['English','日本語','简体中文','繁體中文']) await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Search services'})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Service',exact:true}).click();
 await page.getByRole('textbox',{name:'Search services'}).fill('custom');
 await page.getByRole('option',{name:'Custom provider',exact:true}).click();
 await expect(page.getByLabel('API key',{exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'API base URL'})).toBeVisible();
});

test('Japanese-first follows the language until explicitly chosen', async ({page}) => {
 await openSetup(page,{});
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

test('Shisa authorization keeps its actions together and cancels cleanly', async ({page}) => {
 await openSetup(page,{profile:'core'});
 await page.getByRole('button',{name:'Sign in to Shisa',exact:true}).click();
 const open=page.getByRole('button',{name:'Open in browser',exact:true});
 const cancel=page.getByRole('button',{name:'Cancel',exact:true});
 await expect(open).toBeVisible();
 const a=await open.boundingBox(), b=await cancel.boundingBox();
 expect(a?.y).toBe(b?.y);
 expect(b!.x+b!.width).toBeLessThan(a!.x);
 await cancel.click();
 await expect(open).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Sign in to Shisa',exact:true})).toBeVisible();
});
