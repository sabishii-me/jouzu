import { invoke } from '@tauri-apps/api/core';
import { ComponentSection, describe, useComponent } from './components/component-row';
import { messages, type Locale } from './i18n';

interface Resolution { name: string; path: string | null }
export interface CommandEntryState {
  directory: string;
  shims: boolean;
  onPath: boolean;
  position: 'absent' | 'first' | 'later';
  first: boolean;
  shadowed: boolean;
  commands: Resolution[];
}

const within = (path: string, directory: string) => {
  const normal = (value: string) => value.replaceAll(String.fromCharCode(92), '/').toLowerCase();
  return normal(path).startsWith(normal(directory) + '/');
};

/** The terminal entry: which jz a shell started now would run, and where it comes from. */
export function CommandEntrySection({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const { state, busy, error, run } = useComponent<CommandEntryState>('command_entry_report');
  if (!state) return <ComponentSection title={t.commandEntry} status={t.unavailable} tone="missing" busy={busy} error={error} installLabel={t.commandEntryUse} />;
  // What another installation answers with is named, because that is what the authorized action
  // supersedes and the user has to know it before taking precedence.
  const foreign = state.commands.find(entry => entry.path && !within(entry.path, state.directory))?.path ?? null;
  const answers = state.first || (state.onPath && !foreign);
  // The row says what is true for the user, and offers the change it can make. Where a command was found
  // and which installation put it there are support details, and a support detail belongs in a report.
  const status = !state.shims ? t.commandEntryBroken : answers ? t.gitBashInUse : undefined;
  const note = state.shims && !answers ? t.commandEntryHint : undefined;
  return <ComponentSection
    title={t.commandEntry}
    status={status}
    tone={answers ? 'ok' : 'missing'}
    note={note}
    busy={busy} error={error}
    install={!state.shims ? () => void run(() => invoke<CommandEntryState>('command_entry_repair')) : state.first ? undefined : () => void run(() => invoke<CommandEntryState>('command_entry_use'))}
    installLabel={!state.shims ? t.commandEntryRepair : t.commandEntryUse}
    extra={state.shims && state.first ? { label: t.commandEntryRestore, run: () => void run(() => invoke<CommandEntryState>('command_entry_restore')) } : undefined}
  />;
}
