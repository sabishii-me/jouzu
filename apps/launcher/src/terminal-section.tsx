import { invoke } from '@tauri-apps/api/core';
import { ComponentSection, useComponent } from './components/component-row';
import { messages, type Locale } from './i18n';

interface Terminal { path: string; version: string }
export interface TerminalState {
  bundled: Terminal | null;
  system: Terminal | null;
  effective: string | null;
  archive: boolean;
  version: string;
}

/** The Windows Terminal component: the host of the console window. */
export function TerminalSection({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const { state, busy, error, run } = useComponent<TerminalState>('terminal');
  if (!state) return null;
  const source = state.system ? t.terminalSystem : t.terminalBundled;
  const detail = state.system ?? state.bundled;
  return <ComponentSection
    title={t.windowsTerminal}
    status={state.effective ? `${source} · ${detail?.version ?? state.version}` : t.terminalMissing}
    tone={state.effective ? 'ok' : 'missing'}
    note={t.terminalHint}
    busy={busy} error={error}
    install={() => void run(() => invoke<TerminalState>('terminal_install'))}
    installLabel={t.terminalInstall} busyLabel={t.terminalInstalling}
  />;
}
