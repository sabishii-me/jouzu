import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { messages, type Locale } from './i18n';

interface Draft { available: boolean; title: string; body: string; issueUrl: string }

const area = 'min-h-24 w-full rounded-lg border border-border bg-background p-3 text-sm font-mono';

/** A report the user can send without knowing what to include: the draft is the payload's own, the
 * Launcher adds what it knows about this installation, and nothing leaves the machine until offered. */
export function ReportSection({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function build() {
    setBusy(true); setError(null); setSent(null);
    try {
      const answer = await invoke<Draft>('bug_report', { description, expected: '', actual: '', reproduction: '' });
      setDraft(answer); setTitle(answer.title ?? ''); setBody(answer.body ?? '');
    } catch (failure) { setError(String(failure)); } finally { setBusy(false); }
  }
  async function submit() {
    if (!(await confirm(t.reportConfirm, { title: t.reportTitle, kind: 'warning' }))) return;
    setBusy(true); setError(null);
    try { setSent(await invoke<string>('bug_report_submit', { title, body })); }
    catch (failure) { setError(String(failure)); } finally { setBusy(false); }
  }
  return <Card className="border-border shadow-none">
    <CardHeader><CardTitle>{t.reportTitle}</CardTitle><CardDescription>{t.reportHint}</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <textarea aria-label={t.reportDescription} placeholder={t.reportDescription} className={area.replace('font-mono', '')} value={description} onChange={event => setDescription(event.target.value)} />
      <div className="flex justify-end"><Button variant="outline" disabled={busy || !description.trim()} onClick={() => void build()}>{t.reportBuild}</Button></div>
      {draft && <>
        <p className="text-xs text-muted-foreground">{draft.available ? t.reportReady : t.reportUnavailable}</p>
        <textarea aria-label={t.reportDraft} className={area} value={body} onChange={event => setBody(event.target.value)} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void navigator.clipboard.writeText(body)}>{t.reportCopy}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void openUrl(draft.issueUrl)}>{t.reportOpenForm}</Button>
          <Button disabled={busy || !draft.available} onClick={() => void submit()}>{t.reportSubmit}</Button>
        </div>
      </>}
      {sent && <p role="status" className="break-all text-sm text-muted-foreground">{t.reportSent} {sent}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
