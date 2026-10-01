import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authenticateRecipe } from './authenticate-recipe.mjs';
import { installJouzuUpdate } from './install-update.mjs';

// Backend-only JSON bridge. No URLs/keys supplied by renderer or command line.
const [install,managed,action]=process.argv.slice(2);
try {
 const config=JSON.parse(readFileSync(join(install,'jouzu-update.json'),'utf8'));
 if(!['check','install'].includes(action))throw Error('Invalid update action');
 const base=new URL(config.url);
 const local=config.allowLoopbackHttp===true && base.protocol==='http:' && ['127.0.0.1','[::1]'].includes(base.hostname);
 if(base.protocol!=='https:'&&!local)throw Error('Update source requires HTTPS');
 if(base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/'))throw Error('Invalid update source');
 async function fetchSmall(name,limit){
  const response=await fetch(new URL(name,base),{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok||!response.body)throw Error('Update source unavailable');
  const reader=response.body.getReader();let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Invalid update metadata');chunks.push(value);}}finally{await reader.cancel();}
  return Buffer.concat(chunks,size);
 }
 const bytes=await fetchSmall('manifest.json',1024*1024);const signature=await fetchSmall('manifest.sig',64);
 // Untrusted version is only a validation input; never used for a path or execution.
 const version=JSON.parse(bytes.toString('utf8')).version;
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid release version');
 authenticateRecipe(bytes,signature,config.publicKey,{version,platform:process.platform,arch:process.arch,maxBytes:512*1024*1024});
 if(action==='check')console.log(JSON.stringify({version}));
 else{
  const requested=JSON.parse(readFileSync(0,'utf8'));
  if(requested.version!==version)throw Error('Release changed; check again');
  const result=await installJouzuUpdate({managed,runtime:join(install,'runtime'),url:config.url,publicKey:config.publicKey,version,allowLoopbackHttp:local,onProgress:event=>process.stderr.write(JSON.stringify(event)+'\n')});
  console.log(JSON.stringify({version:result.version}));
 }
}catch(error){
 // Package or network errors may contain credential-bearing URLs; never echo them.
 console.log(JSON.stringify({error:'Jouzu update failed. Check the update source, permissions and available disk space; the active version was not intentionally removed.'}));
 process.exitCode=1;
}
