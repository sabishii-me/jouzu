import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {signingPreflight} from './signing-preflight.mjs';
function config(){const k=generateKeyPairSync('ed25519');return {GITHUB_REPOSITORY:'owner/repo',LAUNCHER_PUBLIC_KEY:Buffer.from('untrusted comment: fixture\nfixture').toString('base64'),JOUZU_RECIPE_BASE_URL:'https://github.com/owner/repo/releases/download/jouzu-update/',JOUZU_RECIPE_PUBLIC_KEY:k.publicKey.export({type:'spki',format:'pem'}),JOUZU_RECIPE_PRIVATE_KEY:k.privateKey.export({type:'pkcs8',format:'pem'})};}
test('Jouzu release needs no Azure or Launcher private key',()=>{assert.equal(signingPreflight(config(),'jouzu').component,'jouzu');});
test('reports missing names without disclosing values',()=>{assert.throws(()=>signingPreflight({},'jouzu'),/Missing configuration: GITHUB_REPOSITORY/);});
test('rejects mismatched signing identity before building',()=>{const env=config();env.JOUZU_RECIPE_PRIVATE_KEY=config().JOUZU_RECIPE_PRIVATE_KEY;assert.throws(()=>signingPreflight(env,'jouzu'),/does not match/);});
test('Launcher signing requires its own Azure identity',()=>{assert.throws(()=>signingPreflight(config(),'launcher'),/AZURE_CLIENT_ID/);});

test('a byte-order mark on an Azure variable does not fail the release preflight',()=>{
 const base={...config(),TAURI_SIGNING_PRIVATE_KEY:'key',AZURE_CLIENT_ID:'c72d348b-4b36-4268-88ae-b67b90435ff3',AZURE_TENANT_ID:'a8755d96-ccdf-4326-88d3-df2649876ba0',AZURE_SUBSCRIPTION_ID:'8fef6f04-8541-4c8b-b7ed-0623b493d1d9',AZURE_SIGNING_ENDPOINT:'https://eus.codesigning.azure.net/',AZURE_SIGNING_ACCOUNT:'jouzu-signing',AZURE_SIGNING_PROFILE:'Jouzu',EXPECTED_SIGNER:'CN="Shisa, Inc."'};
 const bom=name=>'\ufeff'+base[name];
 assert.doesNotThrow(()=>signingPreflight({...base,AZURE_CLIENT_ID:bom('AZURE_CLIENT_ID'),AZURE_TENANT_ID:bom('AZURE_TENANT_ID'),AZURE_SUBSCRIPTION_ID:bom('AZURE_SUBSCRIPTION_ID'),AZURE_SIGNING_ENDPOINT:bom('AZURE_SIGNING_ENDPOINT')},'launcher'));
 assert.throws(()=>signingPreflight({...base,AZURE_CLIENT_ID:'not-a-guid'},'launcher'),/Invalid AZURE_CLIENT_ID/);
});
