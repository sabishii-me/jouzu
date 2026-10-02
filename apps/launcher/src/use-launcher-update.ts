import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
export function useLauncherUpdate(configured: boolean) {
 const candidate = useRef<Update | null>(null);
 const [version,setVersion]=useState<string|null>(null);
 const [notes,setNotes]=useState<string|null>(null);
 const [phase,setPhase]=useState<"idle"|"checking"|"current"|"available"|"downloading"|"installing"|"error">("idle");
 const [progress,setProgress]=useState<number|undefined>();
 const [error,setError]=useState<string|null>(null);
 const lock=useRef(false);
 async function refresh() {
  if(!configured || lock.current)return;
  lock.current=true;setError(null);setPhase("checking");
  try {
   await candidate.current?.close();candidate.current=null;setVersion(null);setNotes(null);
   const update=await check({timeout:20000});candidate.current=update;
   setVersion(update?.version ?? null);setNotes(update?.body ?? null);setPhase(update ? "available":"current");
  }catch(e){setError(String(e));setPhase("error");}finally{lock.current=false;}
 }
 async function install() {
  if(!candidate.current || lock.current)return;
  lock.current=true;setError(null);setProgress(undefined);setPhase("downloading");
  let downloaded=0,total=0;
  try {
   await candidate.current.download(event=>{
    if(event.event==="Started")total=event.data.contentLength ?? 0;
    if(event.event==="Progress")downloaded+=event.data.chunkLength;
    if(total>0)setProgress(Math.min(100,downloaded/total*100));
   });
   setPhase("installing");
   await candidate.current.install({restartAfterInstall:true});
  }catch(e){setError(String(e));setPhase("error");}finally{lock.current=false;}
 }
 useEffect(()=>{ if(configured)void refresh(); },[configured]);
 return {version,notes,phase,progress,error,refresh,install,busy:phase==="checking"||phase==="downloading"||phase==="installing"};
}
