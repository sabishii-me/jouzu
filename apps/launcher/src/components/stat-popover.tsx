import { useEffect, useRef, useState, type ReactNode } from "react";

/** A compact stat trigger with a DSH-style detail card above it. */
export function StatPopover({ label, children, align = "left" }: { label: ReactNode; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <span ref={root} className="relative inline-flex min-w-0">
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)} className="inline-flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted/60">{label}</button>
    {open && <div role="dialog" aria-modal="false" className={`absolute bottom-full z-40 mb-2 w-72 rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-xl ${align === "right" ? "right-0" : "left-0"}`}>{children}</div>}
  </span>;
}
export function StatRow({ label, value, mono = false }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return <div className="flex items-start justify-between gap-3 py-1"><dt className="text-muted-foreground">{label}</dt><dd className={`select-text text-right ${mono ? "font-mono" : ""}`}>{value}</dd></div>;
}
export function StatCard({ title, value, children }: { title: ReactNode; value?: ReactNode; children: ReactNode }) {
  return <>
    <div className="flex items-start justify-between gap-3 border-b border-border pb-2"><h3 className="font-medium">{title}</h3>{value !== undefined && <span className="select-text font-medium tabular-nums">{value}</span>}</div>
    <dl className="pt-1">{children}</dl>
  </>;
}
