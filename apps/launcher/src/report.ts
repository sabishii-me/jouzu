import { openUrl } from '@tauri-apps/plugin-opener';

/** The page a report is written on; opening it is the whole action. */
const ISSUE_NEW_URL = 'https://github.com/shisa-ai/jouzu/issues/new';

export async function openReport(): Promise<void> {
  await openUrl(ISSUE_NEW_URL);
}
