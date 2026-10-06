import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { messages, type Locale } from './i18n';

interface Draft { available: boolean; title: string; body: string; issueUrl: string }

/** One action: what happened, then the public form opens with the report already written in it. */
export function ReportSection({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function report() {
    setBusy(true); setError(null);
    try {
      const draft = await invoke<Draft>('bug_report', { description, expected: '', actual: '', reproduction: '' });
      const url = new URL(draft.issueUrl);
      url.searchParams.set('title', draft.title ?? '');
      url.searchParams.set('body', draft.body ?? '');
      await openUrl(url.href.length <= 7000 ? url.href : draft.issueUrl);
    } catch (failure) { setError(String(failure)); } finally { setBusy(false); }
  }
  return <Card className="border-border shadow-none">
    <CardHeader><CardTitle>{t.reportTitle}</CardTitle><CardDescription>{t.reportHint}</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <textarea aria-label={t.reportDescription} placeholder={t.reportDescription} className="min-h-24 w-full rounded-lg border border-border bg-background p-3 text-sm" value={description} onChange={event => setDescription(event.target.value)} />
      <div className="flex justify-end"><Button disabled={busy || !description.trim()} onClick={() => void report()}>{t.reportAction}</Button></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
