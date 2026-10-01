import jouzuIcon from "./assets/jouzu.svg";
import { useEffect, useState, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Input } from "./components/ui/input";
import { getVersion } from "@tauri-apps/api/app";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Search, X, ArrowUpRight, Settings, Languages, RefreshCw, LoaderCircle, Minus, Plus } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from "./components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { ScrollArea } from "./components/ui/scroll-area";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "./components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./components/ui/select";
import { Button } from "./components/ui/button";
import { messages, locales, resolveLocale, type Locale } from "./i18n";
import { type Workspace } from "./history";
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
  const [setup, setSetup] = useState<{ profile: string | null; account: { signedIn: boolean }; providers: {id:string;name:string}[]; credentials: {providerId:string}[]; models: {provider:string;id:string;name:string}[]; defaultProvider?:string; defaultModel?:string } | null>(null);
  const [provider, setProvider] = useState("");
  const [token, setToken] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<"requested" | "removed" | null>(null);
  const busy = operation !== null;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const listRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  async function addFolders(paths: string[]) {
    setOperation("saving"); setError(null);
    try { await invoke("add_workspaces", { paths }); setQuery(""); await refresh(); }
    catch (error) { setError(String(error)); }
    finally { setOperation(null); }
  }
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const subscription = getCurrentWindow().onDragDropEvent(event => {
      const payload = event.payload;
      if (payload.type === "leave") { setDragging(false); return; }
      const rect = listRef.current?.getBoundingClientRect();
      const x = payload.position.x / window.devicePixelRatio;
      const y = payload.position.y / window.devicePixelRatio;
      const inside = !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      setDragging(inside && payload.type !== "drop");
      if (payload.type === "drop" && inside && !busyRef.current && !settingsOpen) void addFolders(payload.paths);
    });
    subscription.then(unlisten => { if (disposed) unlisten(); }).catch(error => setError(String(error)));
    return () => { disposed = true; subscription.then(unlisten => unlisten()).catch(() => {}); };
  }, [settingsOpen]);
  async function configure(request: Record<string, unknown>) {
    setOperation("saving"); setError(null);
    try { setSetup(await invoke("control_request", { request })); }
    catch (error) { setError(String(error)); }
    finally { setOperation(null); }
  }
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (settingsOpen && isTauri()) void configure({ action: "status" }); }, [settingsOpen]);
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
      if (typeof path === "string") await addFolders([path]);
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
  return <main className="mx-auto flex h-screen max-w-4xl flex-col px-5 sm:px-6">
    <header className="flex items-center justify-between border-b border-border py-3">
      <div className="absolute left-0 right-0 top-0 h-2" data-tauri-drag-region />
      <div className="flex items-center gap-3"><img src={jouzuIcon} alt="" className="size-9" /><h1 data-tauri-drag-region className="min-w-16 flex-1 text-lg font-semibold tracking-tight">Jouzu</h1></div>
      <div className="flex items-center gap-1"><Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogTrigger asChild><Button variant="ghost" aria-label={t.settings} title={t.settings}><Settings /></Button></DialogTrigger>
        <DialogContent showCloseButton={false} className="flex h-[min(560px,85dvh)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl border-border p-0 sm:max-w-3xl">
          {error && <p role="alert" className="border-b border-border bg-red-50 px-4 py-2 text-sm text-red-900">{error}</p>}
          <DialogDescription className="sr-only">{t.preferences}</DialogDescription>
          <Tabs defaultValue="providers" orientation="vertical" className="min-h-0 flex-1 gap-0">
            <aside className="w-36 shrink-0 border-r border-border bg-muted/60 p-3 sm:w-48">
              <DialogTitle className="mb-5 flex items-center gap-2 px-2 pt-2 text-sm font-semibold"><Settings className="size-4" />{t.settings}</DialogTitle>
              <TabsList aria-label={t.settings} className="h-auto w-full items-stretch gap-1 bg-transparent p-0">
                <TabsTrigger value="providers" className="min-h-10 justify-start px-3">{t.providers}</TabsTrigger>
                <TabsTrigger value="general" className="min-h-10 justify-start gap-2 px-3"><Languages className="size-4" />{t.general}</TabsTrigger>
                <TabsTrigger value="about" className="min-h-10 justify-start whitespace-normal px-3 text-left">{t.versions}</TabsTrigger>
              </TabsList>
            </aside>
            <ScrollArea className="min-w-0 flex-1">
              <div className="px-5 pb-6 pt-14 sm:px-6">
                <TabsContent value="providers" className="m-0 space-y-4">
                  <Card className="border-border shadow-none"><CardHeader><CardTitle>{t.providers}</CardTitle></CardHeader><CardContent className="space-y-4">
                    <Select value={provider} onValueChange={value => { setProvider(value); setToken(""); }}><SelectTrigger className="w-full" aria-label={t.providers}><SelectValue placeholder={t.providers} /></SelectTrigger><SelectContent>{setup?.providers.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
                    {provider && <><Input type="password" autoComplete="off" aria-label={t.apiKey} placeholder={t.apiKey} value={token} onChange={event => setToken(event.target.value)} /><div className="flex gap-2"><Button disabled={busy || !token.trim()} onClick={async () => { await configure({ action: "provider-key", provider, token }); setToken(""); }}>{t.save}</Button>{setup?.credentials.some(c => c.providerId === provider) && <Button variant="outline" disabled={busy} onClick={() => void configure({ action: "provider-remove", provider })}>{t.removeCredential}</Button>}</div>
                    <Select value={setup?.defaultProvider === provider ? setup.defaultModel : ""} onValueChange={model => void configure({ action: "default-model", provider, model })}><SelectTrigger className="w-full" aria-label={t.defaultModel}><SelectValue placeholder={t.defaultModel} /></SelectTrigger><SelectContent>{setup?.models.filter(m => m.provider === provider).map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select></>}
                  </CardContent></Card>
                </TabsContent>
                <TabsContent value="general" className="m-0 space-y-4">
                  <Card className="border-border shadow-none"><CardHeader><CardTitle>{t.language}</CardTitle></CardHeader><CardContent>
                    <Select value={locale} onValueChange={value => setLocale(value as Locale)}><SelectTrigger aria-label={t.language} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(locales).map(([key,label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select>
                  </CardContent></Card>
                  <Card className="border-border shadow-none"><CardHeader><CardTitle>{t.profile}</CardTitle><CardDescription>{t.profileHint}</CardDescription></CardHeader><CardContent><Select disabled={busy || !setup} value={setup?.profile ?? ""} onValueChange={profile => void configure({ action: "profile", profile })}><SelectTrigger className="w-full" aria-label={t.profile}><SelectValue placeholder={t.chooseProfile} /></SelectTrigger><SelectContent><SelectItem value="core">{t.coreProfile}</SelectItem><SelectItem value="ja">{t.jaProfile}</SelectItem></SelectContent></Select></CardContent></Card>

                </TabsContent>
                <TabsContent value="about" className="m-0 space-y-4">
                  <Card className="border-border shadow-none"><CardHeader><CardTitle>{t.versions}</CardTitle></CardHeader><CardContent><dl className="divide-y divide-border text-sm"><div className="flex justify-between gap-4 py-3"><dt>{t.launcher}</dt><dd>{development ? t.development : version ?? t.unavailable}</dd></div><div className="flex justify-between gap-4 py-3"><dt>Jouzu</dt><dd>{components?.jouzu ?? t.unavailable}</dd></div><div className="flex justify-between gap-4 py-3"><dt>{t.tools}</dt><dd>{state?.bash ? t.available : t.firstUse}</dd></div></dl></CardContent></Card>
                  <Card className="border-border shadow-none"><CardHeader><CardTitle>{t.versions}</CardTitle><CardDescription>{t.noUpdates}</CardDescription></CardHeader><CardContent><Button variant="outline" disabled={busy || !isTauri()} onClick={() => { refresh().catch(error => setError(String(error))); invoke<Components>("component_versions").then(setComponents).catch(error => setError(String(error))); }}><RefreshCw />{t.refresh}</Button></CardContent></Card>
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>
          <DialogClose asChild><Button variant="ghost" className="absolute right-2 top-2 px-3" aria-label={t.dismiss}><X /></Button></DialogClose>
        </DialogContent>
      </Dialog>
      {isTauri() && <><Button variant="ghost" aria-label={t.minimize} onClick={() => getCurrentWindow().minimize().catch(error => setError(String(error)))}><Minus /></Button><Button variant="ghost" aria-label={t.closeWindow} onClick={() => getCurrentWindow().close().catch(error => setError(String(error)))}><X /></Button></>}
      </div>
    </header>
    {error && <div role="alert" className="mt-5 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><div><p className="font-medium">{t.error}</p><details className="mt-2 break-all"><summary className="cursor-pointer">{t.details}</summary><p className="mt-2">{error}</p></details></div><button onClick={() => setError(null)} aria-label={t.dismiss}><X className="size-4" /></button></div>}
    <section className="flex min-h-0 flex-1 flex-col py-4" aria-label={t.home}>
      <div className="flex items-center gap-2 rounded-t-xl border border-b-0 border-border bg-card px-3 py-2"><Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><Input aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div ref={listRef} aria-busy={busy} className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-xl border bg-card ${dragging ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="divide-y divide-border">
            <li><Button variant="ghost" className="w-full justify-start rounded-none px-5 py-4" onClick={chooseFolder} disabled={!state || busy} aria-label={t.addFolder} title={t.addFolder}><Plus /><span>{t.addFolder}</span></Button></li>
            {recent.map(workspace => <li key={workspace.id} className="flex items-center gap-1 px-2 hover:bg-muted/50"><Button variant="ghost" disabled={busy || !state?.ready} onClick={() => launch(workspace.path)} className="h-auto min-w-0 flex-1 justify-start rounded-none px-3 py-3 text-left" title={workspace.path}><FolderOpen className="shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block truncate">{workspace.path.split(/[\/]/).filter(Boolean).at(-1) ?? workspace.path}</span><span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{workspace.path}</span></span><span className="text-xs text-primary">{t.launch}</span><ArrowUpRight className="shrink-0 text-primary" /></Button><Button variant="ghost" disabled={busy} onClick={() => forget(workspace)} title={t.remove} aria-label={`${t.remove}: ${workspace.path}`}><X /></Button></li>)}
          </ul>
          {!query && !recent.length && <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t.dropHint}</p>}
          {query && !recent.length && <p className="p-5 text-sm text-muted-foreground">{t.noResults}</p>}
        </ScrollArea>
      </div>
    </section>
    {(busy || notice || (state && !state.ready)) && <footer className="flex min-h-10 items-center gap-2 border-t border-border py-4 text-xs text-muted-foreground" role="status" aria-live="polite">{busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{operation === "preparing" ? t.preparing : operation === "launching" ? t.launching : operation === "choosing" ? t.choosing : operation === "saving" ? t.saving : (notice ? t[notice] : null) ?? (!state ? t.connecting : !state.ready ? t.repair : "")}</footer>}
  </main>;
}
