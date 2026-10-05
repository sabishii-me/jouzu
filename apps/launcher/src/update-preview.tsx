import { Download, RefreshCw, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from './components/ui/dialog';
import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { Progress } from './components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import type { Locale } from './i18n';
const text = {
 en:['System','Jouzu, the launcher, and the tools they need.','Check for updates','Launcher','Current version','Available','Up to date','Update Jouzu','Update and restart','Checking…','Downloading…','Installing…','Updated','Could not check for updates','Retry','The launcher restarts after updating.','Preview only · no files or applications will be changed','Both available','No updates','Check failed','Download fails'],
 ja:['システム','Jouzu、ランチャー、および必要なツールの状態です。','更新を確認','ランチャー','現在のバージョン','更新先','最新です','Jouzu を更新','更新して再起動','確認中…','ダウンロード中…','インストール中…','更新しました','更新を確認できませんでした','再試行','更新後にランチャーを再起動します。','プレビューのみ · ファイルやアプリは変更されません','両方に更新あり','更新なし','確認に失敗','ダウンロード失敗'],
 'zh-Hans':['系统','查看 Jouzu、启动器以及所需工具的状态。','检查更新','启动器','当前版本','可更新至','已是最新','更新 Jouzu','更新并重启','正在检查…','正在下载…','正在安装…','更新完成','暂时无法检查更新','重试','更新后将重新启动启动器。','仅交互预览 · 不会修改文件或安装应用','两项均有更新','没有更新','检查失败','下载失败'],
 'zh-Hant':['系統','查看 Jouzu、啟動器以及所需工具的狀態。','檢查更新','啟動器','目前版本','可更新至','已是最新','更新 Jouzu','更新並重新啟動','正在檢查…','正在下載…','正在安裝…','更新完成','暫時無法檢查更新','重試','更新後將重新啟動啟動器。','僅互動預覽 · 不會修改檔案或安裝應用','兩項均有更新','沒有更新','檢查失敗','下載失敗'],
};
type Phase='available'|'current'|'checking'|'downloading'|'installing'|'complete'|'error'|'idle';
export interface UpdateViewState {
 phases: Phase[]; versions: string[]; targets: (string|null)[]; progress?: number;
 configured: boolean[]; errors: (string|null)[]; notes: string[]; sources: string[]; check:()=>void; install:(index:number)=>void;
}
const noteText={en:["What's new",'Source:','No description was published for this version.'],ja:['変更点','出典:','このバージョンの説明は公開されていません。'],'zh-Hans':['更新内容','来源：','此版本未发布说明。'],'zh-Hant':['更新內容','來源：','此版本未發布說明。']};
const mockNotes=['- Fixed a startup failure after a Jouzu update.\n- Git Bash is prepared during installation.','- Launcher updates install only launcher-owned files and no longer require closing a running session.'];
export function UpdatePreview({locale,live}:{locale:Locale;live?:UpdateViewState}) {
 const t=text[locale];const [scenario,setScenario]=useState('available');
 const [mockPhases,setPhases]=useState<Phase[]>(['available','available']);
 const [mockVersions,setVersions]=useState(['0.1.17','0.1.20']);const targets=live?.targets ?? ['0.1.18','0.1.21'];
 const versions=live?.versions ?? mockVersions; const phases=live?.phases ?? mockPhases;
 const notes=live?.notes ?? mockNotes; const sources=live?.sources ?? ['',''];
 const [confirmRestart,setConfirmRestart]=useState(false);
 const cancel={en:'Cancel',ja:'キャンセル','zh-Hans':'取消','zh-Hant':'取消'}[locale];
 const [mockProgress,setProgress]=useState(0);const timers=useRef<ReturnType<typeof setTimeout>[]>([]);
 const generation=useRef(0);
 const failed=useRef(false);
 const extras={en:['Jouzu only','Launcher only','Downloading','Installing'],ja:['Jouzu のみ','ランチャーのみ','ダウンロード中','インストール中'],'zh-Hans':['仅 Jouzu 有更新','仅启动器有更新','下载中','安装中'],'zh-Hant':['僅 Jouzu 有更新','僅啟動器有更新','下載中','安裝中']}[locale];
 function clear(){generation.current++;timers.current.forEach(clearTimeout);timers.current=[];}
 useEffect(()=>()=>clear(),[]);
 function later(fn:()=>void,delay:number){const id=generation.current;timers.current.push(setTimeout(()=>{if(id===generation.current)fn();},delay));}
 function phase(index:number,p:Phase){setPhases(old=>old.map((v,i)=>i===index?p:v));}
 function reset(value:string){clear();setConfirmRestart(false);failed.current=value==='fail';setScenario(value);setVersions(value==='current'?['0.1.18','0.1.21']:value==='jouzu'?['0.1.17','0.1.21']:value==='launcher'?['0.1.18','0.1.20']:['0.1.17','0.1.20']);setProgress(value==='downloading'?45:0);setPhases(value==='downloading'?['downloading','available']:value==='installing'?['installing','available']:value==='fail'?['error','available']:value==='current'?['current','current']:value==='error'?['error','error']:value==='jouzu'?['available','current']:value==='launcher'?['current','available']:['available','available']);}
 const progress=live?live.progress:mockProgress;
 function check(){if(live){live.check();return;}setPhases(['checking','checking']);later(()=>setPhases(versions.map((v,i)=>v===targets[i]?'current':'available')),850);}
 function install(index:number){if(live){live.install(index);return;}phase(index,'downloading');setProgress(0);for(let step=1;step<=10;step++)later(()=>{setProgress(step*10);if(step===5&&scenario==='fail'&&!failed.current){failed.current=true;clear();phase(index,'error');}else if(step===10){phase(index,'installing');later(()=>{setVersions(old=>old.map((v,i)=>i===index?(targets[i]??v):v));phase(index,'complete');},900);}},step*180);}
 const busy=phases.some(p=>['checking','downloading','installing'].includes(p));
 const noteItems=(value:string)=>value.split('\n').map(line=>line.trim()).filter(Boolean).map((line,index)=>line.startsWith('### ')?<li key={index} className="text-xs font-medium text-muted-foreground">{line.slice(4)}</li>:line.startsWith('- ')?<li key={index} className="flex gap-2 text-xs text-muted-foreground"><span aria-hidden="true">•</span><span>{line.slice(2)}</span></li>:<li key={index} className="text-xs text-muted-foreground">{line}</li>);
 return <div className="space-y-6">
  <Dialog open={confirmRestart} onOpenChange={setConfirmRestart}><DialogContent className="sm:max-w-sm"><DialogTitle>{t[8]}</DialogTitle><DialogDescription>{t[15]}</DialogDescription><div className="flex justify-end gap-2"><DialogClose asChild><Button variant="outline">{cancel}</Button></DialogClose><Button onClick={()=>{setConfirmRestart(false);install(1);}}>{t[8]}</Button></div></DialogContent></Dialog>
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{t[0]}</h2><p className="mt-1 text-sm text-muted-foreground">{t[1]}</p></div><Button variant="ghost" className="h-9 w-9 p-0" aria-label={t[2]} title={t[2]} disabled={busy} onClick={check}><RefreshCw className={`size-4 ${phases.includes("checking")?"animate-spin":""}`} /></Button></div>
  <div className="divide-y divide-border rounded-lg border border-border px-5">{phases.map((p,i)=><section key={i} className="flex h-44 flex-col gap-2 py-4 sm:h-36">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{i===0?'Jouzu':t[3]}</h3><p className="mt-1 text-sm text-muted-foreground">{t[4]} {versions[i]}</p></div>
    {p==='available'?<Button className="h-9 w-9 p-0" aria-label={i===0?t[7]:t[8]} title={i===0?t[7]:t[8]} disabled={busy} onClick={()=>i===0?install(i):setConfirmRestart(true)}><Download className="size-4" /></Button>:p==='error'?<Button variant="outline" className="h-9 w-9 p-0" aria-label={t[14]} title={t[14]} disabled={busy} onClick={()=>(live?!!targets[i]:scenario==='fail')?(i===0?install(i):setConfirmRestart(true)):check()}><RefreshCw className="size-4" /></Button>:<span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">{["checking","downloading","installing"].includes(p)&&<LoaderCircle className="size-4 animate-spin"/>}{p==='current'?t[6]:p==='complete'?t[12]:p==='checking'?t[9]:p==='downloading'?t[10]:p==='installing'?t[11]:''}</span>}
   </div>
   <div className="min-h-8 space-y-2">
   {live && !live.configured[i] && <p className="text-sm text-muted-foreground">{{en:'Online updates are unavailable for this version.',ja:'このバージョンではオンライン更新を利用できません。','zh-Hans':'此版本暂不支持在线更新。','zh-Hant':'此版本暫不支援線上更新。'}[locale]}</p>}
   {p==='available'&&<p className="text-sm text-muted-foreground">{t[5]} {targets[i]}</p>}
   {['available','complete'].includes(p)&&(notes[i]?<div className="h-16 overflow-auto rounded-md bg-muted/40 p-2"><p className="text-xs font-medium">{noteText[locale][0]}</p><ul className="mt-1 space-y-1">{noteItems(notes[i])}</ul>{sources[i]&&<p className="mt-1 text-[10px] text-muted-foreground/70">{noteText[locale][1]} {sources[i]}</p>}</div>:<p className="text-xs text-muted-foreground">{noteText[locale][2]}</p>)}
   {p==='error'&&<p role="alert" className="text-sm text-destructive">{live ? t[13] : scenario==='fail'?({en:'Download failed. Your current version is unchanged.',ja:'ダウンロードに失敗しました。現在のバージョンは変更されていません。','zh-Hans':'下载失败，当前版本未改变。','zh-Hant':'下載失敗，目前版本未變更。'}[locale]):t[13]}</p>}
   {(p==='downloading'||p==='installing')&&<Progress value={p==='downloading'?progress:undefined}/>}
   </div>
  </section>)}</div>
  {!live && <aside className="border-t border-dashed border-border pt-4 space-y-2"><p className="text-xs text-muted-foreground">{t[16]}</p><Select value={scenario} onValueChange={reset}><SelectTrigger className="w-56" aria-label={t[16]}><SelectValue/></SelectTrigger><SelectContent>{['available','current','error','fail','jouzu','launcher','downloading','installing'].map((value,i)=><SelectItem key={value} value={value}>{i<4?t[17+i]:extras[i-4]}</SelectItem>)}</SelectContent></Select></aside>}
 </div>;
}
