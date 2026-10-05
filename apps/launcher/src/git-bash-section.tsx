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
  // A component keeps its row when the launcher reports nothing, so a failure is visible.
  if (!state) return <ComponentSection title={t.gitBash} status={t.unavailable} tone="missing" busy={busy} error={error} installLabel={t.gitBashInstall} busyLabel={t.gitBashInstalling} />;
  const own = state.bundled ?? state.managed;
  const installed = Boolean(state.effective);
  const usingSystem = installed && state.effective?.path === state.system?.path;
  const install = () => void run(() => invoke<GitBashState>('git_bash_install'));
  const useSystem = state.system ? { label: t.gitBashUseSystem, run: () => void run(() => invoke<GitBashState>('git_bash_choose', { provider: 'system', path: state.system!.path })) } : undefined;
  const useBundled = { label: t.gitBashUseBundled, run: () => void run(() => invoke<GitBashState>('git_bash_choose', { provider: 'bundled', path: null })) };
  // A Git Bash this PC already has can be used; the copy Jouzu ships is the one it is qualified
  // against, so installing it stays on offer until it is there.
  return <ComponentSection
    title={t.gitBash}
    status={installed ? `${usingSystem ? t.gitBashSystem : t.gitBashBundled} · ${state.effective?.git}` : t.gitBashMissing}
    tone={installed ? 'ok' : 'missing'}
    note={installed ? undefined : state.system ? `${t.gitBashSystemAvailable} · ${state.system.git}` : t.gitBashRequired}
    busy={busy} error={error}
    install={own ? undefined : install}
    installLabel={t.gitBashInstall} busyLabel={t.gitBashInstalling}
    extra={installed ? (usingSystem ? (own ? useBundled : undefined) : useSystem) : useSystem}
  />;
}

export function useGitBash(): ComponentApi<GitBashState> {
  return useComponent<GitBashState>('git_bash');
}
