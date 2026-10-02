import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {signingPreflight} from './signing-preflight.mjs';
function config(){const k=generateKeyPairSync('ed25519');return {GITHUB_REPOSITORY:'owner/repo',LAUNCHER_PUBLIC_KEY:Buffer.from('untrusted comment: fixture\nfixture').toString('base64'),JOUZU_RECIPE_BASE_URL:'https://github.com/owner/repo/releases/download/jouzu-update/',JOUZU_RECIPE_PUBLIC_KEY:k.publicKey.export({type:'spki',format:'pem'}),JOUZU_RECIPE_PRIVATE_KEY:k.privateKey.export({type:'pkcs8',format:'pem'})};}
test('Jouzu release needs no Azure or Launcher private key',()=>{assert.equal(signingPreflight(config(),'jouzu').component,'jouzu');});
test('reports missing names without disclosing values',()=>{assert.throws(()=>signingPreflight({},'jouzu'),/Missing configuration: GITHUB_REPOSITORY/);});
test('rejects mismatched signing identity before building',()=>{const env=config();env.JOUZU_RECIPE_PRIVATE_KEY=config().JOUZU_RECIPE_PRIVATE_KEY;assert.throws(()=>signingPreflight(env,'jouzu'),/does not match/);});
test('Launcher signing requires its own Azure identity',()=>{assert.throws(()=>signingPreflight(config(),'launcher'),/AZURE_CLIENT_ID/);});
