import { createHash, sign, createPrivateKey, createPublicKey } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateRecipe } from './authenticate-recipe.mjs';

export function signRecipe({recipe,version,privateKey,notes}) {
 const key=createPrivateKey(privateKey);
 if(key.asymmetricKeyType!=='ed25519') throw new Error('Recipe signing requires Ed25519');
 const files=[];
 for(const name of ['package.json','pnpm-lock.yaml','artifacts','patches']) {
  const path=join(recipe,name);
  let stat;
  try {stat=lstatSync(path);} catch(error) {if(error.code==='ENOENT' && name==='patches') continue;throw error;}
  if(stat.isSymbolicLink()) throw new Error('Recipe inputs must not be linked');
  const names=stat.isDirectory()?readdirSync(path).sort().map(child=>`${name}/${child}`):[name];
  for(const relative of names) {
   const file=join(recipe,relative);
   if(!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('Expected regular recipe file');
   const bytes=readFileSync(file);
   files.push({path:relative,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
 }
 const described = notes && typeof notes.notes==='string' ? {notes:notes.notes,notesSource:String(notes.notesSource??'')} : {};
 const manifest=Buffer.from(JSON.stringify({schemaVersion:1,version,platform:'win32',arch:'x64',...described,files})+'\n');
 const signature=sign(null,manifest,key);
 authenticateRecipe(manifest,signature,createPublicKey(key).export({type:'spki',format:'pem'}),{version,platform:'win32',arch:'x64',maxBytes:512*1024*1024});
 writeFileSync(join(recipe,'manifest.json'),manifest);
 writeFileSync(join(recipe,'manifest.sig'),signature);
 return {version,files:files.length};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [recipe,version,keyFile,notesFile]=process.argv.slice(2);
 if(!keyFile) throw new Error('Usage: node sign-recipe.mjs <recipe> <version> <private-key-file> [notes-file]');
 signRecipe({recipe,version,privateKey:readFileSync(keyFile),notes:notesFile?JSON.parse(readFileSync(notesFile,'utf8')):undefined});
}
