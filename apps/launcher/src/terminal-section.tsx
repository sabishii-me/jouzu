import { invoke } from '@tauri-apps/api/core';
import { ComponentSection, describe, useComponent } from './components/component-row';
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
  if (!state) return <ComponentSection title={t.windowsTerminal} status={t.unavailable} tone="missing" busy={busy} error={error} installLabel={t.terminalInstall} />;
  const installed = Boolean(state.effective);
  const usingSystem = installed && state.effective === state.system?.path;
  const detail = usingSystem ? state.system : state.bundled;
  return <ComponentSection
    title={t.windowsTerminal}
    status={installed ? describe([usingSystem ? t.terminalSystem : t.terminalBundled, detail?.version]) : t.terminalMissing}
    tone={installed ? 'ok' : 'missing'}
    busy={busy} error={error}
    install={state.bundled ? undefined : () => void run(() => invoke<TerminalState>('terminal_install'))}
    installLabel={`${t.terminalInstall} (${t.recommended})`}
  />;
}
