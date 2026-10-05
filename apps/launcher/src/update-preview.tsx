import { Download, RefreshCw, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from './components/ui/dialog';
import { useState } from 'react';
import { Button } from './components/ui/button';
import { Progress } from './components/ui/progress';
import type { Locale } from './i18n';

/** The two update rows: Jouzu first, then the launcher that carries them. */
const labels: Record<Locale, {
  title: string; description: string; check: string; launcher: string; currentVersion: string;
  available: string; upToDate: string; updateJouzu: string; updateLauncher: string;
  checking: string; downloading: string; installing: string; updated: string;
  checkFailed: string; retry: string; restart: string; cancel: string; unavailable: string;
}> = {
  en: {
    title: 'System', description: 'Jouzu, the launcher, and the tools they need.', check: 'Check for updates',
    launcher: 'Launcher', currentVersion: 'Current version', available: 'Available', upToDate: 'Up to date',
    updateJouzu: 'Update Jouzu', updateLauncher: 'Update and restart', checking: 'Checking…',
    downloading: 'Downloading…', installing: 'Installing…', updated: 'Updated',
    checkFailed: 'Could not check for updates', retry: 'Retry',
    restart: 'The launcher restarts after updating.', cancel: 'Cancel',
    unavailable: 'Online updates are unavailable for this version.',
  },
  ja: {
    title: 'システム', description: 'Jouzu、ランチャー、および必要なツールの状態です。', check: '更新を確認',
    launcher: 'ランチャー', currentVersion: '現在のバージョン', available: '更新先', upToDate: '最新です',
    updateJouzu: 'Jouzu を更新', updateLauncher: '更新して再起動', checking: '確認中…',
    downloading: 'ダウンロード中…', installing: 'インストール中…', updated: '更新しました',
    checkFailed: '更新を確認できませんでした', retry: '再試行',
    restart: '更新後にランチャーを再起動します。', cancel: 'キャンセル',
    unavailable: 'このバージョンではオンライン更新を利用できません。',
  },
  'zh-Hans': {
    title: '系统', description: '查看 Jouzu、启动器以及所需工具的状态。', check: '检查更新',
    launcher: '启动器', currentVersion: '当前版本', available: '可更新至', upToDate: '已是最新',
    updateJouzu: '更新 Jouzu', updateLauncher: '更新并重启', checking: '正在检查…',
    downloading: '正在下载…', installing: '正在安装…', updated: '更新完成',
    checkFailed: '暂时无法检查更新', retry: '重试',
    restart: '更新后将重新启动启动器。', cancel: '取消',
    unavailable: '此版本暂不支持在线更新。',
  },
  'zh-Hant': {
    title: '系統', description: '查看 Jouzu、啟動器以及所需工具的狀態。', check: '檢查更新',
    launcher: '啟動器', currentVersion: '目前版本', available: '可更新至', upToDate: '已是最新',
    updateJouzu: '更新 Jouzu', updateLauncher: '更新並重新啟動', checking: '正在檢查…',
    downloading: '正在下載…', installing: '正在安裝…', updated: '更新完成',
    checkFailed: '暫時無法檢查更新', retry: '重試',
    restart: '更新後將重新啟動啟動器。', cancel: '取消',
    unavailable: '此版本暫不支援線上更新。',
  },
};

const noteText: Record<Locale, [string, string, string]> = {
  en: ["What's new", 'Source:', 'No description was published for this version.'],
  ja: ['変更点', '出典:', 'このバージョンの説明は公開されていません。'],
  'zh-Hans': ['更新内容', '来源：', '此版本未发布说明。'],
  'zh-Hant': ['更新內容', '來源：', '此版本未發布說明。'],
};

export type Phase = 'available' | 'current' | 'checking' | 'downloading' | 'installing' | 'complete' | 'error' | 'idle';
export interface UpdateViewState {
  phases: Phase[]; versions: string[]; targets: (string | null)[]; progress?: number;
  configured: boolean[]; errors: (string | null)[]; notes: string[]; sources: string[];
  check: () => void; install: (index: number) => void;
}

const noteItems = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean).map((line, index) =>
  line.startsWith('### ')
    ? <li key={index} className="text-xs font-medium text-muted-foreground">{line.slice(4)}</li>
    : line.startsWith('- ')
      ? <li key={index} className="flex gap-2 text-xs text-muted-foreground"><span aria-hidden="true">•</span><span>{line.slice(2)}</span></li>
      : <li key={index} className="text-xs text-muted-foreground">{line}</li>);

