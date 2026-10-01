import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Terminal, Search, X, ArrowUpRight, Info, LoaderCircle } from "lucide-react";
import { Button } from "./components/ui/button";
import { environmentLabel, type Workspace } from "./history";
interface LauncherState { platform: "windows" | "macos" | "linux"; recent: Workspace[]; ready: boolean; bash: boolean }
interface Components { jouzu: string | null; development: boolean }
export function App() {
  const [state, setState] = useState<LauncherState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<"choosing" | "launching" | "preparing" | "saving" | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [components, setComponents] = useState<Components | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<"home" | "about">("home");
  const [notice, setNotice] = useState<string | null>(null);
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
        if (!await confirm("Jouzu needs Git tools. Download the verified official Git for Windows package now?", { title: "Prepare tools", kind: "info" })) return;
        setOperation("preparing"); await invoke("install_git");
      }
      setOperation("launching");
      await invoke("launch_jouzu", { path });
      setNotice("Launch requested. Jouzu opens in a separate terminal.");
      await refresh();
    } catch (error) { setError(String(error)); } finally { setOperation(null); }
  }
  async function chooseFolder() {
    setOperation("choosing"); setError(null);
    try {
      const path = await open({ directory: true, multiple: false, title: "Open a working folder" });
      if (typeof path === "string") await launch(path);
    } catch (error) { setError(String(error)); } finally { setOperation(null); }
  }
  async function forget(workspace: Workspace) {
    setOperation("saving"); setError(null);
    try {
      await invoke("forget_workspace", { id: workspace.id }); await refresh();
      setNotice("Removed from recent folders. Your files were not changed.");
    } catch (error) { setError(String(error)); } finally { setOperation(null); }
  }
  const recent = state?.recent.filter(item => item.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  const development = components?.development ?? import.meta.env.DEV;
  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-7 sm:px-10">
    <header className="flex items-center justify-between border-b border-border py-5">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-primary p-2 text-white"><Terminal className="size-5" aria-hidden="true" /></span><h1 className="text-lg font-semibold tracking-tight">Jouzu</h1>{development && <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">Development</span>}</div>
      <Button variant="ghost" onClick={() => setPage(page === "home" ? "about" : "home")} aria-label={page === "home" ? "Versions and updates" : "Back to folders"}>{page === "home" ? <Info /> : <X />}</Button>
    </header>
    {error && <div role="alert" className="mt-5 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X className="size-4" /></button></div>}
    {page === "home" ? <section className="flex-1 py-8" aria-labelledby="folders-heading">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><h2 id="folders-heading" className="text-2xl font-semibold tracking-tight">Where will you work?</h2><p className="mt-2 text-sm text-muted-foreground">Open a folder to start or return to your work.</p></div><Button onClick={chooseFolder} disabled={!state?.ready || busy}><FolderOpen />Open folder…</Button></div>
      {(state?.recent.length ?? 0) > 0 && <label className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-white px-3"><Search className="size-4 text-muted-foreground" aria-hidden="true" /><input className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Search recent folders" placeholder="Find a recent folder…" value={query} onChange={event => setQuery(event.target.value)} /></label>}
      {!state ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">{isTauri() ? "Loading your folders…" : "Browser preview. Use the desktop app to open folders."}</p> : !state.recent.length ? <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center"><FolderOpen className="mx-auto mb-4 size-9 text-muted-foreground" aria-hidden="true" /><h3 className="font-medium">Start with a folder</h3><p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Choose an existing project or any folder you want to work in. It will appear here next time.</p></div> : !recent.length ? <p className="py-10 text-center text-sm text-muted-foreground">No folders match your search.</p> : <ul className="space-y-2">{recent.map(workspace => <li key={workspace.id} className="group flex items-center gap-2 rounded-xl border border-border bg-white p-2 transition-colors hover:border-primary/40"><button disabled={busy || !state.ready} onClick={() => launch(workspace.path)} className="flex min-w-0 flex-1 items-center gap-4 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" title={`Open ${workspace.path}`}><FolderOpen className="size-5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{workspace.path.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace.path}</span><span className="mt-1 block truncate text-xs text-muted-foreground" title={workspace.path}>{workspace.path}</span></span><span className="hidden text-xs text-muted-foreground sm:block">{environmentLabel(workspace.environment)}</span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></button><Button disabled={busy} variant="ghost" onClick={() => forget(workspace)} aria-label={`Remove ${workspace.path} from recent folders`} title="Remove from recents — files are kept"><X /></Button></li>)}</ul>}
    </section> : <section className="flex-1 py-8" aria-labelledby="versions-heading"><h2 id="versions-heading" className="text-2xl font-semibold">Versions & updates</h2><p className="mt-2 text-sm text-muted-foreground">The desktop launcher and Jouzu are separate components.</p><dl className="mt-6 divide-y divide-border rounded-xl border border-border bg-white px-5"><div className="flex justify-between py-5"><dt>Launcher</dt><dd className="text-sm text-muted-foreground">{development ? "Development build" : version ?? "Unavailable"}</dd></div><div className="flex justify-between py-5"><dt>Jouzu</dt><dd className="text-sm text-muted-foreground">{components?.jouzu ?? "Unavailable"}</dd></div></dl><p className="mt-5 rounded-lg bg-muted p-4 text-sm text-muted-foreground">In-app updates are not available in this build. No update check has been performed.</p></section>}
    <footer className="flex min-h-16 items-center gap-2 border-t border-border py-4 text-xs text-muted-foreground" role="status" aria-live="polite">{busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{operation === "preparing" ? "Preparing required tools…" : operation === "launching" ? "Opening Jouzu…" : operation === "choosing" ? "Choose a folder in the dialog." : operation === "saving" ? "Saving…" : notice ?? (!state ? "Connecting to launcher…" : !state.ready ? "Application files are missing. Repair the installation to continue." : "Your project files stay in their original folders.")}</footer>
  </main>;
}
