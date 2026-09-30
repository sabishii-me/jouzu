import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Terminal, ArrowUpRight } from "lucide-react";
import { Button } from "./components/ui/button";
import { environmentLabel, type Workspace } from "./history";
interface LauncherState { platform: "windows" | "macos" | "linux"; recent: Workspace[] }
export function App() {
  const [state, setState] = useState<LauncherState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    invoke<LauncherState>("launcher_state").then(setState).catch(error => setError(String(error)));
  }, []);
  async function chooseFolder() {
    setBusy(true);
    setError(null);
    try {
      const path = await open({ directory: true, multiple: false, title: "Choose a working folder" });
      if (typeof path === "string") setSelected(path);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-4xl px-6 py-10 sm:px-10">
    <header className="mb-10 flex items-center gap-3">
      <div className="rounded-xl bg-primary p-3 text-primary-foreground"><Terminal aria-hidden="true" /></div>
      <div><h1 className="text-2xl font-semibold tracking-tight">Jouzu</h1><p className="text-sm text-muted-foreground">Your workspace, ready to launch.</p></div>
    </header>
    {!isTauri() && <p role="status" className="mb-6 rounded-lg border border-border p-4 text-sm">Browser preview. Open the native launcher to choose a folder.</p>}
    {error && <p role="alert" className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <section aria-labelledby="workspaces-heading">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="workspaces-heading" className="text-lg font-semibold">Recent folders</h2><p className="text-sm text-muted-foreground">Pick up where you left off, or choose another folder.</p></div>
        <Button onClick={chooseFolder} disabled={!state || busy}><FolderOpen aria-hidden="true" />{busy ? "Choosing…" : "Open folder…"}</Button>
      </div>
      <div className="rounded-xl border border-border bg-white">
        {!state?.recent.length ? <div className="px-6 py-12 text-center"><FolderOpen className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true"/><p className="font-medium">No recent folders yet</p><p className="mt-1 text-sm text-muted-foreground">Your remembered folder appears here when available.</p></div> :
          <ul className="divide-y divide-border">{state.recent.map(workspace => <li key={workspace.id} className="flex items-center gap-3 p-4">
            <FolderOpen className="size-5 shrink-0 text-muted-foreground" aria-hidden="true"/>
            <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{workspace.path}</p><p className="text-xs text-muted-foreground">{environmentLabel(workspace.environment)}</p></div>
            <Button variant="outline" onClick={() => setSelected(workspace.path)}>Select<ArrowUpRight aria-hidden="true"/></Button>
          </li>)}</ul>}
      </div>
    </section>
    <section aria-labelledby="launch-heading" className="mt-6 rounded-xl border border-border p-5">
      <h2 id="launch-heading" className="font-semibold">Launch Jouzu TUI</h2>
      <p className="mt-2 break-all text-sm" aria-live="polite">{selected ?? "Select a working folder to get started."}</p>
      <p id="runtime-status" className="mt-2 text-sm text-muted-foreground">Runtime setup and launching are not connected in this development build.</p>
      <Button className="mt-4" disabled aria-describedby="runtime-status"><Terminal aria-hidden="true"/>Launch Jouzu</Button>
    </section>
    <footer className="mt-8 text-xs text-muted-foreground">Jouzu Launcher · Development build</footer>
  </main>;
}
