import { createPublicKey } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { updateConfiguration } from './update-configuration.mjs';

export function signingPreflight(env, component) {
 if(!['jouzu','launcher'].includes(component))throw new Error('Expected jouzu or launcher');
 const required=['GITHUB_REPOSITORY','JOUZU_RECIPE_PUBLIC_KEY','JOUZU_RECIPE_BASE_URL','LAUNCHER_PUBLIC_KEY'];
 if(component==='jouzu')required.push('JOUZU_RECIPE_PRIVATE_KEY');
 else required.push('TAURI_SIGNING_PRIVATE_KEY','AZURE_CLIENT_ID','AZURE_TENANT_ID','AZURE_SUBSCRIPTION_ID','AZURE_SIGNING_ENDPOINT','AZURE_SIGNING_ACCOUNT','AZURE_SIGNING_PROFILE','EXPECTED_SIGNER');
 const missing=required.filter(name=>!env[name]?.trim());
 if(missing.length)throw new Error(`Missing configuration: ${missing.join(', ')}`);
 updateConfiguration({repository:env.GITHUB_REPOSITORY,launcherPublicKey:env.LAUNCHER_PUBLIC_KEY,recipePublicKey:env.JOUZU_RECIPE_PUBLIC_KEY,recipeBaseUrl:env.JOUZU_RECIPE_BASE_URL});
 if(component==='jouzu') {
  try {
   const expected=createPublicKey(env.JOUZU_RECIPE_PUBLIC_KEY).export({type:'spki',format:'der'});
   const actual=createPublicKey(env.JOUZU_RECIPE_PRIVATE_KEY).export({type:'spki',format:'der'});
   if(!actual.equals(expected))throw new Error('mismatch');
  } catch {throw new Error('Jouzu signing key does not match configured public key');}
 } else {
  // Trim before matching: a variable written by a Windows PowerShell pipeline can arrive with a
  // leading byte-order mark, which would otherwise read as an invalid identifier.
  for(const name of ['AZURE_CLIENT_ID','AZURE_TENANT_ID','AZURE_SUBSCRIPTION_ID'])if(!/^[a-f0-9-]{36}$/i.test(env[name]?.trim()??''))throw new Error(`Invalid ${name}`);
  const url=new URL(env.AZURE_SIGNING_ENDPOINT?.trim()??'');
  if(url.protocol!=='https:' || !/^[a-z0-9-]+\.codesigning\.azure\.net$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname!=='/')throw new Error('Invalid Azure signing endpoint');
 }
 return {component,repository:env.GITHUB_REPOSITORY};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {console.log(JSON.stringify(signingPreflight(process.env,process.argv[2])));}
 catch(error) {console.error(error.message);process.exitCode=1;}
}
