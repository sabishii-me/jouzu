import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../components/ui/button";
import { ChatMarkdown } from "../chat-markdown";
import { object, type ToolView } from "../chat-projection";
import { record, toolText } from "./types";

const MAX_LINES = 2000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ANSI = /\u001b\[([0-9;]*)m/g;
const ANSI_COLORS: Record<number, string> = {
  30: "text-black", 31: "text-red-500", 32: "text-green-500", 33: "text-yellow-500",
  34: "text-blue-500", 35: "text-purple-500", 36: "text-cyan-500", 37: "text-foreground",
  90: "text-muted-foreground", 91: "text-red-400", 92: "text-green-400", 93: "text-yellow-400",
  94: "text-blue-400", 95: "text-purple-400", 96: "text-cyan-400", 97: "text-foreground",
};

interface AnsiState { color?: string; bold: boolean; dim: boolean; underline: boolean }
interface AnsiPart { text: string; state: AnsiState }
const plainState = (): AnsiState => ({ bold: false, dim: false, underline: false });

/** Convert the SGR subset Pi tools emit into React spans; never interpret other escapes. */
export function ansiParts(text: string): AnsiPart[] {
  const parts: AnsiPart[] = [];
  let state = plainState();
  let at = 0;
  for (const match of text.matchAll(ANSI)) {
    if (match.index! > at) parts.push({ text: text.slice(at, match.index), state: { ...state } });
    const codes = match[1] ? match[1].split(";").filter(Boolean).map(Number) : [0];
    for (const code of codes) {
      if (code === 0) state = plainState();
      else if (code === 1) state = { ...state, bold: true };
      else if (code === 2) state = { ...state, dim: true };
      else if (code === 4) state = { ...state, underline: true };
      else if (code === 22) state = { ...state, bold: false, dim: false };
      else if (code === 24) state = { ...state, underline: false };
      else if (code === 39) state = { ...state, color: undefined };
      else if (ANSI_COLORS[code]) state = { ...state, color: ANSI_COLORS[code] };
    }
    at = match.index! + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), state: { ...state } });
  return parts;
}

function AnsiPre({ text }: { text: string }) {
  return <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">{ansiParts(text).map((part, index) => <span key={index} className={[part.state.color, part.state.bold ? "font-semibold" : "", part.state.dim ? "opacity-70" : "", part.state.underline ? "underline" : ""].filter(Boolean).join(" ")}>{part.text}</span>)}</pre>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <Button variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { setCopied(false); } }}>{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "Copied" : "Copy"}</Button>;
}

// Button is imported with the other renderer dependencies above.

function truncatedLines(text: string) {
  const lines = text.split("\n");
  return { lines: lines.slice(0, MAX_LINES), truncated: lines.length > MAX_LINES, total: lines.length };
}

function CodeLines({ text }: { text: string }) {
  const { lines, truncated, total } = truncatedLines(text);
  return <div className="max-h-96 overflow-auto rounded-md border border-border/60 bg-background">
    <table className="w-full border-collapse font-mono text-[11px] leading-5"><tbody>{lines.map((line, index) => <tr key={index}>
      <td className="w-10 select-none border-r border-border/60 px-2 text-right align-top text-muted-foreground/70">{index + 1}</td>
      <td className="whitespace-pre-wrap break-words px-3 align-top">{line || " "}</td>
    </tr>)}</tbody></table>
    {truncated && <p className="border-t border-border/60 px-3 py-1 text-[10px] text-muted-foreground">Showing first {MAX_LINES} of {total} lines.</p>}
  </div>;
}

function markdownPath(args: unknown): boolean {
  const value = record(args);
  const path = typeof value?.path === "string" ? value.path : "";
  return /\.(?:md|mdx|markdown)$/iu.test(path);
}

function readPath(args: unknown): string | undefined {
  const value = record(args);
  return typeof value?.path === "string" ? value.path : undefined;
}

function imageBlocks(result: unknown) {
  const value = record(result);
  const blocks = value && Array.isArray(value.content) ? value.content : [];
  return blocks.flatMap(block => {
    const item = record(block);
    if (item?.type !== "image" || typeof item.data !== "string") return [];
    const mime = typeof item.mimeType === "string" ? item.mimeType : "";
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime) || item.data.length * 0.75 > MAX_IMAGE_BYTES) return [];
    return [{ mime, data: item.data, alt: typeof item.alt === "string" ? item.alt : "Tool output image" }];
  });
}

function SearchOutput({ text, pattern }: { text: string; pattern?: string }) {
  const { lines, truncated, total } = truncatedLines(text);
  const safe = pattern ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  return <div className="max-h-96 overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[11px] leading-5">{lines.map((line, index) => {
    if (!safe) return <div key={index} className="whitespace-pre-wrap break-words">{line || " "}</div>;
    const pieces = line.split(new RegExp(`(${safe})`, "giu"));
    return <div key={index} className="whitespace-pre-wrap break-words">{pieces.map((piece, position) => piece.toLowerCase() === pattern?.toLowerCase() ? <mark key={position} className="rounded bg-primary/20 text-foreground">{piece}</mark> : <span key={position}>{piece}</span>)}</div>;
  })}{truncated && <p className="mt-1 text-[10px] text-muted-foreground">Showing first {MAX_LINES} of {total} lines.</p>}</div>;
}

function MarkdownOutput({ text }: { text: string }) {
  const [rendered, setRendered] = useState(true);
  return <div className="rounded-md border border-border/60 bg-background">
    <div className="flex justify-end border-b border-border/60 px-2 py-1"><Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setRendered(value => !value)}>{rendered ? "Source" : "Markdown"}</Button></div>
    <div className="max-h-96 overflow-auto p-3">{rendered ? <ChatMarkdown text={text} /> : <AnsiPre text={text} />}</div>
  </div>;
}

export function ToolOutput({ tool }: { tool: ToolView }) {
  const text = toolText(tool.result);
  const images = imageBlocks(tool.result);
  const path = readPath(tool.args);
  if (images.length) return <div className="space-y-2">{images.map((image, index) => <img key={index} src={`data:${image.mime};base64,${image.data}`} alt={image.alt} className="max-h-80 max-w-full rounded-md border border-border object-contain" />)}{text && <AnsiPre text={text} />}</div>;
  if (!text) return <p className="text-xs text-muted-foreground">No text output.</p>;
  return <div className="space-y-1">
    <div className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wide text-muted-foreground">{tool.name === "read" && path ? path : "Output"}</span><CopyButton text={text} /></div>
    {tool.phase === "error" && <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">Tool failed</p>}
    {tool.name === "bash" ? <AnsiPre text={text} />
      : tool.name === "read" && markdownPath(tool.args) ? <MarkdownOutput text={text} />
        : tool.name === "read" ? <CodeLines text={text} />
          : tool.name === "grep" ? <SearchOutput text={text} pattern={typeof record(tool.args)?.pattern === "string" ? record(tool.args)?.pattern as string : undefined} />
            : <AnsiPre text={text} />}
  </div>;
}
