import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPackageRoot, exportRecipe } from './export-recipe.mjs';
import { PNPM_VERSION } from './prepare-starter.mjs';

test('exported recipes pin the same private pnpm used for installation', t => {
 const root = mkdtempSync(join(tmpdir(), 'jouzu-export-manager-'));
 t.after(() => rmSync(root, {recursive:true, force:true}));
 const source = join(root, 'source');
 const coding = join(source, 'node_modules/@earendil-works/pi-coding-agent');
 const core = join(coding, 'node_modules/@earendil-works/pi-agent-core');
 for (const [path, name] of [[source, 'jouzu'], [coding, '@earendil-works/pi-coding-agent'], [core, '@earendil-works/pi-agent-core']]) {
  mkdirSync(path, {recursive:true});
  writeFileSync(join(path, 'package.json'), JSON.stringify({name, version:'0.0.0', scripts:{prepack:'node -e "process.exit(1)"'}}));
 }
 mkdirSync(join(source, 'dist'));
 writeFileSync(join(source, 'dist/cli.js'), 'fixture');
 const output = join(root, 'recipe');
 const recipe = exportRecipe(source, output);
 assert.equal(recipe.packageManager, `pnpm@${PNPM_VERSION}`);
 assert.deepEqual(JSON.parse(readFileSync(join(output, 'package.json'), 'utf8')), recipe);
 assert.ok(recipe.dependencies.jouzu.startsWith('file:artifacts/'));
});
test('export uses coding-agent nested core, not a different root dependency',()=>{
 const root=mkdtempSync(join(tmpdir(),'jouzu-export-'));
 const coding=join(root,'node_modules/@earendil-works/pi-coding-agent');
 const nested=join(coding,'node_modules/@earendil-works/pi-agent-core');
 const top=join(root,'node_modules/@earendil-works/pi-agent-core');
 try{
  for(const [path,name] of [[coding,'@earendil-works/pi-coding-agent'],[nested,'@earendil-works/pi-agent-core'],[top,'@earendil-works/pi-agent-core']]){
   mkdirSync(path,{recursive:true});writeFileSync(join(path,'package.json'),JSON.stringify({name}));
  }
  assert.equal(exportPackageRoot(root,'@earendil-works/pi-agent-core'),realpathSync(nested));
  rmSync(nested,{recursive:true});
  assert.equal(exportPackageRoot(root,'@earendil-works/pi-agent-core'),realpathSync(top));
 }finally{rmSync(root,{recursive:true,force:true});}
});
