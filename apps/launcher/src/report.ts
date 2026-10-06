import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

interface Report { issueUrl: string }

/** Reporting goes to the project's own issue page, so both doors to it do the same one thing. */
export async function openReport(): Promise<void> {
  const report = await invoke<Report>('bug_report', { description: '', expected: '', actual: '', reproduction: '' });
  await openUrl(report.issueUrl);
}
