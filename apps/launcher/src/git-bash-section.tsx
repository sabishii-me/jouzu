import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from './components/ui/button';
import { messages, type Locale } from './i18n';

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
export function GitBashSection({ locale, state, busy, error, onInstall, onChoose }: {
  locale: Locale; state: GitBashState; busy: boolean; error: string | null;
  onInstall: () => void; onChoose: (choice: 'bundled' | 'system', path?: string) => void;
}) {
  const t = messages[locale];
  const source = state.choice === 'system' && state.effective ? t.gitBashSystem : t.gitBashBundled;
  return <section className="flex flex-col gap-2 border-t border-border px-5 py-4" aria-label={t.gitBash}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="font-medium">{t.gitBash}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.effective ? `${source} · ${state.effective.git}` : t.gitBashMissing}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
        {state.choice === 'system' && <Button variant="outline" disabled={busy} onClick={() => onChoose('bundled')}>{t.gitBashUseBundled}</Button>}
        {state.choice !== 'system' && state.system && <Button variant="outline" disabled={busy} onClick={() => onChoose('system', state.system!.path)}>{t.gitBashUseSystem}</Button>}
        <Button disabled={busy} onClick={onInstall}>{busy ? t.gitBashInstalling : t.gitBashInstall}</Button>
      </div>
    </div>
    {state.choice === 'system' && state.effective && <p role="status" className="text-xs text-muted-foreground">{t.gitBashPrompt}</p>}
    {!state.effective && <p role="status" className="text-xs text-destructive">{t.gitBashRequired}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}

/** Loads the Git Bash state and keeps it in step with the actions the section offers. */
export function useGitBash() {
  const [state, setState] = useState<GitBashState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(async () => {
    try { setState(await invoke<GitBashState>('git_bash')); }
    catch (failure) { setError(String(failure)); }
  }, []);
  useEffect(() => { void read(); }, [read]);
  const run = useCallback(async (call: () => Promise<GitBashState>) => {
    setBusy(true); setError(null);
    try { setState(await call()); }
    catch (failure) { setError(String(failure)); await read(); }
    finally { setBusy(false); }
  }, [read]);
  return {
    state, busy, error,
    install: () => run(() => invoke<GitBashState>('git_bash_install')),
    choose: (choice: 'bundled' | 'system', path?: string) => run(() => invoke<GitBashState>('git_bash_choose', { provider: choice, path: path ?? null })),
  };
}
