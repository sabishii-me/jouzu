import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { updateConfiguration } from './update-configuration.mjs';
const recipePublicKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
const launcherPublicKey=Buffer.from('untrusted comment: test\nfixture').toString('base64');
test('uses separate component feeds in the build repository',()=>{
 for(const repository of ['example/fork','example/product']){
  const config=updateConfiguration({repository,launcherPublicKey,recipePublicKey,recipeBaseUrl:'https://updates.example.com/jouzu/'});
  assert.equal(new URL(config.launcher.plugins.updater.endpoints[0]).protocol,'https:');
  assert.equal(config.launcher.plugins.updater.endpoints[0],`https://github.com/${repository}/releases/download/launcher-update/latest.json`);
  assert.equal(config.jouzu.url,'https://updates.example.com/jouzu/');
  assert.equal(config.launcher.plugins.updater.windows.installMode,'quiet');
 }
});
test('rejects missing keys and malformed repository names',()=>{
 for(const repository of ['','https://example/repo','../repo','owner/repo/extra'])assert.throws(()=>updateConfiguration({repository,launcherPublicKey,recipePublicKey,recipeBaseUrl:'https://updates.example.com/jouzu/'}));
 assert.throws(()=>updateConfiguration({repository:'owner/repo',launcherPublicKey:'',recipePublicKey}));
});
