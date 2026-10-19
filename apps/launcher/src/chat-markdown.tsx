import { useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "./components/ui/button";

function Code({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const [status, setStatus] = useState("");
  return <div className="my-3 overflow-hidden rounded-lg border border-border"><div className="flex justify-end border-b border-border bg-muted px-2"><Button variant="ghost" className="h-8 text-xs" onClick={async event => {
    const text = event.currentTarget.parentElement?.nextElementSibling?.textContent ?? "";
    try { await navigator.clipboard.writeText(text); setStatus("Copied"); } catch { setStatus("Copy failed"); }
  }}>{status || "Copy code"}</Button></div><pre {...props} className="overflow-x-auto bg-background p-3 text-xs leading-relaxed">{children}</pre></div>;
}
export function ChatMarkdown({ text }: { text: string }) {
  const [error, setError] = useState<string | null>(null);
  return <div className="select-text break-words text-sm leading-7 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_table]:block [&_table]:overflow-auto [&_td]:border [&_td]:border-border [&_td]:px-3 [&_th]:border [&_th]:border-border [&_th]:px-3">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: Code,
      a: ({ href, children }) => <button className="inline text-primary underline" onClick={() => { if (!href) return; try { const url = new URL(href); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only public HTTP(S) links can be opened."); void openUrl(url.href).catch(() => setError("Could not open link.")); } catch { setError("This link cannot be opened externally."); } }}>{children}</button>,
      img: ({ alt }) => <span className="text-muted-foreground">[Image: {alt || "remote image not loaded"}]</span>,
    }}>{text}</ReactMarkdown>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
