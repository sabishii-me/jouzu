import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { messages, type Locale } from './i18n';

interface Report { issueUrl: string }

/** Reporting opens the project's own issue page, which is where a report is written and sent. */
export function ReportSection({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const report = await invoke<Report>('bug_report', { description: '', expected: '', actual: '', reproduction: '' });
      await openUrl(report.issueUrl);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  return <Card className="border-border shadow-none">
    <CardHeader><CardTitle>{t.reportTitle}</CardTitle></CardHeader>
    <CardContent className="space-y-2">
      <Button disabled={busy} onClick={() => void open()}>{t.reportAction}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
