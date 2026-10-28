import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPackageRoot, exportRecipe } from './export-recipe.mjs';
import { assertDefuddleSidecar } from './verify-runtime.mjs';
import { PNPM_VERSION } from './prepare-starter.mjs';

function packageAt(path, manifest) {
 mkdirSync(path, {recursive:true});
 writeFileSync(join(path, 'package.json'), JSON.stringify(manifest));
}

function defuddleFixture(root) {
 const webaio = join(root, 'node_modules/pi-webaio');
 const defuddle = join(webaio, 'node_modules/defuddle');
 packageAt(webaio, {name:'pi-webaio', version:'0.0.0'});
 packageAt(defuddle, {name:'defuddle', version:'0.0.0', files:['dist']});
 mkdirSync(join(defuddle, 'dist'), {recursive:true});
 writeFileSync(join(defuddle, 'dist/jouzu-diagnostics.cjs'), 'fixture sidecar');
 return {webaio, defuddle};
}

test('exported recipes pin the same private pnpm and ship the patched defuddle', t => {
 const root = mkdtempSync(join(tmpdir(), 'jouzu-export-manager-'));
 t.after(() => rmSync(root, {recursive:true, force:true}));
 const source = join(root, 'source');
 const coding = join(source, 'node_modules/@earendil-works/pi-coding-agent');
 const core = join(coding, 'node_modules/@earendil-works/pi-agent-core');
 for (const [path, name] of [[source, 'jouzu'], [coding, '@earendil-works/pi-coding-agent'], [core, '@earendil-works/pi-agent-core']]) {
  packageAt(path, {name, version:'0.0.0', scripts:{prepack:'node -e "process.exit(1)"'}});
 }
 writeFileSync(join(source, 'package.json'), JSON.stringify({name:'jouzu', version:'0.0.0', bundleDependencies:['@earendil-works/pi-coding-agent','pi-webaio']}));
 defuddleFixture(source);
 mkdirSync(join(source, 'dist'));
 writeFileSync(join(source, 'dist/cli.js'), 'fixture');
 const output = join(root, 'recipe');
 const recipe = exportRecipe(source, output);
 assert.equal(recipe.packageManager, `pnpm@${PNPM_VERSION}`);
 assert.deepEqual(JSON.parse(readFileSync(join(output, 'package.json'), 'utf8')), recipe);
 assert.ok(recipe.dependencies.jouzu.startsWith('file:artifacts/'));
 assert.ok(recipe.pnpm.overrides.defuddle?.startsWith('file:artifacts/'));
 assert.ok(readdirSync(join(output, 'artifacts')).some(name => name.startsWith('defuddle-')));
});

test('older releases without a patched defuddle still export', t => {
 const root = mkdtempSync(join(tmpdir(), 'jouzu-export-legacy-'));
 t.after(() => rmSync(root, {recursive:true, force:true}));
 const source = join(root, 'source');
 const coding = join(source, 'node_modules/@earendil-works/pi-coding-agent');
 const core = join(coding, 'node_modules/@earendil-works/pi-agent-core');
 for (const [path, name] of [[source, 'jouzu'], [coding, '@earendil-works/pi-coding-agent'], [core, '@earendil-works/pi-agent-core']]) packageAt(path, {name, version:'0.0.0'});
 mkdirSync(join(source, 'dist'));
 writeFileSync(join(source, 'dist/cli.js'), 'fixture');
 const recipe = exportRecipe(source, join(root, 'recipe'));
 assert.equal(recipe.pnpm.overrides.defuddle, undefined);
});

test('export uses coding-agent nested core, not a different root dependency',()=>{
 const root=mkdtempSync(join(tmpdir(),'jouzu-export-'));
 const coding=join(root,'node_modules/@earendil-works/pi-coding-agent');
 const nested=join(coding,'node_modules/@earendil-works/pi-agent-core');
 const top=join(root,'node_modules/@earendil-works/pi-agent-core');
 try{
  for(const [path,name] of [[coding,'@earendil-works/pi-coding-agent'],[nested,'@earendil-works/pi-agent-core'],[top,'@earendil-works/pi-agent-core']]){
   packageAt(path,{name});
  }
  assert.equal(exportPackageRoot(root,'@earendil-works/pi-agent-core'),realpathSync(nested));
  rmSync(nested,{recursive:true});
  assert.equal(exportPackageRoot(root,'@earendil-works/pi-agent-core'),realpathSync(top));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('runtime verification rejects an installed defuddle without the diagnostics sidecar', t => {
 const root = mkdtempSync(join(tmpdir(), 'jouzu-verify-defuddle-'));
 t.after(() => rmSync(root, {recursive:true, force:true}));
 const app = join(root, 'app');
 packageAt(join(app, 'node_modules/jouzu'), {name:'jouzu'});
 const { webaio, defuddle } = defuddleFixture(app);
 mkdirSync(join(webaio, 'dist/src'), {recursive:true});
 writeFileSync(join(webaio, 'dist/src/webfetch-api.js'), 'require("defuddle/jouzu-diagnostics.cjs")');
 assert.doesNotThrow(() => assertDefuddleSidecar(app));
 rmSync(join(defuddle, 'dist/jouzu-diagnostics.cjs'));
 assert.throws(() => assertDefuddleSidecar(app), /sidecar is missing/);
});
