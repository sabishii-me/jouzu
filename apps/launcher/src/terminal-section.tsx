import { invoke } from '@tauri-apps/api/core';
import { ComponentSection, describe, useComponent } from './components/component-row';
import { messages, type Locale } from './i18n';

interface Terminal { path: string; version: string }
export interface TerminalState {
  bundled: Terminal | null;
  system: Terminal | null;
  preferred: string | null;
  effective: string | null;
  archive: boolean;
  version: string;
  choice: 'bundled' | 'system';
}

/** The Windows Terminal component: the host of the console window. */
export function TerminalSection({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const { state, busy, error, run } = useComponent<TerminalState>('terminal');
  if (!state) return <ComponentSection title={t.windowsTerminal} status={t.unavailable} tone="missing" busy={busy} error={error} installLabel={t.terminalInstall} busyLabel={t.terminalInstalling} />;
  const installed = Boolean(state.effective);
  const usingSystem = installed && state.effective === state.system?.path;
  const choose = (provider: 'bundled' | 'system') => void run(() => invoke<TerminalState>('terminal_choose', { provider, path: provider === 'system' ? state.system!.path : null }));
  // The same two ways: the copy Jouzu ships, installed on request, and the one this PC has.
  const options = [
    ...(state.system ? [{ value: 'system', label: describe([t.terminalUseSystem, state.system.version]), run: () => choose('system'), selected: usingSystem }] : []),
    state.bundled
      ? { value: 'bundled', label: describe([t.terminalUseBundled, state.bundled.version]), run: () => choose('bundled'), selected: installed && !usingSystem }
      : { value: 'bundled', label: t.terminalInstall, run: () => void run(() => invoke<TerminalState>('terminal_install')), selected: false },
  ];
  return <ComponentSection
    title={t.windowsTerminal}
    status={installed ? undefined : t.terminalMissing}
    tone={installed ? 'ok' : 'missing'}
    busy={busy} error={error}
    installLabel={t.terminalInstall} busyLabel={t.terminalInstalling}
    options={options}
  />;
}
