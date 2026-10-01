import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Terminal, Search, X, ArrowUpRight, Settings, Languages, RefreshCw, LoaderCircle } from "lucide-react";
import { Button } from "./components/ui/button";
import { messages, locales, resolveLocale, type Locale } from "./i18n";
import { environmentLabel, type Workspace } from "./history";
interface LauncherState { platform: "windows" | "macos" | "linux"; recent: Workspace[]; ready: boolean; bash: boolean; bundled_git: boolean }
interface Components { jouzu: string | null; development: boolean }
export function App() {
  const [locale, setLocale] = useState<Locale>(() => resolveLocale(localStorage.getItem("jouzu.ui.language") ?? navigator.language));
  const t = messages[locale];
  useEffect(() => { document.documentElement.lang = locale; localStorage.setItem("jouzu.ui.language", locale); }, [locale]);
  const [state, setState] = useState<LauncherState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<"choosing" | "launching" | "preparing" | "saving" | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [components, setComponents] = useState<Components | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<"home" | "general" | "about">("home");
  const [notice, setNotice] = useState<"requested" | "removed" | null>(null);
  const busy = operation !== null;
  const refresh = async () => setState(await invoke<LauncherState>("launcher_state"));
  useEffect(() => {
    if (!isTauri()) return;
    refresh().catch(error => setError(String(error)));
    getVersion().then(setVersion).catch(error => setError(String(error)));
    invoke<Components>("component_versions").then(setComponents).catch(error => setError(String(error)));
  }, []);
  async function launch(path: string) {
    if (!state?.ready) return;
    setOperation("launching"); setError(null); setNotice(null);
    try {
      if (!state.bash) {
        if (!state.bundled_git && !await confirm(t.download, { title: t.prepare, kind: "info" })) return;
        setOperation("preparing"); await invoke("install_git");
      }
      setOperation("launching");
      await invoke("launch_jouzu", { path });
      setNotice("requested");
      await refresh();
    } catch (error) { setError(String(error)); } finally { setOperation(null); }
  }
  async function chooseFolder() {
    setOperation("choosing"); setError(null);
    try {
      const path = await open({ directory: true, multiple: false, title: t.picker });
      if (typeof path === "string") await launch(path);
    } catch (error) { setError(String(error)); } finally { setOperation(null); }
  }
  async function forget(workspace: Workspace) {
    setOperation("saving"); setError(null);
    try {
      await invoke("forget_workspace", { id: workspace.id }); await refresh();
      setNotice("removed");
    } catch (error) { setError(String(error)); } finally { setOperation(null); }
  }
  const recent = state?.recent.filter(item => item.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  const development = components?.development ?? import.meta.env.DEV;
  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-7 sm:px-10">
    <header className="flex items-center justify-between border-b border-border py-5">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-primary p-2 text-white"><Terminal className="size-5" aria-hidden="true" /></span><h1 className="text-lg font-semibold tracking-tight">Jouzu</h1>{development && <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">{t.development}</span>}</div>
      <Button variant="ghost" onClick={() => setPage(page === "home" ? "general" : "home")} aria-label={page === "home" ? t.settings : t.back}>{page === "home" ? <Settings /> : <X />}</Button>
    </header>
    {error && <div role="alert" className="mt-5 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><div><p className="font-medium">{t.error}</p><details className="mt-2 break-all"><summary className="cursor-pointer">{t.details}</summary><p className="mt-2">{error}</p></details></div><button onClick={() => setError(null)} aria-label={t.dismiss}><X className="size-4" /></button></div>}
    {page !== "home" && <nav aria-label={t.settings} className="mt-6 flex gap-2 border-b border-border pb-3"><Button variant={page === "general" ? "default" : "ghost"} onClick={() => setPage("general")}><Languages />{t.general}</Button><Button variant={page === "about" ? "default" : "ghost"} onClick={() => setPage("about")}>{t.versions}</Button></nav>}
    {page === "general" ? <section className="flex-1 py-8"><h2 className="text-2xl font-semibold">{t.general}</h2><p className="mt-2 text-sm text-muted-foreground">{t.preferences}</p><div className="mt-6 rounded-xl border border-border bg-white p-6"><label htmlFor="language" className="block font-medium">{t.language}</label><p className="mt-2 max-w-lg text-sm text-muted-foreground">{t.languageHint}</p><select id="language" value={locale} onChange={event => setLocale(event.target.value as Locale)} className="mt-4 min-h-10 w-full max-w-xs rounded-lg border border-border bg-background px-3">{Object.entries(locales).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div></section> : page === "home" ? <section className="flex-1 py-8" aria-labelledby="folders-heading">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><h2 id="folders-heading" className="text-2xl font-semibold tracking-tight">{t.heading}</h2><p className="mt-2 text-sm text-muted-foreground">{t.intro}</p></div><Button onClick={chooseFolder} disabled={!state?.ready || busy}><FolderOpen />{t.open}</Button></div>
      {(state?.recent.length ?? 0) > 0 && <label className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-white px-3"><Search className="size-4 text-muted-foreground" aria-hidden="true" /><input className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} /></label>}
      {!state ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">{isTauri() ? t.loading : t.preview}</p> : !state.recent.length ? <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center"><FolderOpen className="mx-auto mb-4 size-9 text-muted-foreground" aria-hidden="true" /><h3 className="font-medium">{t.empty}</h3><p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{t.emptyHint}</p></div> : !recent.length ? <p className="py-10 text-center text-sm text-muted-foreground">{t.noResults}</p> : <ul className="space-y-2">{recent.map(workspace => <li key={workspace.id} className="group flex items-center gap-2 rounded-xl border border-border bg-white p-2 transition-colors hover:border-primary/40"><button disabled={busy || !state.ready} onClick={() => launch(workspace.path)} className="flex min-w-0 flex-1 items-center gap-4 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" title={`Open ${workspace.path}`}><FolderOpen className="size-5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{workspace.path.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace.path}</span><span className="mt-1 block truncate text-xs text-muted-foreground" title={workspace.path}>{workspace.path}</span></span><span className="hidden text-xs text-muted-foreground sm:block">{environmentLabel(workspace.environment)}</span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></button><Button disabled={busy} variant="ghost" onClick={() => forget(workspace)} aria-label={`${t.remove}: ${workspace.path}`} title={t.remove}><X /></Button></li>)}</ul>}
    </section> : <section className="flex-1 py-8" aria-labelledby="versions-heading"><h2 id="versions-heading" className="text-2xl font-semibold">{t.versions}</h2><p className="mt-2 text-sm text-muted-foreground">{t.versionsHint}</p><dl className="mt-6 divide-y divide-border rounded-xl border border-border bg-white px-5"><div className="flex justify-between py-5"><dt>{t.launcher}</dt><dd className="text-sm text-muted-foreground">{development ? t.development : version ?? t.unavailable}</dd></div><div className="flex justify-between py-5"><dt>Jouzu</dt><dd className="text-sm text-muted-foreground">{components?.jouzu ?? t.unavailable}</dd></div></dl><div className="mt-4 flex items-center justify-between rounded-lg border border-border p-4 text-sm"><span>{t.tools}</span><span>{state?.bash ? t.available : t.firstUse}</span></div>{development && <p className="mt-4 text-sm text-muted-foreground">{t.devHint}</p>}<Button className="mt-4" variant="outline" disabled={busy || !isTauri()} onClick={() => { refresh().catch(error => setError(String(error))); invoke<Components>("component_versions").then(setComponents).catch(error => setError(String(error))); }}><RefreshCw />{t.refresh}</Button><p className="mt-5 rounded-lg bg-muted p-4 text-sm text-muted-foreground">{t.noUpdates}</p></section>}
    <footer className="flex min-h-16 items-center gap-2 border-t border-border py-4 text-xs text-muted-foreground" role="status" aria-live="polite">{busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{operation === "preparing" ? t.preparing : operation === "launching" ? t.launching : operation === "choosing" ? t.choosing : operation === "saving" ? t.saving : (notice ? t[notice] : null) ?? (!state ? t.connecting : !state.ready ? t.repair : t.safe)}</footer>
  </main>;
}
