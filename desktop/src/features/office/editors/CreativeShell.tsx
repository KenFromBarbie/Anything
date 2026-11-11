import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2, Maximize2, Minimize2, Save, Sparkles, X } from "lucide-react";

import { cn } from "@/shared/lib/cn";

import { APP, type EditorKind } from "./formats";
import { AskPane } from "./OfficeShell";

export type MenuItem =
  | { label: string; run: () => void; shortcut?: string; disabled?: boolean; checked?: boolean }
  | "-";
export type Menu = { label: string; items: MenuItem[] };

/**
 * The dark workspace the creative editors (Image, Video, 3D, Site) live in,
 * laid out like a pro creative app: a menu bar (File, Edit, …), an options
 * bar for the current tool, then the editor's own tools / canvas / panels,
 * and a status bar. "Ask the CEO" opens on the right; full screen fills the
 * app window.
 */
export function CreativeShell({
  kind,
  badge,
  title,
  onTitle,
  dirty,
  isNew = false,
  saving,
  onSave,
  onClose,
  menus,
  options,
  status,
  ask,
  children,
}: {
  kind: EditorKind;
  /** Two letters on the app badge. */
  badge: string;
  title: string;
  onTitle: (title: string) => void;
  dirty: boolean;
  isNew?: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  menus: Menu[];
  options?: React.ReactNode;
  status: React.ReactNode;
  ask: { placeholder: string; build: (text: string) => Promise<string | null> | string | null };
  children: React.ReactNode;
}) {
  const app = APP[kind];
  const [full, setFull] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const bar = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave();
      }
      if (e.key === "Escape") {
        if (open) setOpen(null);
        else if (full && !isTyping(e)) setFull(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave, full, open]);

  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  const close = () => {
    if (dirty && !window.confirm("Close without saving your changes?")) return;
    onClose();
  };

  const window_ = (
    <div
      className={cn(
        "dark flex select-none flex-col bg-[#1e1e1e] text-[13px] text-[#d4d4d4] [color-scheme:dark] [font-family:'Segoe_UI',system-ui,sans-serif]",
        full
          ? "fixed inset-0 z-[60]"
          : "h-[calc(100vh-11rem)] min-h-[34rem] overflow-hidden rounded-lg border border-black/40 shadow-sm",
      )}
      data-testid={`creative-editor-${kind}`}
    >
      {/* menu bar */}
      <div
        className={cn("flex h-9 shrink-0 items-center gap-1 border-b border-black/50 bg-[#2b2b2b] pl-2", full ? "pr-[8.5rem]" : "pr-2")}
        ref={bar}
      >
        <span
          className="mr-1 flex h-6 w-6 items-center justify-center rounded-[4px] text-[11px] font-bold"
          style={{ background: `${app.color}33`, color: app.color, boxShadow: `inset 0 0 0 1.5px ${app.color}` }}
        >
          {badge}
        </span>
        {menus.map((m) => (
          <div className="relative" key={m.label}>
            <button
              className={cn("h-7 rounded px-2.5", open === m.label ? "bg-[#454545]" : "hover:bg-[#3a3a3a]")}
              onClick={() => setOpen(open === m.label ? null : m.label)}
              onMouseEnter={() => open && setOpen(m.label)}
              type="button"
            >
              {m.label}
            </button>
            {open === m.label ? (
              <div className="absolute left-0 top-8 z-30 min-w-60 rounded-md border border-black/60 bg-[#2f2f2f] py-1 shadow-2xl">
                {m.items.map((it, i) =>
                  it === "-" ? (
                    <div className="my-1 h-px bg-white/10" key={`sep-${i}`} />
                  ) : (
                    <button
                      className="flex w-full items-center gap-6 px-3 py-1.5 text-left hover:bg-[#2f6fd6] hover:text-white disabled:pointer-events-none disabled:opacity-40"
                      disabled={it.disabled}
                      key={it.label}
                      onClick={() => {
                        setOpen(null);
                        it.run();
                      }}
                      type="button"
                    >
                      <span className="w-3 text-[11px]">{it.checked ? "✓" : ""}</span>
                      <span className="flex-1">{it.label}</span>
                      {it.shortcut ? <span className="text-[11px] opacity-60">{it.shortcut}</span> : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ))}
        <div className="mx-auto flex min-w-0 items-center gap-2 px-3">
          <input
            aria-label="File name"
            className="w-56 min-w-0 rounded bg-transparent px-2 py-0.5 text-center outline-none placeholder:text-[#8a8a8a] hover:bg-white/5 focus:bg-[#1a1a1a]"
            onChange={(e) => onTitle(e.target.value)}
            placeholder={`Untitled ${app.noun}`}
            value={title}
          />
          <span className="shrink-0 text-[11px] text-[#8a8a8a]">
            {saving ? "Saving…" : dirty || isNew ? "Not saved" : "Saved to Create"}
          </span>
        </div>
        <ShellButton label="Save (Ctrl+S)" onClick={onSave}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </ShellButton>
        <button
          className={cn("flex h-7 items-center gap-1.5 rounded px-2", asking ? "bg-[#454545]" : "hover:bg-[#3a3a3a]")}
          onClick={() => setAsking((v) => !v)}
          type="button"
        >
          <Sparkles className="h-4 w-4" style={{ color: app.color }} />
          Ask the CEO
        </button>
        <ShellButton label={full ? "Exit full screen (Esc)" : "Full screen"} onClick={() => setFull((v) => !v)}>
          {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </ShellButton>
        <ShellButton label="Close" onClick={close}>
          <X className="h-4 w-4" />
        </ShellButton>
      </div>

      {options ? (
        <div className="flex h-10 shrink-0 items-center gap-3 overflow-x-auto border-b border-black/50 bg-[#323232] px-3">
          {options}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1">{children}</div>
        {asking ? <AskPane kind={kind} onClose={() => setAsking(false)} {...ask} /> : null}
      </div>

      <div className="flex h-6 shrink-0 items-center gap-4 border-t border-black/50 bg-[#2b2b2b] px-3 text-[11px] text-[#9a9a9a]">
        {status}
      </div>
    </div>
  );
  return full ? createPortal(window_, document.body) : window_;
}

function ShellButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded hover:bg-[#3a3a3a]"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

/** A collapsible dark panel, like a dock panel in a creative app. */
export function Panel({
  title,
  tabs,
  tab,
  onTab,
  children,
  className,
  actions,
}: {
  title?: string;
  tabs?: string[];
  tab?: string;
  onTab?: (t: string) => void;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col border-b border-black/60 bg-[#2b2b2b]", className)}>
      <header className="flex h-7 shrink-0 items-center gap-0.5 bg-[#262626] px-1 text-[11px]">
        {tabs
          ? tabs.map((t) => (
              <button
                className={cn(
                  "h-6 rounded-t px-2.5",
                  t === tab ? "bg-[#2b2b2b] text-white" : "text-[#9a9a9a] hover:text-[#d4d4d4]",
                )}
                key={t}
                onClick={() => onTab?.(t)}
                type="button"
              >
                {t}
              </button>
            ))
          : <span className="px-2 font-semibold text-[#cfcfcf]">{title}</span>}
        <span className="flex-1" />
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

/** A labelled slider row for a properties panel. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  onCommit?: () => void;
}) {
  return (
    <label className="flex items-center gap-2 px-3 py-1 text-[11px]">
      <span className="w-20 shrink-0 text-[#b5b5b5]">{label}</span>
      <input
        className="h-1 min-w-0 flex-1 accent-[#2f80ed]"
        max={max}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyUp={onCommit}
        onPointerUp={onCommit}
        step={step}
        type="range"
        value={value}
      />
      <input
        className="w-12 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-right"
        onBlur={onCommit}
        onChange={(e) => onChange(Number(e.target.value))}
        step={step}
        type="number"
        value={Math.round(value * 100) / 100}
      />
      <span className="w-3 text-[#8a8a8a]">{unit}</span>
    </label>
  );
}

/** A small number field for an options bar. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  width = "w-14",
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  width?: string;
  unit?: string;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-[12px]">
      <span className="text-[#a8a8a8]">{label}</span>
      <input
        className={cn("rounded border border-black/50 bg-[#1e1e1e] px-1.5 py-0.5 text-right", width)}
        max={max}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        type="number"
        value={Math.round(value * 100) / 100}
      />
      {unit ? <span className="text-[#8a8a8a]">{unit}</span> : null}
    </label>
  );
}
