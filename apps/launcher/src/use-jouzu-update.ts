import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export function useJouzuUpdate(configured:boolean, onInstalled:()=>void) {
 const [version,setVersion]=useState<string|null>(null);
 const [notes,setNotes]=useState<string|null>(null);
 const [notesSource,setNotesSource]=useState<string|null>(null);
 const [phase,setPhase]=useState('idle');
 const [error,setError]=useState<string|null>(null);
 const [progress,setProgress]=useState<number|undefined>();
 const lock=useRef(false);
 useEffect(()=>{const event=listen<{phase:string;downloaded?:number;total?:number}>('jouzu-update-progress',({payload})=>{
  if(!lock.current)return;
  setPhase(payload.phase);setProgress(payload.total ? (payload.downloaded??0)/payload.total*100:undefined);
 });return ()=>{void event.then(unlisten=>unlisten()).catch(()=>{});};},[]);
 async function run(action:'check'|'install') {
  if(!configured || lock.current)return;lock.current=true;setError(null);setPhase(action==='check'?'checking':'downloading');
  try{
   const result=await invoke<{version:string;available:boolean;notes?:string;notesSource?:string}>('jouzu_update',{action,version:action==='install'?version:null});
   if(action==='check'){setVersion(result.available?result.version:null);setNotes(result.notes??null);setNotesSource(result.notesSource??null);setPhase(result.available?'available':'current');}
   else{setVersion(null);setPhase('complete');onInstalled();}
  }catch(e){setError(String(e));setPhase('error');}finally{lock.current=false;}
 }
 useEffect(()=>{if(configured)void run('check');},[configured]);
 return {version,notes,notesSource,phase,error,progress,busy:!['idle','available','current','complete','error'].includes(phase),check:()=>run('check'),install:()=>run('install')};
}
