import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signRecipe} from './sign-recipe.mjs';
import {authenticateRecipe} from './authenticate-recipe.mjs';
test('signed recipe uses the installed client authentication contract',t=>{
 const root=mkdtempSync(join(tmpdir(),'jouzu-recipe-sign-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'artifacts'));writeFileSync(join(root,'package.json'),'{}');writeFileSync(join(root,'pnpm-lock.yaml'),'lockfileVersion: 9');writeFileSync(join(root,'artifacts/jouzu.tgz'),'fixture');
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 signRecipe({recipe:root,version:'0.1.18',privateKey:privateKey.export({type:'pkcs8',format:'pem'})});
 const bytes=readFileSync(join(root,'manifest.json')),signature=readFileSync(join(root,'manifest.sig'));
 const result=authenticateRecipe(bytes,signature,publicKey.export({type:'spki',format:'pem'}),{version:'0.1.18',platform:'win32',arch:'x64',maxBytes:1024});
 assert.equal(result.version,'0.1.18');assert.equal(result.files.length,3);
});

test('release notes travel inside the signed recipe manifest',t=>{
 const root=mkdtempSync(join(tmpdir(),'jouzu-recipe-notes-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'artifacts'));writeFileSync(join(root,'package.json'),'{}');writeFileSync(join(root,'pnpm-lock.yaml'),'lockfileVersion: 9');writeFileSync(join(root,'artifacts/jouzu.tgz'),'fixture');
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 signRecipe({recipe:root,version:'0.1.18',privateKey:privateKey.export({type:'pkcs8',format:'pem'}),notes:{notes:'- A change.',notesSource:'shisa-ai/jouzu@50e58c3 CHANGELOG.md'}});
 const bytes=readFileSync(join(root,'manifest.json')),signature=readFileSync(join(root,'manifest.sig'));
 const result=authenticateRecipe(bytes,signature,publicKey.export({type:'spki',format:'pem'}),{version:'0.1.18',platform:'win32',arch:'x64',maxBytes:1024});
 assert.equal(result.notes,'- A change.');
 assert.equal(result.notesSource,'shisa-ai/jouzu@50e58c3 CHANGELOG.md');
});
