import * as React from "react";
import { Code2, Download, Eye, Monitor, PenTool, Redo2, Smartphone, Tablet, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";

import { CreativeShell, isTyping, type Menu, Panel } from "./CreativeShell";
import { closeEditor, exportFile, saveToCreate } from "./editorStore";
import { editorRequest } from "./requests";
import {
  AddPanel,
  DRAG_NODE,
  DRAG_PRESET,
  type DropWhere,
  Navigator,
  nodeLabel,
  PagesPanel,
  SettingsPanel,
  type StyleTarget,
  StylePanel,
  ThemePanel,
  type Update,
} from "./SitePanels";
import {
  type Breakpoint,
  BREAKPOINTS,
  canHold,
  canvasHtml,
  cloneNode,
  exportSite,
  findNode,
  locate,
  moveNode,
  pageBody,
  pageHtml,
  PRESETS,
  presetNode,
  siteCss,
  type SiteFile,
  type SiteNode,
  type SitePage,
  type StyleState,
  walk,
  zipFiles,
} from "./siteFormat";

type Mode = "design" | "preview" | "code";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The top-level element that holds `id`. */
function topLevelOf(body: SiteNode[], id: string): string | null {
  let cur = id;
  for (let guard = 0; guard < 100; guard++) {
    const at = locate(body, cur);
    if (!at) return null;
    if (!at.parent) return cur;
    cur = at.parent.id;
  }
  return null;
}

export function SiteEditor({
  title: initialTitle,
  file,
  series: initialSeries,
  path,
  artifactId,
}: {
  title: string;
  file: SiteFile;
  series?: string;
  path?: string;
  artifactId?: string;
}) {
  const [title, setTitle] = React.useState(initialTitle);
  const [series, setSeries] = React.useState(initialSeries);
  const [saved, setSaved] = React.useState<{ id: string; path?: string } | null>(artifactId ? { id: artifactId, path } : null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [site, setSiteState] = React.useState<SiteFile>(file);
  const siteRef = React.useRef(site);
  const setSite = React.useCallback((s: SiteFile) => {
    siteRef.current = s;
    setSiteState(s);
  }, []);
  const [pageId, setPageIdState] = React.useState(file.pages[0].id);
  const pageIdRef = React.useRef(pageId);
  const setPageId = (id: string) => {
    pageIdRef.current = id;
    setPageIdState(id);
    setSel(null);
  };
  const page: SitePage = site.pages.find((p) => p.id === pageId) ?? site.pages[0];
  const [sel, setSel] = React.useState<string | null>(null);
  const selRef = React.useRef(sel);
  selRef.current = sel;
  const node = sel ? findNode(page.body, sel) : null;

  const [bp, setBp] = React.useState<Breakpoint>("desktop");
  const [styleState, setStyleState] = React.useState<StyleState>("none");
  const [target, setTarget] = React.useState<StyleTarget>({ kind: "element" });
  const [left, setLeft] = React.useState("Add");
  const [right, setRight] = React.useState("Style");
  const [mode, setMode] = React.useState<Mode>("design");
  const [dragging, setDragging] = React.useState(false);
  const clip = React.useRef<SiteNode | null>(null);

  // ── history ──
  const past = React.useRef<SiteFile[]>([]);
  const future = React.useRef<SiteFile[]>([]);
  const last = React.useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const [, bump] = React.useReducer((x: number) => x + 1, 0);

  const update: Update = React.useCallback(
    (fn, key) => {
      const d: SiteFile = structuredClone(siteRef.current);
      const pg = d.pages.find((p) => p.id === pageIdRef.current) ?? d.pages[0];
      fn(d, pg);
      const now = Date.now();
      if (!(key && key === last.current.key && now - last.current.at < 1500)) {
        past.current.push(siteRef.current);
        if (past.current.length > 150) past.current.shift();
      }
      future.current = [];
      last.current = { key: key ?? null, at: now };
      setSite(d);
      setDirty(true);
    },
    [setSite],
  );

  const restore = (s: SiteFile) => {
    setSite(s);
    setDirty(true);
    last.current = { key: null, at: 0 };
    if (!s.pages.some((p) => p.id === pageIdRef.current)) setPageId(s.pages[0].id);
    else if (selRef.current && !findNode((s.pages.find((p) => p.id === pageIdRef.current) ?? s.pages[0]).body, selRef.current)) setSel(null);
    bump();
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(siteRef.current);
    restore(prev);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(siteRef.current);
    restore(next);
  };

  // A class target only makes sense while the element has that class.
  React.useEffect(() => {
    if (target.kind === "class" && !node?.classes?.includes(target.name)) setTarget({ kind: "element" });
  }, [node, target]);

  // ── editing actions ──
  const select = (id: string | null) => {
    setSel(id);
    if (id && left === "Add") setLeft("Navigator");
  };

  const placeNew = (d: SiteFile, pg: SitePage, n: SiteNode, targetId: string | null, where: DropWhere | "end", section: boolean) => {
    let tid = targetId;
    let w: DropWhere | "end" = where;
    if (section && tid) {
      tid = topLevelOf(pg.body, tid);
      if (w === "inside") w = "after";
    }
    if (!tid || w === "end") {
      pg.body.push(n);
      return;
    }
    const t = findNode(pg.body, tid);
    if (w === "inside" && t && canHold(t)) {
      (t.children ??= []).push(n);
      return;
    }
    const at = locate(pg.body, tid);
    if (!at) pg.body.push(n);
    else at.list.splice(at.index + (w === "before" ? 0 : 1), 0, n);
    void d;
  };

  const addPreset = (presetId: string, targetId: string | null = selRef.current, where?: DropWhere | "end") => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    let newId = "";
    update((d, pg) => {
      const n = presetNode(presetId, d);
      if (!n) return;
      newId = n.id;
      const t = targetId ? findNode(pg.body, targetId) : null;
      const w: DropWhere | "end" = where ?? (!t ? "end" : canHold(t) && preset.group !== "Sections" ? "inside" : "after");
      placeNew(d, pg, n, t ? t.id : null, w, preset.group === "Sections");
    });
    if (newId) {
      setSel(newId);
      setLeft("Navigator");
    }
  };

  const drop = (data: { node?: string; preset?: string }, targetId: string | null, where: DropWhere | "end") => {
    if (data.preset) return addPreset(data.preset, targetId, targetId ? where : "end");
    if (!data.node) return;
    const id = data.node;
    update((_d, pg) => {
      if (!targetId) {
        const at = locate(pg.body, id);
        if (!at) return;
        const [n] = at.list.splice(at.index, 1);
        pg.body.push(n);
        return;
      }
      moveNode(pg.body, id, targetId, where === "end" ? "after" : where);
    });
    setSel(id);
  };

  const remove = () => {
    const id = selRef.current;
    if (!id) return;
    let next: string | null = null;
    update((_d, pg) => {
      const at = locate(pg.body, id);
      if (!at) return;
      at.list.splice(at.index, 1);
      next = at.list[Math.min(at.index, at.list.length - 1)]?.id ?? at.parent?.id ?? null;
    });
    setSel(next);
  };

  const duplicate = () => {
    const id = selRef.current;
    if (!id) return;
    let copy = "";
    update((_d, pg) => {
      const at = locate(pg.body, id);
      if (!at) return;
      const c = cloneNode(at.list[at.index]);
      copy = c.id;
      at.list.splice(at.index + 1, 0, c);
    });
    if (copy) setSel(copy);
  };

  const copy = (cut = false) => {
    const id = selRef.current;
    if (!id) return;
    const n = findNode((siteRef.current.pages.find((p) => p.id === pageIdRef.current) ?? siteRef.current.pages[0]).body, id);
    if (!n) return;
    clip.current = structuredClone(n);
    if (cut) remove();
    else toast.message("Copied");
  };

  const paste = () => {
    if (!clip.current) return;
    const n = cloneNode(clip.current);
    update((d, pg) => {
      const t = selRef.current ? findNode(pg.body, selRef.current) : null;
      placeNew(d, pg, n, t?.id ?? null, !t ? "end" : canHold(t) ? "inside" : "after", false);
    });
    setSel(n.id);
  };

  const nudge = (dir: -1 | 1) => {
    const id = selRef.current;
    if (!id) return;
    update((_d, pg) => {
      const at = locate(pg.body, id);
      if (!at) return;
      const j = at.index + dir;
      if (j < 0 || j >= at.list.length) return;
      [at.list[at.index], at.list[j]] = [at.list[j], at.list[at.index]];
    });
  };

  const selectParent = () => {
    const id = selRef.current;
    if (!id) return;
    const at = locate(page.body, id);
    if (at?.parent) setSel(at.parent.id);
  };

  const onKey = (key: string, ctrl: boolean, shift: boolean) => {
    const k = key.toLowerCase();
    if (ctrl && k === "z" && !shift) undo();
    else if (ctrl && (k === "y" || (k === "z" && shift))) redo();
    else if (ctrl && k === "d") duplicate();
    else if (ctrl && k === "c") copy();
    else if (ctrl && k === "x") copy(true);
    else if (ctrl && k === "v") paste();
    else if (key === "Delete" || key === "Backspace") remove();
    else if (key === "Escape") selectParent();
  };
  const onKeyRef = React.useRef(onKey);
  onKeyRef.current = onKey;

  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTyping(e) || mode !== "design") return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "s") return;
      if (ctrl && /^[zydcxv]$/i.test(e.key)) e.preventDefault();
      if (!ctrl && !["Delete", "Backspace", "Escape"].includes(e.key)) return;
      if (e.key === "Escape" && !selRef.current) return;
      onKeyRef.current(e.key, ctrl, e.shiftKey);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [mode]);

  // ── canvas (an iframe running the page, talking by messages) ──
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = React.useState(false);
  const hit = React.useRef<{ id: string | null; where: DropWhere | "end" } | null>(null);
  const fontsKey = `${site.theme.headingFont}|${site.theme.bodyFont}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the document is rebuilt only for a new page or fonts; edits arrive as messages.
  const doc = React.useMemo(() => canvasHtml(siteRef.current, page), [page.id, fontsKey]);
  React.useEffect(() => setReady(false), [doc]);

  const labels = React.useMemo(() => {
    const out: Record<string, string> = {};
    walk(page.body, (n) => {
      out[n.id] = nodeLabel(n);
    });
    return out;
  }, [page]);

  const post = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(m, "*");

  React.useEffect(() => {
    if (!ready || mode !== "design") return;
    post({ type: "render", css: siteCss(site, page), body: pageBody(site, page, true), labels });
    post({ type: "select", id: sel, labels });
    // biome-ignore lint/correctness/useExhaustiveDependencies: posting is a side effect of these
  }, [site, page, ready, mode]);

  React.useEffect(() => {
    if (ready) post({ type: "select", id: sel, labels, reveal: true });
    // biome-ignore lint/correctness/useExhaustiveDependencies: only on selection
  }, [sel, ready]);

  React.useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as Record<string, unknown> | null;
      if (!m || m.__site !== 1) return;
      if (e.source !== frame.current?.contentWindow && e.source !== preview.current?.contentWindow) return;
      if (m.type === "ready") setReady(true);
      else if (m.type === "select") select((m.id as string) ?? null);
      else if (m.type === "text") {
        const id = String(m.id);
        const text = String(m.text ?? "");
        update((_d, pg) => {
          const n = findNode(pg.body, id);
          if (n && n.text !== text) n.text = text;
        });
      } else if (m.type === "key") onKeyRef.current(String(m.key), !!m.ctrl, !!m.shift);
      else if (m.type === "hit") hit.current = { id: (m.id as string) ?? null, where: m.id ? (m.where as DropWhere) : "end" };
      else if (m.type === "nav") {
        const p = siteRef.current.pages.find((x) => x.slug === m.slug);
        if (p) setPageId(p.id);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // biome-ignore lint/correctness/useExhaustiveDependencies: handlers read refs
  }, [update]);

  // ── preview and code ──
  const preview = React.useRef<HTMLIFrameElement>(null);
  const previewDoc = React.useMemo(() => {
    if (mode !== "preview") return "";
    const nav = `<script>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href");if(/^[a-z0-9-]+\\.html$/i.test(h)){e.preventDefault();parent.postMessage({__site:1,type:"nav",slug:h.replace(/\\.html$/i,"")},"*")}});document.addEventListener("submit",function(e){e.preventDefault();alert("Form sent (this is a preview).")});</script>`;
    return pageHtml(site, page).replace("</body>", `${nav}</body>`);
  }, [mode, site, page]);
  const code = React.useMemo(() => (mode === "code" ? { html: pageHtml(site, page, { cssHref: "styles.css" }), css: siteCss(site) } : null), [mode, site, page]);

  // ── files ──
  const save = async (): Promise<{ id: string; path?: string } | null> => {
    setSaving(true);
    try {
      const r = await saveToCreate("site", title, siteRef.current, series);
      setSeries(r.series);
      setSaved({ id: r.id, path: r.path });
      setDirty(false);
      return { id: r.id, path: r.path };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const stem = (title.trim() || "site").replace(/[^A-Za-z0-9 _-]+/g, " ").trim().replace(/\s+/g, "-").toLowerCase() || "site";
  const exportZip = async () => {
    try {
      const zip = zipFiles(exportSite(siteRef.current));
      if (await exportFile(`${stem}.zip`, toBase64(zip), "zip", "Website (.zip)", true)) toast.success("Site exported: unzip it and upload the files to any web host");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const exportPage = async () => {
    try {
      if (await exportFile(`${page.slug}.html`, pageHtml(siteRef.current, page), "html", "Web page")) toast.success("Page exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onImage = async (f: File): Promise<string> => {
    if (f.type.startsWith("video/")) {
      if (f.size > 15e6) {
        toast.error("That video is over 15 MB; host it elsewhere and paste its URL instead.");
        return "";
      }
      return await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(f);
      });
    }
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
    return f.type === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/webp", 0.86);
  };

  const usage = (cls: string) => {
    let n = 0;
    for (const p of site.pages) walk(p.body, (x) => void (x.classes?.includes(cls) && n++));
    return n;
  };

  // ── menus ──
  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "Save to Create", run: () => void save(), shortcut: "Ctrl+S" },
        "-",
        { label: "Export site (.zip)…", run: () => void exportZip() },
        { label: "Export this page (.html)…", run: () => void exportPage() },
        "-",
        { label: "Close", run: () => closeEditor() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", run: undo, shortcut: "Ctrl+Z", disabled: !past.current.length },
        { label: "Redo", run: redo, shortcut: "Ctrl+Y", disabled: !future.current.length },
        "-",
        { label: "Cut", run: () => copy(true), shortcut: "Ctrl+X", disabled: !sel },
        { label: "Copy", run: () => copy(), shortcut: "Ctrl+C", disabled: !sel },
        { label: "Paste", run: paste, shortcut: "Ctrl+V", disabled: !clip.current },
        { label: "Duplicate", run: duplicate, shortcut: "Ctrl+D", disabled: !sel },
        { label: "Delete", run: remove, shortcut: "Del", disabled: !sel },
        "-",
        { label: "Move up", run: () => nudge(-1), disabled: !sel },
        { label: "Move down", run: () => nudge(1), disabled: !sel },
        { label: "Select parent", run: selectParent, shortcut: "Esc", disabled: !sel },
      ],
    },
    {
      label: "Insert",
      items: PRESETS.filter((p) => p.group !== "Elements" || ["heading", "paragraph", "button", "image"].includes(p.id)).map((p) => ({ label: `${p.group === "Sections" ? "Section: " : ""}${p.label}`, run: () => addPreset(p.id) })),
    },
    {
      label: "Page",
      items: site.pages.map((p) => ({ label: p.name, run: () => setPageId(p.id), checked: p.id === page.id })).concat([
        { label: "Page settings…", run: () => setLeft("Pages"), checked: false },
      ]),
    },
    {
      label: "View",
      items: [
        ...(Object.keys(BREAKPOINTS) as Breakpoint[]).map((b) => ({ label: `${BREAKPOINTS[b].label} (${BREAKPOINTS[b].width}px)`, run: () => setBp(b), checked: bp === b })),
        "-",
        { label: "Design", run: () => setMode("design"), checked: mode === "design" },
        { label: "Preview", run: () => setMode("preview"), checked: mode === "preview" },
        { label: "Code", run: () => setMode("code"), checked: mode === "code" },
      ],
    },
  ];

  const crumbs: SiteNode[] = [];
  if (sel) {
    let cur: string | null = sel;
    while (cur) {
      const at = locate(page.body, cur);
      if (!at) break;
      crumbs.unshift(at.list[at.index]);
      cur = at.parent?.id ?? null;
    }
  }

  const width = bp === "desktop" ? undefined : BREAKPOINTS[bp].width;
  const btn = (on: boolean) => cn("flex h-7 items-center gap-1.5 rounded px-2 text-[12px]", on ? "bg-[#4a4a4a] text-white" : "text-[#c8c8c8] hover:bg-[#3a3a3a]");

  return (
    <CreativeShell
      ask={{
        placeholder: "e.g. Make a 4-page site for my bakery: home, menu, about, contact, warm colours",
        build: async (text) => {
          const s = dirty || !saved ? await save() : saved;
          return editorRequest("site", title, text, s);
        },
      }}
      badge="Ws"
      dirty={dirty}
      isNew={!saved}
      kind="site"
      menus={menus}
      onClose={() => closeEditor()}
      onSave={() => void save()}
      onTitle={(t) => {
        setTitle(t);
        setDirty(true);
      }}
      options={
        <>
          <select aria-label="Page" className="rounded border border-black/50 bg-[#1e1e1e] px-1.5 py-0.5 text-[12px]" onChange={(e) => setPageId(e.target.value)} value={page.id}>
            {site.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="h-5 w-px bg-white/10" />
          <button className={btn(bp === "desktop")} onClick={() => setBp("desktop")} title="Desktop (base styles)" type="button">
            <Monitor className="h-4 w-4" />
          </button>
          <button className={btn(bp === "tablet")} onClick={() => setBp("tablet")} title="Tablet: styles here apply at 991px and below" type="button">
            <Tablet className="h-4 w-4" />
          </button>
          <button className={btn(bp === "mobile")} onClick={() => setBp("mobile")} title="Mobile: styles here apply at 767px and below" type="button">
            <Smartphone className="h-4 w-4" />
          </button>
          <span className="text-[11px] text-[#8a8a8a]">{width ? `${width}px` : "Full width"}</span>
          <div className="h-5 w-px bg-white/10" />
          <button className={btn(false)} disabled={!past.current.length} onClick={undo} title="Undo (Ctrl+Z)" type="button">
            <Undo2 className="h-4 w-4" />
          </button>
          <button className={btn(false)} disabled={!future.current.length} onClick={redo} title="Redo (Ctrl+Y)" type="button">
            <Redo2 className="h-4 w-4" />
          </button>
          <span className="flex-1" />
          <div className="flex rounded bg-[#262626] p-0.5">
            <button className={btn(mode === "design")} onClick={() => setMode("design")} type="button">
              <PenTool className="h-3.5 w-3.5" /> Design
            </button>
            <button className={btn(mode === "preview")} onClick={() => setMode("preview")} type="button">
              <Eye className="h-3.5 w-3.5" /> Preview
            </button>
            <button className={btn(mode === "code")} onClick={() => setMode("code")} type="button">
              <Code2 className="h-3.5 w-3.5" /> Code
            </button>
          </div>
          <button className="flex h-7 items-center gap-1.5 rounded bg-[#2f6fd6] px-3 text-[12px] text-white hover:bg-[#3b7be0]" onClick={() => void exportZip()} type="button">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </>
      }
      saving={saving}
      status={
        <>
          <span>
            {page.name} · {site.pages.length} page{site.pages.length === 1 ? "" : "s"}
          </span>
          <span className="flex min-w-0 items-center gap-1 truncate">
            {crumbs.length
              ? crumbs.map((c, i) => (
                  <React.Fragment key={c.id}>
                    {i ? <span className="opacity-50">›</span> : null}
                    <button className={cn("hover:text-white", c.id === sel && "text-[#6cb2ff]")} onClick={() => setSel(c.id)} type="button">
                      {nodeLabel(c)}
                    </button>
                  </React.Fragment>
                ))
              : "Nothing selected"}
          </span>
          <span className="ml-auto shrink-0">Double-click text to edit · Del delete · Ctrl+D duplicate · Esc parent</span>
        </>
      }
      title={title}
    >
      {mode === "design" ? (
        <aside className="flex w-60 shrink-0 flex-col border-r border-black/60 bg-[#2b2b2b]">
          <Panel className="flex-1" onTab={setLeft} tab={left} tabs={["Add", "Navigator", "Pages", "Theme"]}>
            {left === "Add" ? <AddPanel onAdd={(id) => addPreset(id)} onDragging={setDragging} /> : null}
            {left === "Navigator" ? <Navigator onDragging={setDragging} onDrop={(d, t, w) => drop(d, t, w)} onSelect={select} page={page} sel={sel} update={update} /> : null}
            {left === "Pages" ? <PagesPanel onPage={setPageId} pageId={page.id} site={site} update={update} /> : null}
            {left === "Theme" ? <ThemePanel site={site} update={update} usage={usage} /> : null}
          </Panel>
        </aside>
      ) : null}

      <div className="relative flex min-w-0 flex-1 flex-col bg-[#1a1a1a]">
        {mode === "code" && code ? (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-px bg-black/50">
            {[
              { name: `${page.slug}.html`, text: code.html },
              { name: "styles.css", text: code.css },
            ].map((f) => (
              <div className="flex min-h-0 flex-col bg-[#1e1e1e]" key={f.name}>
                <div className="flex h-8 items-center gap-2 border-b border-black/50 px-3 text-[12px]">
                  <span className="font-mono">{f.name}</span>
                  <span className="flex-1" />
                  <button
                    className="rounded px-2 py-0.5 hover:bg-[#3a3a3a]"
                    onClick={() => void navigator.clipboard.writeText(f.text).then(() => toast.success("Copied"))}
                    type="button"
                  >
                    Copy
                  </button>
                </div>
                <textarea className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[11.5px] leading-relaxed text-[#d4d4d4] outline-none" readOnly spellCheck={false} value={f.text} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 justify-center overflow-auto p-3">
            <div className="relative h-full shrink-0 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_6px_24px_rgba(0,0,0,0.5)]" style={{ width: width ?? "100%" }}>
              {mode === "design" ? (
                <iframe className="h-full w-full border-0" key={`${page.id}|${fontsKey}`} ref={frame} sandbox="allow-scripts" srcDoc={doc} title="Site canvas" />
              ) : (
                <iframe className="h-full w-full border-0" ref={preview} sandbox="allow-scripts allow-popups" srcDoc={previewDoc} title="Site preview" />
              )}
              {mode === "design" && dragging ? (
                <div
                  className="absolute inset-0 z-10"
                  onDragLeave={() => post({ type: "hitclear" })}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    post({ type: "hit", x: e.clientX - r.left, y: e.clientY - r.top });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const n = e.dataTransfer.getData(DRAG_NODE);
                    const p = e.dataTransfer.getData(DRAG_PRESET);
                    const h = hit.current ?? { id: null, where: "end" as const };
                    post({ type: "hitclear" });
                    setDragging(false);
                    drop({ node: n || undefined, preset: p || undefined }, h.id, h.where);
                  }}
                />
              ) : null}
            </div>
          </div>
        )}
      </div>

      {mode === "design" ? (
        <aside className="flex w-72 shrink-0 flex-col border-l border-black/60 bg-[#2b2b2b]">
          <Panel className="flex-1" onTab={setRight} tab={right} tabs={["Style", "Settings"]}>
            {right === "Style" ? (
              <StylePanel bp={bp} node={node} onState={setStyleState} onTarget={setTarget} site={site} state={styleState} target={target} update={update} />
            ) : (
              <SettingsPanel node={node} onImage={onImage} site={site} update={update} />
            )}
          </Panel>
        </aside>
      ) : null}
    </CreativeShell>
  );
}