/** The update rows, driven by the state the launcher reports. */
export function UpdatePreview({ locale, live }: { locale: Locale; live: UpdateViewState }) {
  const t = labels[locale];
  const [confirmRestart, setConfirmRestart] = useState(false);
  const busy = live.phases.some(phase => ['checking', 'downloading', 'installing'].includes(phase));
  const start = (index: number) => (index === 0 ? live.install(index) : setConfirmRestart(true));
  return <div className="space-y-6">
    <Dialog open={confirmRestart} onOpenChange={setConfirmRestart}><DialogContent className="sm:max-w-sm"><DialogTitle>{t.updateLauncher}</DialogTitle><DialogDescription>{t.restart}</DialogDescription><div className="flex justify-end gap-2"><DialogClose asChild><Button variant="outline">{t.cancel}</Button></DialogClose><Button onClick={() => { setConfirmRestart(false); live.install(1); }}>{t.updateLauncher}</Button></div></DialogContent></Dialog>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{t.title}</h2><p className="mt-1 text-sm text-muted-foreground">{t.description}</p></div><Button variant="ghost" className="h-9 w-9 p-0" aria-label={t.check} title={t.check} disabled={busy} onClick={live.check}><RefreshCw className={`size-4 ${live.phases.includes('checking') ? 'animate-spin' : ''}`} /></Button></div>
    <div className="divide-y divide-border rounded-lg border border-border px-5">{live.phases.map((phase, index) => <section key={index} aria-label={index === 0 ? 'Jouzu' : t.launcher} className="flex min-h-32 flex-col gap-2 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{index === 0 ? 'Jouzu' : t.launcher}</h3><p className="mt-1 text-sm text-muted-foreground">{t.currentVersion} {live.versions[index]}</p></div>
        {phase === 'available' ? <Button className="h-9 w-9 p-0" aria-label={index === 0 ? t.updateJouzu : t.updateLauncher} title={index === 0 ? t.updateJouzu : t.updateLauncher} disabled={busy} onClick={() => start(index)}><Download className="size-4" /></Button>
          : phase === 'error' ? <Button variant="outline" className="h-9 w-9 p-0" aria-label={t.retry} title={t.retry} disabled={busy} onClick={() => (live.targets[index] ? start(index) : live.check())}><RefreshCw className="size-4" /></Button>
            : <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">{['checking', 'downloading', 'installing'].includes(phase) && <LoaderCircle className="size-4 animate-spin" />}{phase === 'current' ? t.upToDate : phase === 'complete' ? t.updated : phase === 'checking' ? t.checking : phase === 'downloading' ? t.downloading : phase === 'installing' ? t.installing : ''}</span>}
      </div>
      <div className="flex flex-col gap-2">
        {!live.configured[index] && <p className="text-sm text-muted-foreground">{t.unavailable}</p>}
        {phase === 'available' && <p className="text-sm text-muted-foreground">{t.available} {live.targets[index]}</p>}
        {['available', 'complete'].includes(phase) && (live.notes[index]
          ? <div className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2"><p className="text-xs font-medium">{noteText[locale][0]}</p><ul className="mt-1 space-y-1">{noteItems(live.notes[index])}</ul>{live.sources[index] && <p className="mt-1 text-[10px] text-muted-foreground/70">{noteText[locale][1]} {live.sources[index]}</p>}</div>
          : <p className="text-xs text-muted-foreground">{noteText[locale][2]}</p>)}
        {phase === 'error' && <p role="alert" className="text-sm text-destructive">{live.errors[index] ?? t.checkFailed}</p>}
        {(phase === 'downloading' || phase === 'installing') && <Progress value={phase === 'downloading' ? live.progress : undefined} />}
      </div>
    </section>)}</div>
  </div>;
}
