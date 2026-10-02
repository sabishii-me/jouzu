import { mkdirSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPublishedTarball } from './published-input.mjs';
import { exportRecipe } from './export-recipe.mjs';
import { installArguments } from './prepare-starter.mjs';
import { assertInstalledTarget } from './installed-target.mjs';
import { checkStagedHealth } from './check-update-health.mjs';
import { fetchReleaseNotes } from './jouzu-notes.mjs';

async function download(url, limit) {
 const response = await fetch(url, {redirect:'error',signal:AbortSignal.timeout(120000)});
 if (!response.ok || !response.body) throw new Error('Published input download failed');
 const chunks=[]; let size=0;
 for await (const chunk of response.body) {
  size+=chunk.length;
  if(size>limit) throw new Error('Published input exceeds size limit');
  chunks.push(chunk);
 }
 return Buffer.concat(chunks);
}
function run(executable,args,cwd) {
 const result=spawnSync(executable,args,{cwd,stdio:'inherit',timeout:600000,windowsHide:true});
 if(result.error) throw result.error;
 if(result.status!==0) throw new Error('Windows runtime preparation failed');
}

/** Build a Windows update recipe from the same published package npm users install. */
export async function preparePublishedRuntime({version,output,pnpm}) {
 if(process.platform!=='win32' || process.arch!=='x64') throw new Error('Windows x64 builder required');
 if(!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected an exact release version');
 const root=resolve(output);
 if(existsSync(root)) throw new Error('Output must not exist');
 const metadata=JSON.parse((await download(`https://registry.npmjs.org/jouzu/${version}`,1024*1024)).toString('utf8'));
 // Construct the URL rather than fetching an unvalidated metadata-controlled host.
 const bytes=await download(`https://registry.npmjs.org/jouzu/-/jouzu-${version}.tgz`,512*1024*1024);
 const receipt=verifyPublishedTarball(bytes,metadata,version);
 mkdirSync(root,{recursive:true});
 writeFileSync(join(root,'source.tgz'),bytes);
 writeFileSync(join(root,'source.json'),JSON.stringify(receipt,null,2)+'\n');
 const notes=await fetchReleaseNotes({metadata,version});
 writeFileSync(join(root,'notes.json'),JSON.stringify(notes,null,2)+'\n');
 const source=join(root,'source');mkdirSync(source);
 run(join(process.env.SystemRoot,'System32','tar.exe'),['-xzf',join(root,'source.tgz'),'-C',source],root);
 const recipe=join(root,'recipe');
 exportRecipe(join(source,'package'),recipe);
 const store=join(root,'store');
 run(process.execPath,[resolve(pnpm),'install','--dir',recipe,'--store-dir',store,'--prod','--ignore-scripts','--config.node-linker=hoisted','--config.package-import-method=copy'],root);
 // Reinstall from the generated frozen lock in a distinct directory.
 const app=join(root,'app');mkdirSync(app);
 for(const file of ['package.json','pnpm-lock.yaml','artifacts'])cpSync(join(recipe,file),join(app,file),{recursive:true});
 run(process.execPath,[resolve(pnpm),...installArguments(app,store)],root);
 assertInstalledTarget(app);
 cpSync(fileURLToPath(new URL('./bootstrap.mjs',import.meta.url)),join(app,'bootstrap.mjs'));
 await checkStagedHealth({node:process.execPath,app,version});
 return {root,app,recipe,receipt};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [version,output,pnpm]=process.argv.slice(2);
 if(!pnpm) throw new Error('Usage: npm exec -- node packaging/launcher/prepare-published-runtime.mjs <version> <new-output> <pnpm.cjs>');
 await preparePublishedRuntime({version,output,pnpm});
}
