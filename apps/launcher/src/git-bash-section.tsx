import { invoke } from '@tauri-apps/api/core';
import { messages, type Locale } from './i18n';
import { ComponentSection, useComponent, type ComponentApi } from './components/component-row';

interface Environment { path: string; git: string; bash: string }
export interface GitBashState {
  bundled: Environment | null;
  managed: Environment | null;
  system: Environment | null;
  preferred: string | null;
  archive: boolean;
  choice: 'bundled' | 'system';
  effective: Environment | null;
}

/** The version without the prefix the command prints, for display in the row. */
const version = (reported?: string) => reported?.replace(/^git version\s+/i, '');

/** The Git Bash component: the copy in use, and the other copy the user can move to. */
export function GitBashSection({ locale, api }: { locale: Locale; api: ComponentApi<GitBashState> }) {
  const t = messages[locale];
  const { state, busy, error, run } = api;
  if (!state) return <ComponentSection title={t.gitBash} status={t.unavailable} tone="missing" busy={busy} error={error} installLabel={t.gitBashInstall} busyLabel={t.gitBashInstalling} />;
  const own = state.bundled ?? state.managed;
  const installed = Boolean(state.effective);
  const usingSystem = installed && state.effective?.path === state.system?.path;
  const choose = (provider: 'bundled' | 'system') => void run(() => invoke<GitBashState>('git_bash_choose', { provider, path: provider === 'system' ? state.system!.path : null }));
  // Two ways to have a Git Bash: the copy Jouzu ships and the one this PC already has. The row shows
  // both, marks the one in use, and offers installing the shipped copy until it is there.
  const options = [
    ...(state.system ? [{ value: 'system', label: t.gitBashUseSystem, run: () => choose('system'), selected: usingSystem }] : []),
    own
      ? { value: 'bundled', label: t.gitBashUseBundled, run: () => choose('bundled'), selected: installed && !usingSystem }
      : { value: 'bundled', label: t.gitBashInstall, run: () => void run(() => invoke<GitBashState>('git_bash_install')), selected: false },
  ];
  return <ComponentSection
    title={t.gitBash}
    status={installed ? `${usingSystem ? t.gitBashSystem : t.gitBashBundled} · ${version(state.effective?.git)}` : t.gitBashMissing}
    tone={installed ? 'ok' : 'missing'}
    note={installed ? undefined : t.gitBashRequired}
    busy={busy} error={error}
    installLabel={t.gitBashInstall} busyLabel={t.gitBashInstalling}
    options={options}
  />;
}

export function useGitBash(): ComponentApi<GitBashState> {
  return useComponent<GitBashState>('git_bash');
}
