import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../components/ui/button';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';

/** One row of the System section: which copy a component uses, and what is still missing. */
export function ComponentSection({ title, status, note, tone, busy, error, install, installLabel, busyLabel, extra, options }: {
  title: string; status?: string; note?: string; tone?: 'ok' | 'missing';
  busy: boolean; error: string | null;
  install?: () => void; installLabel: string; busyLabel: string;
  extra?: { label: string; run: () => void };
  options?: { value: string; label: string; run: () => void; selected: boolean }[];
}) {
  return <section className="flex flex-col gap-2 border-t border-border px-5 py-4" aria-label={title}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="font-medium">{title}</h3>
        {status && <p className={`mt-1 text-sm ${tone === 'missing' ? 'text-destructive' : 'text-muted-foreground'}`}>{status}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
        {options && <RadioGroup value={options.find(option => option.selected)?.value ?? ''} onValueChange={value => options.find(option => option.value === value)?.run()} disabled={busy} aria-label={title} className="flex flex-wrap gap-4">{options.map(option => <div key={option.value} className="flex items-center gap-2"><RadioGroupItem value={option.value} id={`${title}-${option.value}`} /><Label htmlFor={`${title}-${option.value}`} className="text-sm font-normal">{option.label}</Label></div>)}</RadioGroup>}
        {extra && <Button variant="outline" disabled={busy} onClick={extra.run}>{extra.label}</Button>}
        {install && <Button disabled={busy} onClick={install}>{busy ? busyLabel : installLabel}</Button>}
      </div>
    </div>
    {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}

/** Joins what is known about a component, leaving out what is not. */
export const describe = (parts: (string | undefined)[]) => parts.filter(part => part).join(' · ');

export interface ComponentApi<State> {
  state: State | null;
  busy: boolean;
  error: string | null;
  run: (call: () => Promise<State>) => Promise<void>;
}

/** Reads a component's state and keeps it in step with the actions its row offers. */
export function useComponent<State>(command: string): ComponentApi<State> {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(async () => {
    try {
      const value = await invoke<State>(command);
      setState(value && typeof value === 'object' ? value : null);
    } catch (failure) { setError(String(failure)); }
  }, [command]);
  useEffect(() => { void read(); }, [read]);
  const run = useCallback(async (call: () => Promise<State>) => {
    setBusy(true); setError(null);
    try {
      const value = await call();
      setState(value && typeof value === 'object' ? value : null);
    }
    catch (failure) { setError(String(failure)); await read(); }
    finally { setBusy(false); }
  }, [read]);
  return { state, busy, error, run };
}
