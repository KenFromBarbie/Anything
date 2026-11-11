import * as React from "react";
import { createPortal } from "react-dom";
import {
  Download,
  Loader2,
  type LucideIcon,
  Maximize2,
  Minimize2,
  Save,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";

import { APP, type EditorKind } from "./formats";

/**
 * The window every editor lives in, laid out like Microsoft Office: the app's
 * coloured title bar (name of the file, save state), a ribbon of tabs with
 * grouped commands, the canvas on a grey background, an "Ask the CEO" pane
 * on the right (like Copilot's), and a status bar.
 */
export function OfficeShell({
  kind,
  title,
  onTitle,
  dirty,
  isNew = false,
  saving,
  onSave,
  onClose,
  tabs,
  exports,
  status,
  ask,
  children,
}: {
  kind: EditorKind;
  title: string;
  onTitle: (title: string) => void;
  dirty: boolean;
  /** Never saved yet. */
  isNew?: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  tabs: { id: string; label: string; content: React.ReactNode }[];
  exports: { label: string; run: () => void }[];
  status: React.ReactNode;
  ask: { placeholder: string; build: (text: string) => Promise<string | null> | string | null };
  children: React.ReactNode;
}) {
  const app = APP[kind];
  const [tab, setTab] = React.useState(tabs[0]?.id ?? "home");
  const [asking, setAsking] = React.useState(false);
  const [fileMenu, setFileMenu] = React.useState(false);
  // In the page by default; full screen fills the app window (still the app).
  const [full, setFull] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave();
      }
      if (e.key === "Escape" && full) setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave, full]);

  const close = () => {
    if (dirty && !window.confirm("Close without saving your changes?")) return;
    onClose();
  };

  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  const window_ = (
    <div
      className={cn(
        "flex flex-col bg-[#f3f3f3] text-[#242424] [font-family:'Segoe_UI',system-ui,sans-serif] dark:bg-[#1f1f1f] dark:text-[#e6e6e6]",
        full
          ? "fixed inset-0 z-[60]"
          : "h-[calc(100vh-11rem)] min-h-[32rem] overflow-hidden rounded-lg border border-black/10 shadow-sm dark:border-white/10",
      )}
      data-testid={`office-editor-${kind}`}
    >
      {/* title bar (full screen: room on the right for the app window's own
          minimise / maximise / close) */}
      <div
        className={cn("flex h-10 shrink-0 items-center gap-3 pl-3 text-white", full ? "pr-[8.5rem]" : "pr-2")}
        style={{ background: app.color }}
      >
        <span className="text-sm font-semibold">{app.name}</span>
        <button
          aria-label="Save"
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/15"
          disabled={saving}
          onClick={onSave}
          title="Save (Ctrl+S)"
          type="button"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </button>
        <div className="mx-auto flex min-w-0 items-center gap-2">
          <input
            aria-label="File name"
            className="w-64 min-w-0 rounded bg-transparent px-2 py-0.5 text-center text-sm outline-none placeholder:text-white/70 hover:bg-white/10 focus:bg-white focus:text-[#242424]"
            onChange={(e) => onTitle(e.target.value)}
            placeholder={`Untitled ${app.noun}`}
            value={title}
          />
          <span className="shrink-0 text-xs text-white/80">
            {saving ? "Saving…" : dirty || isNew ? "Not saved" : "Saved to Create"}
          </span>
        </div>
        <button
          aria-label={full ? "Exit full screen" : "Full screen"}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/15"
          onClick={() => setFull((v) => !v)}
          title={full ? "Exit full screen (Esc)" : "Full screen"}
          type="button"
        >
          {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/15"
          onClick={close}
          title="Close"
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ribbon tabs */}
      <div className="flex h-9 shrink-0 items-end gap-1 border-b border-black/10 bg-white px-2 dark:border-white/10 dark:bg-[#292929]">
        <div className="relative">
          <button
            className="h-8 rounded-t px-3 text-sm font-semibold text-white"
            onClick={() => setFileMenu((v) => !v)}
            style={{ background: app.color }}
            type="button"
          >
            File
          </button>
          {fileMenu ? (
            <div
              className="absolute left-0 top-9 z-10 w-56 rounded-md border border-black/10 bg-white py-1 text-sm shadow-lg dark:border-white/10 dark:bg-[#2d2d2d]"
              onMouseLeave={() => setFileMenu(false)}
            >
              <MenuItem icon={Save} label="Save to Create" onClick={() => { setFileMenu(false); onSave(); }} />
              {exports.map((x) => (
                <MenuItem icon={Download} key={x.label} label={x.label} onClick={() => { setFileMenu(false); x.run(); }} />
              ))}
              <MenuItem icon={X} label="Close" onClick={() => { setFileMenu(false); close(); }} />
            </div>
          ) : null}
        </div>
        {tabs.map((t) => (
          <button
            className={cn(
              "relative h-8 px-3 text-sm",
              t.id === active?.id
                ? "font-semibold"
                : "text-[#424242] hover:bg-black/5 dark:text-[#cfcfcf] dark:hover:bg-white/5",
            )}
            key={t.id}
            onClick={() => setTab(t.id)}
            type="button"
          >
            {t.label}
            {t.id === active?.id ? (
              <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-full" style={{ background: app.color }} />
            ) : null}
          </button>
        ))}
        <span className="flex-1" />
        <button
          className={cn(
            "mb-1 flex h-7 items-center gap-1.5 rounded px-2.5 text-sm",
            asking ? "bg-black/10 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5",
          )}
          onClick={() => setAsking((v) => !v)}
          type="button"
        >
          <Sparkles className="h-4 w-4" style={{ color: app.color }} />
          Ask the CEO
        </button>
      </div>

      {/* ribbon commands */}
      <div className="flex min-h-[5.25rem] shrink-0 items-stretch gap-0 overflow-x-auto border-b border-black/10 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-[#292929]">
        {active?.content}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">{children}</div>
        {asking ? <AskPane kind={kind} onClose={() => setAsking(false)} {...ask} /> : null}
      </div>

      {/* status bar */}
      <div className="flex h-6 shrink-0 items-center gap-4 border-t border-black/10 bg-[#f3f3f3] px-3 text-xs text-[#616161] dark:border-white/10 dark:bg-[#1f1f1f] dark:text-[#a0a0a0]">
        {status}
      </div>
    </div>
  );
  // Full screen covers the app window; in the page it sits where Create's
  // content is.
  return full ? createPortal(window_, document.body) : window_;
}

