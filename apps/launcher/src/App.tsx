import { LauncherPage } from "./components/launcher-page";
import { ProviderPicker } from "./components/ui/provider-picker";
import { onboardingPreview, previewState, onboardingText } from "./onboarding-preview";
import { recoveryText } from "./recovery-text";
import { UpdatePreview } from "./update-preview";
import { useJouzuUpdate } from "./use-jouzu-update";
import { useLauncherUpdate } from "./use-launcher-update";
import { Label } from "./components/ui/label";
import { openUrl } from "@tauri-apps/plugin-opener";
import { parseControlState, type ControlState } from "./control-state";
import { Switch } from "./components/ui/switch";
import { listen } from "@tauri-apps/api/event";
import jouzuIcon from "./assets/jouzu.svg";
import { useEffect, useState, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Input } from "./components/ui/input";
import { getVersion } from "@tauri-apps/api/app";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Search, X, ArrowUpRight, Settings, Languages, KeyRound, SlidersHorizontal, RefreshCw, LoaderCircle, Minus, Plus } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from "./components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { ScrollArea } from "./components/ui/scroll-area";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "./components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./components/ui/select";
import { Button } from "./components/ui/button";
import { messages, locales, resolveLocale, type Locale } from "./i18n";
import { type Workspace } from "./history";
interface LauncherState { platform: "windows" | "macos" | "linux"; recent: Workspace[]; ready: boolean; bash: boolean; bundled_git: boolean }
interface Components { jouzu: string | null; development: boolean; launcherUpdaterConfigured?: boolean; jouzuUpdaterConfigured?: boolean }
export function App() {
  const [locale, setLocale] = useState<Locale>(() => resolveLocale(localStorage.getItem("jouzu.ui.language") ?? navigator.language));
  const t = messages[locale];
  const ot = onboardingText[locale];
  const [previewReady, setPreviewReady] = useState(false);
  const [workspacePage, setWorkspacePage] = useState(false);
  const [japaneseOverride, setJapaneseOverride] = useState<boolean | null>(null);
  const japaneseChoice = japaneseOverride ?? locale === "ja";

  useEffect(() => { document.documentElement.lang = locale; localStorage.setItem("jouzu.ui.language", locale); }, [locale]);
  const [state, setState] = useState<LauncherState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<"choosing" | "launching" | "preparing" | "saving" | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [components, setComponents] = useState<Components | null>(null);
  const jouzuUpdater = useJouzuUpdate(!import.meta.env.DEV && components?.jouzuUpdaterConfigured === true, () => {void invoke<Components>("component_versions").then(setComponents).catch(error => setError(String(error)));});
  const updater = useLauncherUpdate(!import.meta.env.DEV && components?.launcherUpdaterConfigured === true);
  const [settingsTab,setSettingsTab] = useState("providers");
  const [sort, setSort] = useState(() => localStorage.getItem("jouzu.folder.sort") ?? "added");
  const [connectionMode, setConnectionMode] = useState<"builtin" | "custom">("builtin");
  const [providerQuery, setProviderQuery] = useState("");
  const [addingConnection, setAddingConnection] = useState(false);
  const [query, setQuery] = useState("");
  const [setup, setSetup] = useState<ControlState | null>(() => onboardingPreview ? previewState() : null);
  const modelReady = onboardingPreview ? previewReady : setup?.modelReady;
  const needsSetup = modelReady === false;
  const showSetup = needsSetup && !workspacePage;
  useEffect(() => { setWorkspacePage(false); }, [modelReady]);
  const [device, setDevice] = useState<{url:string;code:string} | null>(null);
  useEffect(() => {
    if (!isTauri() || onboardingPreview) return;
    const pending = listen<{url:string;code:string}>("control-device", event => setDevice(event.payload));
    return () => { pending.then(unlisten => unlisten()).catch(() => {}); };
  }, []);
  const [envRows, setEnvRows] = useState<{name:string;value:string;enabled:boolean}[]>([]);
  const [editingEnv, setEditingEnv] = useState<number | null>(null);
  const [envLoaded, setEnvLoaded] = useState(false);
  async function readEnvironment() {
    if (onboardingPreview) {setEnvRows([]);setEnvLoaded(true);return;}
    try { setEnvRows(await invoke("environment_read")); setEnvLoaded(true); setEditingEnv(null); }
    catch (error) { setError(String(error)); }
  }
  async function saveEnvironment() {
    if (onboardingPreview) {setEditingEnv(null);return;}
    setOperation("saving"); setError(null);
    try { await invoke("environment_save", { entries: envRows }); setEditingEnv(null); setSetup(parseControlState(await invoke<unknown>("control_request", {request:{action:"status"}}))); }
    catch (error) { setError(String(error)); }
    finally { setOperation(null); }
  }
  const [custom, setCustom] = useState({provider:"",url:"",model:"",edit:false});
  const [provider, setProvider] = useState("");
  const [token, setToken] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<"requested" | "removed" | null>(null);
  const busy = operation !== null;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // The configuration service allows one operation at a time; serialize requests
  // so development remounts or overlapping menu opens cannot collide.
  const controlQueue = useRef<Promise<unknown>>(Promise.resolve());
  const initialStatusRequested = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  async function addFolders(paths: string[]) {
    if (onboardingPreview) return;
    setOperation("saving"); setError(null);
    try { await invoke("add_workspaces", { paths }); setQuery(""); await refresh(); }
    catch (error) { setError(String(error)); }
    finally { setOperation(null); }
  }
  useEffect(() => {
    if (!isTauri() || onboardingPreview) return;
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
    if (onboardingPreview) {
      if (request.action === "profile") setSetup(value => value && ({...value,profile:String(request.profile)}));
      if (request.action === "shisa-login") setDevice({url:"https://platform.shisa.ai/connect",code:"DEMO-1234"});
      if (["provider-key","custom-provider","default-model"].includes(String(request.action))) {setPreviewReady(true);setWorkspacePage(false);}
      if (request.action === "shisa-logout" || request.action === "provider-remove") {setPreviewReady(false);setWorkspacePage(false);}
      return true;
    }
    const run = controlQueue.current.then(async () => {
      setOperation("saving"); setError(null);
      try { const next = parseControlState(await invoke<unknown>("control_request", { request })); setSetup(next);
        return true; }
      catch (error) { setError(String(error)); return false; }
      finally { setOperation(null); setDevice(null); }
    });
    controlQueue.current = run.catch(() => {});
    return run;
  }
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (settingsOpen && isTauri()) { if (!setup && !busyRef.current) void configure({ action: "status" }); void readEnvironment(); } }, [settingsOpen]);
  const refresh = async () => setState(await invoke<LauncherState>("launcher_state"));
  useEffect(() => {
    if (!isTauri() || onboardingPreview) return;
    refresh().catch(error => setError(String(error)));
    if (!initialStatusRequested.current) { initialStatusRequested.current = true; void configure({action:"status"}); }
    getVersion().then(setVersion).catch(error => setError(String(error)));
    invoke<Components>("component_versions").then(setComponents).catch(error => setError(String(error)));
  }, []);
  async function launch(path: string) {
    if (onboardingPreview) {if (!previewReady) setWorkspacePage(false);return;}
    if (!state?.ready) return;
    setOperation("launching"); setError(null); setNotice(null);
    try {
      if (needsSetup) {setWorkspacePage(false);return;}
      setOperation("launching");
      await invoke("launch_jouzu", { path });
      setNotice("requested");
      await refresh();
    } catch (error) { setError(String(error)); } finally { setOperation(null); }
  }
  async function chooseFolder() {
    if (onboardingPreview) return;
    setOperation("choosing"); setError(null);
    try {
      const path = await open({ directory: true, multiple: false, title: t.picker });
      if (typeof path === "string") await addFolders([path]);
    } catch (error) { setError(String(error)); } finally { setOperation(null); }
  }
  async function forget(workspace: Workspace) {
    if (onboardingPreview) return;
    setOperation("saving"); setError(null);
    try {
      await invoke("forget_workspace", { id: workspace.id }); await refresh();
      setNotice("removed");
    } catch (error) { setError(String(error)); } finally { setOperation(null); }
  }
  useEffect(() => {
    if (onboardingPreview) setState({platform:"windows",ready:true,bash:true,bundled_git:true,recent:[{id:"preview-workspace",path:"C:/Projects/Jouzu",environment:{kind:"windows"}}]});
  }, []);
  const recent = state?.recent.filter(item => item.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  if (sort === "name") recent.sort((a,b) => a.path.replaceAll(String.fromCharCode(92), "/").split("/").at(-1)!.localeCompare(b.path.replaceAll(String.fromCharCode(92), "/").split("/").at(-1)!, locale));
  if (sort === "path") recent.sort((a,b) => a.path.localeCompare(b.path, locale));
  const development = components?.development ?? import.meta.env.DEV;
  const inlineProviders = showSetup && !settingsOpen;
  const providerContent = <div className="space-y-4">                  {(inlineProviders || !addingConnection) && <><Card className={inlineProviders ? "gap-3 rounded-none border-0 bg-transparent p-0 shadow-none" : "border-border gap-4 py-5 shadow-none"}><CardHeader className={inlineProviders ? "px-0" : undefined}><CardTitle>Shisa</CardTitle><CardDescription>{t.shisaHint}</CardDescription></CardHeader><CardContent className={inlineProviders ? "space-y-3 px-0" : "space-y-3"}><p className="text-sm text-muted-foreground">{device ? t.waitingAuthorization : setup?.account.signedIn ? t.credentialPresent : t.notConfigured}</p>{!device && <div className="flex justify-end"><Button disabled={busy || !setup} onClick={() => void configure({ action: setup?.account.signedIn ? "shisa-logout" : "shisa-login" })}>{setup?.account.signedIn ? t.signOut : t.signIn}</Button></div>}{device && <div className="space-y-3"><Input readOnly aria-label={t.loginUrl} value={device.url} onFocus={event => event.target.select()} /><Input readOnly aria-label={t.deviceCode} value={device.code} onFocus={event => event.target.select()} /><p className="text-xs text-muted-foreground">{t.loginHint}</p><div className="flex items-center justify-end gap-2"><Button variant="outline" onClick={() => {if(onboardingPreview) setDevice(null);else void invoke("cancel_control");}}>{t.cancel}</Button><Button onClick={async () => { try { const url = new URL(device.url); if (url.origin !== "https://platform.shisa.ai" || url.pathname !== "/connect" || url.username || url.password) throw new Error(t.loginUrl); if (!onboardingPreview) await openUrl(url.href); } catch (error) { setError(String(error)); } }}><ArrowUpRight />{t.openBrowser}</Button></div></div>}</CardContent></Card>
                  {!inlineProviders && <>                  <Card className="border-border gap-4 py-5 shadow-none"><CardHeader><CardTitle>{t.connections}</CardTitle></CardHeader><CardContent className="space-y-2">{!!setup && setup.credentials.length + setup.customProviders.length > 5 && <Input aria-label={t.searchProviders} placeholder={t.searchProviders} value={providerQuery} onChange={event => setProviderQuery(event.target.value)} />}{!addingConnection && setup && [...new Set([...setup.credentials.map(c => c.providerId), ...setup.customProviders.map(c => c.id)])].filter(id => `${id} ${setup.providers.find(p => p.id === id)?.name ?? ""}`.toLowerCase().includes(providerQuery.toLowerCase())).map(id => ({providerId:id})).map(c => <div key={c.providerId} className="flex items-center gap-2"><Button variant="outline" className="h-auto min-w-0 flex-1 justify-between gap-2 py-3" disabled={busy} onClick={() => { setProvider(c.providerId); setToken(""); const saved = setup?.customProviders.find(p => p.id === c.providerId); setConnectionMode(saved?.editable ? "custom" : "builtin"); setCustom(saved?.editable ? {provider:saved.id,url:saved.url,model:saved.model,edit:true} : {provider:"",url:"",model:"",edit:false}); setAddingConnection(true); }}><span>{setup.providers.find(p => p.id === c.providerId)?.name ?? c.providerId}</span><span className="text-xs text-muted-foreground">{setup.credentials.some(key => key.providerId === c.providerId) ? t.credentialSaved : t.configuredNoKey}</span></Button></div>)}<Button variant="outline" disabled={busy || !setup} onClick={() => { setProviderQuery(""); setProvider(""); setConnectionMode("builtin"); setCustom({provider:"",url:"",model:"",edit:false}); setAddingConnection(true); }}><Plus />{t.addConnection}</Button></CardContent></Card></>}</>}
                  {(inlineProviders || addingConnection) && <section className={inlineProviders ? "space-y-3 border-t border-border pt-4" : "space-y-4 rounded-xl border border-border bg-card p-5"}><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{inlineProviders ? t.connections : custom.edit ? t.editConnection : t.addConnection}</h3>{!inlineProviders && <Button variant="ghost" disabled={busy} onClick={() => setAddingConnection(false)}>{t.backConnections}</Button>}</div><div className="space-y-4">
                  <div className="space-y-2">{!inlineProviders && <Label>{t.service}</Label>}<ProviderPicker value={connectionMode === "custom" ? "__custom__" : provider} disabled={busy || custom.edit} label={t.service} placeholder={t.chooseService} searchLabel={t.searchProviders} empty={t.noResults} items={[...(setup?.providers ?? []),{id:"__custom__",name:t.customProvider}]} onChange={value => { setToken(""); if(value === "__custom__") {setConnectionMode("custom");setProvider("");} else {setConnectionMode("builtin");setProvider(value);} }}/></div>

                  {connectionMode === "builtin" && provider &&
                  <div className="space-y-4 border-t border-border pt-4">

                    {provider && <><Label>{t.apiKey}</Label><Input type="password" autoComplete="off" aria-label={t.apiKey} placeholder={t.apiKey} value={token} onChange={event => setToken(event.target.value)} /><div className="flex justify-end gap-2"><Button disabled={busy || !token.trim()} onClick={async () => { if (await configure({ action: "provider-key", provider, token })) { setToken(""); setAddingConnection(false); } }}>{t.save}</Button>{setup?.credentials.some(c => c.providerId === provider) && <Button variant="outline" disabled={busy} onClick={() => void configure({ action: "provider-remove", provider })}>{t.removeCredential}</Button>}</div>
                    <Label>{t.defaultModel}</Label><Select value={setup?.defaultProvider === provider ? setup.defaultModel : ""} onValueChange={model => void configure({ action: "default-model", provider, model })}><SelectTrigger className="w-full" aria-label={t.defaultModel}><SelectValue placeholder={t.defaultModel} /></SelectTrigger><SelectContent>{setup?.models.filter(m => m.provider === provider).map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select></>}
                  </div>}
                  {connectionMode === "custom" &&<div className="space-y-3 border-t border-border pt-4"><p className="text-sm text-muted-foreground">{t.customHint}</p><Label>{t.providerId}</Label><Input placeholder={t.providerId} aria-label={t.providerId} disabled={custom.edit} value={custom.provider} onChange={event => setCustom({...custom,provider:event.target.value})} /><Label>{t.endpoint}</Label><Input placeholder={t.endpoint} aria-label={t.endpoint} value={custom.url} onChange={event => setCustom({...custom,url:event.target.value})} /><Label>{t.modelId}</Label><Input placeholder={t.modelId} aria-label={t.modelId} value={custom.model} onChange={event => setCustom({...custom,model:event.target.value})} /><Label>{t.apiKey}</Label><Input type="password" autoComplete="off" aria-label={t.apiKey} placeholder={t.apiKey} value={token} onChange={event=>setToken(event.target.value)}/><div className="flex justify-end pt-1"><Button disabled={busy || !custom.provider || !custom.url || !custom.model} onClick={async () => { if (await configure({action:"custom-provider",...custom})) { setCustom(value=>({...value,edit:true})); if (token.trim() && !await configure({action:"provider-key",provider:custom.provider,token})) return; setToken("");setAddingConnection(false); } }}>{t.save}</Button></div></div>}
                  </div></section>}
{onboardingPreview && device && <Button onClick={() => {setDevice(null);setPreviewReady(true);setWorkspacePage(false);setSetup(value=>value && ({...value,account:{signedIn:true}}));}}>{ot.complete}</Button>}</div>;
  return <main className="flex h-screen w-full flex-col px-5 sm:px-6">
    <header data-tauri-drag-region className="flex items-center justify-between border-b border-border py-3">
      <div className="absolute left-0 right-0 top-0 h-3" data-tauri-drag-region />
      <div className="pointer-events-none flex items-center gap-3"><img src={jouzuIcon} alt="" draggable={false} className="size-9" /><h1 className="min-w-16 flex-1 text-lg font-semibold tracking-tight">Jouzu</h1></div>
      <div className="pointer-events-none flex items-center gap-1 [&>*]:pointer-events-auto"><Dialog open={settingsOpen} onOpenChange={value => { if (!value && device) {if(onboardingPreview) setDevice(null); else void invoke("cancel_control")}; setSettingsOpen(value); }}>
        <>{(onboardingPreview || updater.version || jouzuUpdater.version) && <Button variant="outline" onClick={() => {setSettingsTab("about");setSettingsOpen(true);}}>{t.updateAvailable}</Button>}</><DialogTrigger asChild><Button variant="ghost" aria-label={t.settings} title={t.settings}><Settings /></Button></DialogTrigger>
        <DialogContent showCloseButton={false} className="flex h-[min(560px,85dvh)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl border-border p-0 sm:max-w-3xl">
          {error && <p role="alert" className="border-b border-border bg-red-50 px-4 py-2 text-sm text-red-900">{error}</p>}
          <DialogDescription className="sr-only">{t.preferences}</DialogDescription>
          <Tabs value={settingsTab} onValueChange={setSettingsTab} orientation="vertical" className="min-h-0 flex-1 gap-0">
            <aside className="w-36 shrink-0 border-r border-border bg-muted/60 p-3 sm:w-48">
              <DialogTitle className="mb-5 flex items-center gap-2 px-2 pt-2 text-sm font-semibold"><Settings className="size-4" />{t.settings}</DialogTitle>
              <TabsList aria-label={t.settings} className="h-auto w-full items-stretch gap-1 bg-transparent p-0">
                <TabsTrigger value="providers" className="min-h-10 justify-start gap-2 px-3"><KeyRound className="size-4 shrink-0" aria-hidden="true" />{t.providers}</TabsTrigger>
                <TabsTrigger value="environment" className="min-h-10 justify-start gap-2 px-3"><SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />{t.environment}</TabsTrigger><TabsTrigger value="general" className="min-h-10 justify-start gap-2 px-3"><Languages className="size-4 shrink-0" aria-hidden="true" />{t.general}</TabsTrigger>
                <TabsTrigger value="about" className="min-h-10 justify-start gap-2 whitespace-normal px-3 text-left"><RefreshCw className="size-4 shrink-0" aria-hidden="true" />{t.versions}</TabsTrigger>
              </TabsList>
            </aside>
            <ScrollArea className="min-w-0 flex-1">
              <div className="px-5 pb-6 pt-14 sm:px-6">
                <TabsContent value="providers" className="m-0 space-y-4">
                  {providerContent}
                </TabsContent>
                <TabsContent value="environment" className="m-0 space-y-4"><Card className="border-border shadow-none"><CardHeader><CardTitle>{t.environment}</CardTitle><CardDescription>{t.envHint}</CardDescription></CardHeader><CardContent className="space-y-3">
                  {envRows.map((row,index) => <div key={index} className="space-y-2 rounded-lg border border-border p-3"><div className="flex items-center gap-2">{editingEnv === index ? <Input aria-label={t.variableName} placeholder={t.variableName} value={row.name} disabled={busy} onChange={event => setEnvRows(rows => rows.map((r,i) => i === index ? {...r,name:event.target.value} : r))} /> : <span className="min-w-0 flex-1 truncate text-sm font-medium" title={row.name}>{row.name}</span>}<Button variant="ghost" disabled={busy} onClick={() => setEditingEnv(index)}>{t.editValue}</Button><Switch aria-label={t.enabled} checked={row.enabled} disabled={busy} onCheckedChange={enabled => setEnvRows(rows => rows.map((r,i) => i === index ? {...r,enabled} : r))} /><Button variant="ghost" disabled={busy} aria-label={t.deleteEntry} onClick={() => { setEnvRows(rows => rows.filter((_,i) => i !== index)); setEditingEnv(null); }}><X /></Button></div>{editingEnv === index && <Input type="password" autoComplete="off" aria-label={t.variableValue} placeholder={t.variableValue} value={row.value} disabled={busy} onChange={event => setEnvRows(rows => rows.map((r,i) => i === index ? {...r,value:event.target.value} : r))} />}</div>)}
                  <div className="flex gap-2"><Button variant="outline" disabled={!envLoaded || busy} onClick={() => { setEditingEnv(envRows.length); setEnvRows(rows => [...rows,{name:"",value:"",enabled:true}]); }}><Plus />{t.addEntry}</Button><Button className="ml-auto" disabled={!envLoaded || busy} onClick={saveEnvironment}>{t.save}</Button></div>
                </CardContent></Card></TabsContent>
                <TabsContent value="general" className="m-0 space-y-4">
                  <Card className="border-border shadow-none"><CardHeader><CardTitle>{t.language}</CardTitle><CardDescription>{t.languageHint}</CardDescription></CardHeader><CardContent>
                    <Select value={locale} onValueChange={value => setLocale(value as Locale)}><SelectTrigger aria-label={t.language} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(locales).map(([key,label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select>
                    <div className="mt-6 space-y-3 border-t border-border pt-5">
                      <div className="flex items-center justify-between gap-4"><Label htmlFor="japanese-first">{t.profile}</Label><Switch id="japanese-first" disabled={busy || !setup} checked={setup?.profile === "ja"} aria-describedby="japanese-first-description" onCheckedChange={enabled => void configure({ action: "profile", profile: enabled ? "ja" : "core" })} /></div>
                      <p id="japanese-first-description" className="text-sm leading-relaxed text-muted-foreground">{t.profileHint}</p>
                      <p className="text-sm leading-relaxed text-muted-foreground">{t.profileOffHint}</p>
                    </div>
                  </CardContent></Card>

                </TabsContent>
                <TabsContent value="about" className="m-0 space-y-4">
                  <details><summary className="cursor-pointer text-sm">{recoveryText[locale].title}</summary>
                    <p className="my-2 text-sm text-muted-foreground">{recoveryText[locale].description}</p>
                    <Button variant="outline" disabled={busy || updater.busy || jouzuUpdater.busy || import.meta.env.DEV} onClick={async()=>{
                      if (!await confirm(recoveryText[locale].description,{title:recoveryText[locale].title,kind:"warning"})) return;
                      setOperation("saving");setError(null);
                      try {await invoke("repair_jouzu");setComponents(await invoke<Components>("component_versions"));await refresh();}
                      catch(error){setError(String(error));}finally{setOperation(null);}
                    }}>{recoveryText[locale].action}</Button>
                  </details>
                  <UpdatePreview locale={locale} live={onboardingPreview ? undefined : {
                    phases:[jouzuUpdater.phase === 'preparing' || jouzuUpdater.phase === 'verifying' || jouzuUpdater.phase === 'activating' || jouzuUpdater.phase === 'staged' ? 'installing' : jouzuUpdater.phase as 'idle'|'checking'|'available'|'current'|'downloading'|'installing'|'complete'|'error', updater.phase],
                    versions:[components?.jouzu ?? t.unavailable, version ?? t.unavailable],
                    targets:[jouzuUpdater.version,updater.version],
                    progress:jouzuUpdater.busy?jouzuUpdater.progress:updater.progress,
                    configured:[!!components?.jouzuUpdaterConfigured,!!components?.launcherUpdaterConfigured],
                    errors:[jouzuUpdater.error,updater.error],
                    check:()=>{void jouzuUpdater.check();void updater.refresh();},
                    install:index=>{if(index===0)void jouzuUpdater.install();else void updater.install();}
                  }}/>
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
    {onboardingPreview && <div className="flex flex-wrap items-center gap-2 pt-3 text-xs text-muted-foreground"><span>{ot.review}</span><Button variant="ghost" onClick={()=>{setJapaneseOverride(null);setSetup(previewState());setPreviewReady(false);setWorkspacePage(false);setDevice(null);setAddingConnection(false);}}>{ot.reset}</Button><Button variant="ghost" onClick={()=>{setSetup({...previewState(),profile:"core"});setPreviewReady(false);setWorkspacePage(false);setDevice(null);setAddingConnection(false);}}>{ot.existing}</Button><Button variant="ghost" onClick={()=>{setPreviewReady(true);setWorkspacePage(false);setDevice(null);}}>{ot.ready}</Button></div>}
    {!onboardingPreview && !setup ? <LauncherPage title={t.heading} description={t.connecting}><div className="p-6"><Button disabled={busy} onClick={()=>void configure({action:"status"})}>{busy ? t.loading : t.retry}</Button></div></LauncherPage> : showSetup ? <LauncherPage title={setup?.profile ? ot.connect : ot.preferences} description={setup?.profile ? ot.hint : ot.preferencesHint} action={!!state?.recent.length && <Button variant="ghost" onClick={()=>setWorkspacePage(true)}>{ot.workspaces}</Button>}>
      <ScrollArea className="min-h-0 flex-1"><div className="p-5 sm:p-6">
        {!setup?.profile ? <div className="space-y-6 pt-2">
          <div className="space-y-2"><Label>{t.language}</Label><div role="group" aria-label={t.language} className="flex flex-wrap gap-2">{Object.entries(locales).map(([key,label])=><Button key={key} lang={key} className="min-w-28" variant={locale===key ? "default" : "outline"} aria-pressed={locale===key} onClick={()=>setLocale(key as Locale)}>{label}</Button>)}</div><p className="text-sm text-muted-foreground">{t.languageHint}</p></div>
          <div className="space-y-2"><div className="flex items-center gap-4"><Label htmlFor="onboarding-japanese">{t.profile}</Label><Switch id="onboarding-japanese" checked={japaneseChoice} onCheckedChange={setJapaneseOverride}/></div><p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{ot.japaneseHint}</p></div>
          <div className="flex justify-end pt-1"><Button onClick={()=>void configure({action:"profile",profile:japaneseChoice ? "ja" : "core"})}>{ot.next}</Button></div>
        </div> : <>{!settingsOpen && providerContent}</>}
      </div></ScrollArea>
    </LauncherPage> : <LauncherPage title={t.heading} description={t.intro} action={needsSetup && <Button variant="ghost" onClick={()=>setWorkspacePage(false)}>{ot.models}</Button>}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2"><Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><Input aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} /><Select value={sort} onValueChange={value => { setSort(value); localStorage.setItem("jouzu.folder.sort",value); }}><SelectTrigger className="w-40 shrink-0" aria-label={t.sort}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="added">{t.sortAdded}</SelectItem><SelectItem value="name">{t.sortName}</SelectItem><SelectItem value="path">{t.sortPath}</SelectItem></SelectContent></Select></div>
      <div ref={listRef} aria-busy={busy} className={`flex min-h-0 flex-1 flex-col overflow-hidden ${dragging ? "ring-2 ring-inset ring-primary/30" : ""}`}>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="divide-y divide-border">
            <li><Button variant="ghost" className="w-full justify-start rounded-none px-5 py-4" onClick={chooseFolder} disabled={!state || busy} aria-label={t.addFolder} title={t.addFolder}><Plus /><span>{t.addFolder}</span></Button></li>
            {recent.map(workspace => <li key={workspace.id} className="flex items-center gap-1 px-2 hover:bg-muted/50"><Button variant="ghost" disabled={busy || !state?.ready} onClick={() => launch(workspace.path)} className="h-auto min-w-0 flex-1 justify-start rounded-none px-3 py-3 text-left" title={workspace.path}><FolderOpen className="shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block truncate">{workspace.path.replaceAll(String.fromCharCode(92), "/").split("/").filter(Boolean).at(-1) ?? workspace.path}</span><span className="mt-1 block select-text truncate text-xs font-normal text-muted-foreground">{workspace.path}</span></span><span className="text-xs text-primary">{t.launch}</span><ArrowUpRight className="shrink-0 text-primary" /></Button><Button variant="ghost" disabled={busy} onClick={() => forget(workspace)} title={t.remove} aria-label={`${t.remove}: ${workspace.path}`}><X /></Button></li>)}
          </ul>
          {!query && !recent.length && <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t.dropHint}</p>}
          {query && !recent.length && <p className="p-5 text-sm text-muted-foreground">{t.noResults}</p>}
        </ScrollArea>
      </div>
    </LauncherPage>}
    {(busy || notice || (state && !state.ready)) && <footer className="flex min-h-10 items-center gap-2 border-t border-border py-4 text-xs text-muted-foreground" role="status" aria-live="polite">{busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{operation === "preparing" ? t.preparing : operation === "launching" ? t.launching : operation === "choosing" ? t.choosing : operation === "saving" ? t.saving : (notice ? t[notice] : null) ?? (!state ? t.connecting : !state.ready ? t.repair : "")}</footer>}
  </main>;
}
