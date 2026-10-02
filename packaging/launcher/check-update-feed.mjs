import { readFileSync } from 'node:fs';
import { authenticateRecipe } from './authenticate-recipe.mjs';

/** The published npm version and the signed Windows update artifact must agree, so a
 * release can never be published without an installable update. */
export async function checkUpdateFeed({ registry = 'https://registry.npmjs.org', recipeBaseUrl, publicKey, fetchImpl = fetch }) {
 if (!/^https:\/\//.test(recipeBaseUrl) || !recipeBaseUrl.endsWith('/')) throw new Error('Recipe base URL must be an HTTPS directory URL ending in /');
 const latest = await fetchImpl(`${registry}/jouzu/latest`, { redirect: 'follow' });
 if (!latest.ok) throw new Error(`Cannot read the published npm version (${latest.status})`);
 const { version } = await latest.json();
 if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Published npm version is not a release version');
 const manifest = await fetchImpl(`${recipeBaseUrl}manifest.json`, { redirect: 'follow' });
 if (!manifest.ok) throw new Error(`Cannot read the update manifest (${manifest.status})`);
 const signature = await fetchImpl(`${recipeBaseUrl}manifest.sig`, { redirect: 'follow' });
 if (!signature.ok) throw new Error(`Cannot read the update signature (${signature.status})`);
 const signed = authenticateRecipe(Buffer.from(await manifest.arrayBuffer()), Buffer.from(await signature.arrayBuffer()), publicKey, { version, platform: 'win32', arch: 'x64', maxBytes: 512 * 1024 * 1024 });
 if (signed.version !== version) throw new Error('Signed update version does not match the published npm version');
 return { version, files: signed.files.length };
}

if (process.argv[1]?.endsWith('check-update-feed.mjs')) {
 try {
  const result = await checkUpdateFeed({ recipeBaseUrl: process.env.JOUZU_RECIPE_BASE_URL, publicKey: process.env.JOUZU_RECIPE_PUBLIC_KEY });
  console.log(`Update feed matches published jouzu@${result.version} (${result.files} files)`);
 } catch (error) {
  console.error(error.message);
  process.exitCode = 1;
 }
}