function MenuItem({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4 opacity-70" />
      {label}
    </button>
  );
}

/** A labelled group of ribbon commands, like Office's "Font" or "Paragraph". */
export function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col border-r border-black/10 px-2 last:border-r-0 dark:border-white/10">
      <div className="flex flex-1 items-center gap-1">{children}</div>
      <div className="pt-0.5 text-center text-[11px] text-[#616161] dark:text-[#a0a0a0]">{label}</div>
    </div>
  );
}

/** A ribbon command: big (icon over label) or small (icon, tooltip). */
export function RibbonButton({
  icon: Icon,
  label,
  onClick,
  active,
  big,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  big?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-center rounded text-[#242424] disabled:opacity-40 dark:text-[#e6e6e6]",
        big ? "h-[3.4rem] min-w-[3.4rem] flex-col gap-0.5 px-1.5 text-[11px]" : "h-7 w-7",
        active ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10",
      )}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      title={label}
      type="button"
    >
      <Icon className={big ? "h-6 w-6" : "h-4 w-4"} />
      {big ? <span className="leading-tight">{label}</span> : null}
    </button>
  );
}

export function RibbonSelect({
  value,
  onChange,
  options,
  width = "w-32",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width?: string;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      className={cn(
        "h-7 rounded border border-black/15 bg-white px-1.5 text-[13px] dark:border-white/15 dark:bg-[#333]",
        width,
      )}
      onChange={(e) => onChange(e.target.value)}
      title={label}
      value={value}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** "Ask the CEO": the editor's assistant pane. What's asked goes to the CEO,
 *  who runs it through the Office; the result comes back as a new version. */
export function AskPane({
  kind,
  onClose,
  placeholder,
  build,
}: {
  kind: EditorKind;
  onClose: () => void;
  placeholder: string;
  build: (text: string) => Promise<string | null> | string | null;
}) {
  const { agents } = useOfficeAgents();
  const ceo = agents.find((a) => a.isGod);
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState<string[]>([]);
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const request = await build(text.trim());
      if (!request) return;
      await callOffice("agent.message", { id: ceo?.id ?? "god", text: request });
      setSent((s) => [...s, text.trim()]);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-black/10 bg-white dark:border-white/10 dark:bg-[#262626]">
      <div className="flex items-center gap-2 border-b border-black/10 px-3 py-2 dark:border-white/10">
        <Sparkles className="h-4 w-4" style={{ color: APP[kind].color }} />
        <span className="text-sm font-semibold">Ask the CEO</span>
        <button aria-label="Close" className="ml-auto rounded p-1 hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose} type="button">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        <p className="text-[#616161] dark:text-[#a0a0a0]">
          {ceo ? `${ceo.name} hands it to the right people in the Office.` : "The Office isn't running."} The
          result comes back here in Create as a new version you can open and keep editing.
        </p>
        {sent.map((s, i) => (
          <div className="rounded-lg bg-[#f0f0f0] px-3 py-2 dark:bg-[#333]" key={`${i}-${s}`}>
            {s}
            <div className="mt-1 text-xs text-[#616161] dark:text-[#a0a0a0]">Sent · on its way back as a new version</div>
          </div>
        ))}
      </div>
      <div className="border-t border-black/10 p-2 dark:border-white/10">
        <textarea
          className="h-24 w-full resize-none rounded border border-black/15 bg-white p-2 text-sm outline-none focus:border-black/40 dark:border-white/15 dark:bg-[#1f1f1f]"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={placeholder}
          value={text}
        />
        <button
          className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
          disabled={!text.trim() || sending || !ceo}
          onClick={() => void send()}
          style={{ background: APP[kind].color }}
          type="button"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send to the Office
        </button>
      </div>
    </aside>
  );
}
