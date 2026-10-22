import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageJouzuUpdate} from './stage-update.mjs';
import {PNPM_VERSION} from './prepare-starter.mjs';
for(const fail of [false,true])test(`staging ${fail?'failure preserves active app':'verifies before finishing'}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'jouzu-update-'));
 try{
 const recipe=join(root,'recipe');mkdirSync(recipe);
 writeFileSync(join(recipe,'package.json'),JSON.stringify({packageManager:`pnpm@${PNPM_VERSION}`,dependencies:{jouzu:'file:artifacts/jouzu.tgz'}}));writeFileSync(join(recipe,'pnpm-lock.yaml'),'fixture');
 const active=join(root,'active');mkdirSync(active);writeFileSync(join(active,'marker'),'unchanged');
 const destination=join(root,'new');const phases=[];
 const operation=stageJouzuUpdate({recipe,runtime:root,store:join(root,'store'),destination,onProgress:e=>phases.push(e.phase)},{runtimeCheck:()=>{},run:async(_node,args)=>{assert.ok(args.includes('--frozen-lockfile'));assert.ok(args.includes('--ignore-scripts'));const app=args[args.indexOf('--dir')+1];mkdirSync(join(app,'node_modules/jouzu/dist'),{recursive:true});writeFileSync(join(app,'node_modules/jouzu/dist/cli.js'),'fixture');},targetCheck:()=>{},verify:async()=>{if(fail)throw Error('bad runtime');}});
 if(fail){await assert.rejects(operation,/bad runtime/);assert.equal(existsSync(destination),false);}else{await operation;assert.ok(existsSync(join(destination,'app/bootstrap.mjs')));assert.deepEqual(phases,['preparing','verifying','staged']);}
 assert.ok(existsSync(join(active,'marker')));assert.equal(readdirSync(root).some(n=>n.includes('.staging-')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

for (const failure of ['cancel-before', 'prepare', 'target', 'entrypoint', 'cancel-after-prepare']) {
 test(`staging rejects ${failure} without changing active files`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'jouzu-update-fault-'));
  try {
   const recipe = join(root, 'recipe'); mkdirSync(recipe);
   writeFileSync(join(recipe, 'package.json'), JSON.stringify({packageManager:`pnpm@${PNPM_VERSION}`, dependencies:{jouzu:'file:artifacts/jouzu.tgz'}}));
   writeFileSync(join(recipe, 'pnpm-lock.yaml'), 'fixture');
   const active = join(root, 'active'); mkdirSync(active);
   writeFileSync(join(active, 'marker'), 'unchanged');
   const destination = join(root, 'new');
   const controller = new AbortController();
   if (failure === 'cancel-before') controller.abort();
   let started = false;
   await assert.rejects(stageJouzuUpdate({recipe, runtime:root, store:join(root,'store'), destination, signal:controller.signal}, {
    runtimeCheck: () => {},
    run: async (_node, args) => {
     started = true;
     if (failure === 'prepare') throw new Error('fixture preparation failure');
     const app = args[args.indexOf('--dir') + 1];
     if (failure !== 'entrypoint') {
      mkdirSync(join(app,'node_modules/jouzu/dist'), {recursive:true});
      writeFileSync(join(app,'node_modules/jouzu/dist/cli.js'), 'fixture');
     }
     if (failure === 'cancel-after-prepare') controller.abort();
    },
    targetCheck: () => { if (failure === 'target') throw new Error('fixture wrong platform'); },
    verify: async () => {},
   }));
   if (failure === 'cancel-before') assert.equal(started, false);
   assert.equal(existsSync(destination), false);
   assert.equal(readFileSync(join(active,'marker'),'utf8'), 'unchanged');
   assert.equal(readdirSync(root).some(name => name.includes('.staging-')), false);
  } finally { rmSync(root, {recursive:true, force:true}); }
 });
}

test('runtime repair requirement fails before staging or invoking pnpm', async () => {
 const root = mkdtempSync(join(tmpdir(), 'jouzu-update-runtime-'));
 try {
  const recipe = join(root, 'recipe'); mkdirSync(recipe);
  writeFileSync(join(recipe, 'package.json'), JSON.stringify({packageManager:`pnpm@${PNPM_VERSION}`, dependencies:{jouzu:'file:artifacts/jouzu.tgz'}}));
  writeFileSync(join(recipe, 'pnpm-lock.yaml'), 'fixture');
  const destination = join(root, 'new');
  const phases = [];
  await assert.rejects(stageJouzuUpdate({recipe, runtime:root, store:join(root,'store'), destination, onProgress:event=>phases.push(event.phase)}, {
   run: async () => assert.fail('must not invoke pnpm with a missing runtime'),
  }), {code:'JOUZU_RUNTIME_REPAIR_REQUIRED'});
  assert.deepEqual(phases, []);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(root), ['recipe']);
 } finally { rmSync(root, {recursive:true, force:true}); }
});

for (const packageManager of ['pnpm@10.21.0', 'pnpm@latest', undefined]) {
 test(`staging refuses an unqualified recipe manager: ${packageManager}`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'jouzu-update-manager-'));
  try {
   writeFileSync(join(root, 'package.json'), JSON.stringify({packageManager, dependencies:{jouzu:'file:artifacts/jouzu.tgz'}}));
   writeFileSync(join(root, 'pnpm-lock.yaml'), 'fixture');
   await assert.rejects(stageJouzuUpdate({recipe:root, runtime:root, destination:join(root, 'new')}, {
    runtimeCheck: () => assert.fail('invalid recipe must be refused first'),
    run: async () => assert.fail('must not invoke pnpm'),
   }), /Invalid managed recipe/);
  } finally { rmSync(root, {recursive:true, force:true}); }
 });
}
