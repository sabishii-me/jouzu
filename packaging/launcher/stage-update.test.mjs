import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageJouzuUpdate} from './stage-update.mjs';
for(const fail of [false,true])test(`staging ${fail?'failure preserves active app':'verifies before finishing'}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'jouzu-update-'));
 try{
 const recipe=join(root,'recipe');mkdirSync(recipe);
 writeFileSync(join(recipe,'package.json'),JSON.stringify({packageManager:'pnpm@10.21.0',dependencies:{jouzu:'file:artifacts/jouzu.tgz'}}));writeFileSync(join(recipe,'pnpm-lock.yaml'),'fixture');
 const active=join(root,'active');mkdirSync(active);writeFileSync(join(active,'marker'),'unchanged');
 const destination=join(root,'new');const phases=[];
 const operation=stageJouzuUpdate({recipe,runtime:root,store:join(root,'store'),destination,onProgress:e=>phases.push(e.phase)},{run:async(_node,args)=>{assert.ok(args.includes('--frozen-lockfile'));assert.ok(args.includes('--ignore-scripts'));const app=args[args.indexOf('--dir')+1];mkdirSync(join(app,'node_modules/jouzu/dist'),{recursive:true});writeFileSync(join(app,'node_modules/jouzu/dist/cli.js'),'fixture');},targetCheck:()=>{},verify:async()=>{if(fail)throw Error('bad runtime');}});
 if(fail){await assert.rejects(operation,/bad runtime/);assert.equal(existsSync(destination),false);}else{await operation;assert.deepEqual(phases,['preparing','verifying','staged']);}
 assert.ok(existsSync(join(active,'marker')));assert.equal(readdirSync(root).some(n=>n.includes('.staging-')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
