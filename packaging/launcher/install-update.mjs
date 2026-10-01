import { pruneUpdates } from './prune-updates.mjs';
import { join } from 'node:path';
import { mkdirSync,rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { downloadRecipe } from './download-recipe.mjs';
import { stageJouzuUpdate } from './stage-update.mjs';
import { activateJouzu,withUpdateTransaction } from './activate-update.mjs';
import { checkStagedHealth } from './check-update-health.mjs';

/** A single process-owned lock spans download through activation. Caller config
 * (including expected release version) must come from a trusted release source.
 */
export async function installJouzuUpdate({managed,runtime,url,publicKey,version,signal,allowLoopbackHttp=false,allowTestHttpHost=null,onProgress=()=>{}}) {
 return withUpdateTransaction(managed,async transaction=>{
  pruneUpdates(transaction.root);
  const slot=randomUUID();
  const versions=join(transaction.root,'versions');mkdirSync(versions,{recursive:true});
  const work=join(transaction.root,`recipe-${slot}`);
  try{
   const {recipe}=await downloadRecipe({url,publicKey,expected:{version,platform:process.platform,arch:process.arch,maxBytes:512*1024*1024},destination:work,signal,allowLoopbackHttp,allowTestHttpHost,onProgress});
   await stageJouzuUpdate({recipe,runtime,store:join(transaction.root,'store'),destination:join(versions,slot),signal,onProgress});
   signal?.throwIfAborted();
   onProgress({phase:'verifying'});
   const node=join(runtime,'node',process.platform==='win32'?'node.exe':'bin/node');
   const result=await activateJouzu({managed,slot,version,healthCheck:async app=>{
    await checkStagedHealth({node,app,version,signal});signal?.throwIfAborted();onProgress({phase:'activating'});
   }},transaction);
   onProgress({phase:'complete',version});return result;
  }finally{rmSync(work,{recursive:true,force:true});pruneUpdates(transaction.root);}
 });
}
