import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { Progress } from './components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import type { Locale } from './i18n';
const text = {
 en:['Updates','Keep Jouzu and the launcher up to date.','Check for updates','Launcher','Current version','Available','Up to date','Update Jouzu','Update and restart','Checking…','Downloading…','Installing…','Updated','Could not check for updates','Retry','The launcher restarts after updating.','Preview only · no files or applications will be changed','Both available','No updates','Check failed','Download fails'],
 ja:['更新','Jouzu とランチャーを最新の状態に保ちます。','更新を確認','ランチャー','現在のバージョン','更新先','最新です','Jouzu を更新','更新して再起動','確認中…','ダウンロード中…','インストール中…','更新しました','更新を確認できませんでした','再試行','更新後にランチャーを再起動します。','プレビューのみ · ファイルやアプリは変更されません','両方に更新あり','更新なし','確認に失敗','ダウンロード失敗'],
 'zh-Hans':['更新','让 Jouzu 和启动器保持最新。','检查更新','启动器','当前版本','可更新至','已是最新','更新 Jouzu','更新并重启','正在检查…','正在下载…','正在安装…','更新完成','暂时无法检查更新','重试','更新后将重新启动启动器。','仅交互预览 · 不会修改文件或安装应用','两项均有更新','没有更新','检查失败','下载失败'],
 'zh-Hant':['更新','讓 Jouzu 和啟動器保持最新。','檢查更新','啟動器','目前版本','可更新至','已是最新','更新 Jouzu','更新並重新啟動','正在檢查…','正在下載…','正在安裝…','更新完成','暫時無法檢查更新','重試','更新後將重新啟動啟動器。','僅互動預覽 · 不會修改檔案或安裝應用','兩項均有更新','沒有更新','檢查失敗','下載失敗'],
};
type Phase='available'|'current'|'checking'|'downloading'|'installing'|'complete'|'error';
export function UpdatePreview({locale}:{locale:Locale}) {
 const t=text[locale];const [scenario,setScenario]=useState('available');
 const [phases,setPhases]=useState<Phase[]>(['available','available']);
 const [versions,setVersions]=useState(['0.1.17','0.1.20']);const targets=['0.1.18','0.1.21'];
 const [progress,setProgress]=useState(0);const timers=useRef<ReturnType<typeof setTimeout>[]>([]);
 const generation=useRef(0);
 function clear(){generation.current++;timers.current.forEach(clearTimeout);timers.current=[];}
 useEffect(()=>()=>clear(),[]);
 function later(fn:()=>void,delay:number){const id=generation.current;timers.current.push(setTimeout(()=>{if(id===generation.current)fn();},delay));}
 function phase(index:number,p:Phase){setPhases(old=>old.map((v,i)=>i===index?p:v));}
 function reset(value:string){clear();setScenario(value);setVersions(['0.1.17','0.1.20']);setProgress(0);setPhases(value==='current'?['current','current']:value==='error'?['error','error']:['available','available']);}
 function check(){setPhases(['checking','checking']);later(()=>setPhases(scenario==='error'?['error','error']:versions.map((v,i)=>scenario==='current'||v===targets[i]?'current':'available')),850);}
 function install(index:number){phase(index,'downloading');setProgress(0);for(let step=1;step<=10;step++)later(()=>{setProgress(step*10);if(step===5&&scenario==='fail'){clear();phase(index,'error');}else if(step===10){phase(index,'installing');later(()=>{setVersions(old=>old.map((v,i)=>i===index?targets[i]:v));phase(index,'complete');},900);}},step*180);}
 const busy=phases.some(p=>['checking','downloading','installing'].includes(p));
 return <div className="space-y-6">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{t[0]}</h2><p className="mt-1 text-sm text-muted-foreground">{t[1]}</p></div><Button variant="outline" className="text-sm" disabled={busy} onClick={check}>{phases.includes('checking')?t[9]:t[2]}</Button></div>
  <div className="divide-y divide-border rounded-lg border border-border px-5">{phases.map((p,i)=><section key={i} className="py-5 space-y-3">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{i===0?'Jouzu':t[3]}</h3><p className="mt-1 text-sm text-muted-foreground">{t[4]} {versions[i]}</p></div>
    {p==='available'?<Button disabled={busy} onClick={()=>install(i)}>{i===0?t[7]:t[8]}</Button>:p==='error'?<Button variant="outline" disabled={busy} onClick={()=>scenario==='fail'?install(i):check()}>{t[14]}</Button>:<span role="status" className="text-sm text-muted-foreground">{p==='current'?t[6]:p==='complete'?t[12]:p==='checking'?t[9]:p==='downloading'?t[10]:t[11]}</span>}
   </div>
   {p==='available'&&<p className="text-sm text-muted-foreground">{t[5]} {targets[i]}{i===1?` · ${t[15]}`:''}</p>}
   {p==='error'&&<p role="alert" className="text-sm text-destructive">{scenario==='fail'?({en:'Download failed. Your current version is unchanged.',ja:'ダウンロードに失敗しました。現在のバージョンは変更されていません。','zh-Hans':'下载失败，当前版本未改变。','zh-Hant':'下載失敗，目前版本未變更。'}[locale]):t[13]}</p>}
   {(p==='downloading'||p==='installing')&&<Progress value={p==='downloading'?progress:undefined}/>}
  </section>)}</div>
  <aside className="border-t border-dashed border-border pt-4 space-y-2"><p className="text-xs text-muted-foreground">{t[16]}</p><Select value={scenario} onValueChange={reset}><SelectTrigger className="w-56" aria-label={t[16]}><SelectValue/></SelectTrigger><SelectContent>{['available','current','error','fail'].map((value,i)=><SelectItem key={value} value={value}>{t[17+i]}</SelectItem>)}</SelectContent></Select></aside>
 </div>;
}
