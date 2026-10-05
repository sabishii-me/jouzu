import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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

/** The Git Bash component: which source is in use, and what the user can do about it. */
export function GitBashSection({ locale, api }: { locale: Locale; api: ComponentApi<GitBashState> }) {
  const t = messages[locale];
  const { state, busy, error, run } = api;
  if (!state) return null;
  const source = state.choice === 'system' && state.effective ? t.gitBashSystem : t.gitBashBundled;
  return <ComponentSection
    title={t.gitBash}
    status={state.effective ? `${source} · ${state.effective.git}` : t.gitBashMissing}
    tone={state.effective ? 'ok' : 'missing'}
    note={state.choice === 'system' && state.effective ? t.gitBashPrompt : state.effective ? undefined : t.gitBashRequired}
    busy={busy} error={error}
    install={() => void run(() => invoke<GitBashState>('git_bash_install'))}
    installLabel={t.gitBashInstall} busyLabel={t.gitBashInstalling}
    extra={state.system ? (state.choice === 'system'
      ? { label: t.gitBashUseBundled, run: () => void run(() => invoke<GitBashState>('git_bash_choose', { provider: 'bundled', path: null })) }
      : { label: t.gitBashUseSystem, run: () => void run(() => invoke<GitBashState>('git_bash_choose', { provider: 'system', path: state.system!.path })) }) : undefined}
  />;
}

export function useGitBash(): ComponentApi<GitBashState> {
  return useComponent<GitBashState>('git_bash');
}
