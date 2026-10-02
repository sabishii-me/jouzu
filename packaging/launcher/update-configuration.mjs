import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey } from 'node:crypto';

export function updateConfiguration({repository, launcherPublicKey, recipePublicKey, recipeBaseUrl}) {
 if(typeof repository!=='string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split('/').some(x=>x==='.'||x==='..')) throw new Error('Invalid release repository');
 if(typeof launcherPublicKey!=='string' || !launcherPublicKey.trim()) throw new Error('Missing Launcher public key');
 const decoded=Buffer.from(launcherPublicKey,'base64').toString('utf8');
 if(!decoded.startsWith('untrusted comment:') || !decoded.includes('\n')) throw new Error('Invalid Launcher public key');
 if(createPublicKey(recipePublicKey).asymmetricKeyType!=='ed25519') throw new Error('Recipe key must be Ed25519');
 const recipeUrl=new URL(recipeBaseUrl);
 if(recipeUrl.protocol!=='https:' || recipeUrl.username || recipeUrl.password || recipeUrl.search || recipeUrl.hash || !recipeUrl.pathname.endsWith('/')) throw new Error('Recipe source requires a directory HTTPS URL');
 const root=`https://github.com/${repository}/releases/download`;
 return {
  launcher:{plugins:{updater:{pubkey:launcherPublicKey,endpoints:[`${root}/launcher-update/latest.json`],windows:{installMode:'quiet'}}}},
  jouzu:{schemaVersion:1,url:recipeUrl.href,publicKey:recipePublicKey},
 };
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [output]=process.argv.slice(2);
 if(!output) throw new Error('Usage: node update-configuration.mjs <existing-output-directory>');
 const config=updateConfiguration({repository:process.env.GITHUB_REPOSITORY,launcherPublicKey:process.env.LAUNCHER_PUBLIC_KEY,recipePublicKey:process.env.JOUZU_RECIPE_PUBLIC_KEY,recipeBaseUrl:process.env.JOUZU_RECIPE_BASE_URL});
 writeFileSync(resolve(output,'tauri-updater.json'),JSON.stringify(config.launcher,null,2)+'\n');
 writeFileSync(resolve(output,'jouzu-update.json'),JSON.stringify(config.jouzu,null,2)+'\n');
}
