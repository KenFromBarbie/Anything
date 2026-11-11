import * as React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Pencil } from "lucide-react";

import { ChartView } from "./ChartView";
import { ImageEditor } from "./ImageEditor";
import { renderImageFile } from "./imageEngine";
import type { ImageFile } from "./imageFormat";
import { ModelEditor } from "./ModelEditor";
import { ModelScene } from "./modelEngine";
import type { ModelFile } from "./modelFormat";
import { VideoEditor } from "./VideoEditor";
import { VideoEngine } from "./videoEngine";
import { projectDuration, timecode, type VideoFile } from "./videoFormat";
import { docExtensions } from "./docExtensions";
import { openEditor, useOpenEditor } from "./editorStore";
import {
  APP,
  type DocFile,
  type EditorFile,
  type EditorKind,
  editorKindOf,
  evaluate,
  formatValue,
  parseFile,
  refOf,
  type SheetFile,
  type SlidesFile,
  usedBounds,
} from "./formats";
import { SheetEditor } from "./SheetEditor";
import { SiteEditor } from "./SiteEditor";
import { pageHtml, type SiteFile } from "./siteFormat";
import { SLIDE_W, SlideView, useFitScale } from "./SlideView";
import { SlidesEditor } from "./SlidesEditor";
import { WordEditor } from "./WordEditor";

/** The editor window, when one is open. Mount once where Create lives. */
export function EditorHost() {
  const open = useOpenEditor();
  if (!open?.file) return null;
  const key = `${open.kind}:${open.artifactId ?? "new"}:${open.title}`;
  const props = { title: open.title, series: open.series, path: open.path, artifactId: open.artifactId };
  if (open.kind === "doc") return <WordEditor file={open.file as DocFile} key={key} {...props} />;
  if (open.kind === "slides") return <SlidesEditor file={open.file as SlidesFile} key={key} {...props} />;
  if (open.kind === "image") return <ImageEditor file={open.file as ImageFile} key={key} {...props} />;
  if (open.kind === "video") return <VideoEditor file={open.file as VideoFile} key={key} {...props} />;
  if (open.kind === "model") return <ModelEditor file={open.file as ModelFile} key={key} {...props} />;
  if (open.kind === "site") return <SiteEditor file={open.file as SiteFile} key={key} {...props} />;
  return <SheetEditor file={open.file as SheetFile} key={key} {...props} />;
}

type Item = { id: string; title: string; path?: string; series?: string };

/** Load a saved editor file. */
export function useEditorFile(item: Item): { kind: EditorKind; file: EditorFile } | null | "error" {
  const kind = editorKindOf(item.path);
  const [file, setFile] = React.useState<EditorFile | null | "error">(null);
  React.useEffect(() => {
    if (!kind || !item.path) return;
    let alive = true;
    fetch(convertFileSrc(item.path))
      .then((r) => r.json())
      .then((json) => alive && setFile(parseFile(kind, json)))
      .catch(() => alive && setFile("error"));
    return () => {
      alive = false;
    };
  }, [item.path, kind]);
  if (!kind) return null;
  if (file === "error") return "error";
  return file ? { kind, file } : null;
}

export function editInEditor(item: Item, kind: EditorKind, file: EditorFile) {
  openEditor({ kind, title: item.title, file, series: item.series ?? item.id, artifactId: item.id, path: item.path });
}

/** A saved Document / Slides / Sheet, drawn read-only: full in the viewer, a
 *  small first look on a card. */
export function EditorFileView({ item, thumb = false }: { item: Item; thumb?: boolean }) {
  const loaded = useEditorFile(item);
  if (loaded === "error") {
    return <p className="p-6 text-sm text-muted-foreground">This file couldn't be read.</p>;
  }
  if (!loaded) return null;
  const { kind, file } = loaded;
  const body =
    file.type === "doc" ? (
      <DocPreview html={file.html} thumb={thumb} />
    ) : file.type === "slides" ? (
      <SlidesPreview deck={file} thumb={thumb} />
    ) : file.type === "image" ? (
      <ImagePreview image={file} thumb={thumb} />
    ) : file.type === "video" ? (
      <VideoPreview project={file} thumb={thumb} />
    ) : file.type === "model" ? (
      <ModelPreview scene={file} thumb={thumb} />
    ) : file.type === "site" ? (
      <SitePreview site={file} thumb={thumb} />
    ) : (
      <SheetPreview sheet={file} thumb={thumb} />
    );
  if (thumb) return body;
  return (
    <div className="relative h-full overflow-auto bg-[#f3f3f3] dark:bg-[#1f1f1f]">
      <button
        className="sticky left-full top-3 z-10 mr-3 flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium text-white shadow"
        onClick={() => editInEditor(item, kind, file)}
        style={{ background: APP[kind].color }}
        type="button"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit in {APP[kind].name}
      </button>
      {body}
    </div>
  );
}

function DocPreview({ html, thumb }: { html: string; thumb: boolean }) {
  const editor = useEditor({ editable: false, extensions: docExtensions(), content: html }, [html]);
  return (
    <div className={thumb ? "pointer-events-none absolute left-0 top-0 w-[200%] origin-top-left scale-50 bg-white p-6 text-[#1f1f1f]" : "flex justify-center px-6 pb-8"}>
      <div
        className={thumb ? "text-[11pt] leading-[1.45]" : "bg-white text-[#1f1f1f] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.12)]"}
        style={thumb ? undefined : { width: "21cm", minHeight: "29.7cm", padding: "2.54cm" }}
      >
        <div className="office-page text-[11pt] leading-[1.45] [font-family:Calibri,Aptos,'Segoe_UI',sans-serif]">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function ImagePreview({ image, thumb }: { image: ImageFile; thumb: boolean }) {
  // The saved preview on a card; the full picture, flattened, in the viewer.
  const [src, setSrc] = React.useState<string | null>(thumb ? (image.preview ?? null) : null);
  React.useEffect(() => {
    if (src) return;
    let alive = true;
    renderImageFile(image, thumb ? 480 : 0)
      .then((c) => alive && setSrc(c.toDataURL("image/png")))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [image, thumb, src]);
  if (!src) return null;
  return thumb ? (
    <img alt="" className="absolute inset-0 h-full w-full object-cover" src={src} />
  ) : (
    <div className="flex justify-center px-6 pb-8">
      <img
        alt=""
        className="max-h-[75vh] max-w-full shadow-[0_2px_8px_rgba(0,0,0,0.25)] [background:repeating-conic-gradient(#ddd_0_25%,#fff_0_50%)_0_0/16px_16px]"
        src={src}
      />
    </div>
  );
}

/** A saved site: its home page (a small, inert picture on a card; the
 *  real page, with links between pages working, in the viewer). */
function SitePreview({ site, thumb }: { site: SiteFile; thumb: boolean }) {
  const [pageId, setPageId] = React.useState(site.pages[0].id);
  const page = site.pages.find((p) => p.id === pageId) ?? site.pages[0];
  const frame = React.useRef<HTMLIFrameElement>(null);
  React.useEffect(() => {
    if (thumb) return;
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as { __site?: number; slug?: string } | null;
      const p = m?.__site === 1 ? site.pages.find((x) => x.slug === m.slug) : null;
      if (p) setPageId(p.id);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [site, thumb]);
  const nav = `<script>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href");if(/^[a-z0-9-]+\\.html$/i.test(h)){e.preventDefault();parent.postMessage({__site:1,slug:h.replace(/\\.html$/i,"")},"*")}});document.addEventListener("submit",function(e){e.preventDefault()});</script>`;
  const html = pageHtml(site, page).replace("</body>", `${thumb ? "" : nav}</body>`);
  if (thumb) {
    return (
      <iframe
        className="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] origin-top-left border-0 bg-white"
        sandbox=""
        srcDoc={html}
        style={{ transform: "scale(0.25)" }}
        tabIndex={-1}
        title="Site"
      />
    );
  }
  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      {site.pages.length > 1 ? (
        <div className="flex gap-1 px-4 pt-3">
          {site.pages.map((p) => (
            <button
              className={p.id === page.id ? "rounded bg-[#14A39A] px-2.5 py-1 text-xs text-white" : "rounded px-2.5 py-1 text-xs text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"}
              key={p.id}
              onClick={() => setPageId(p.id)}
              type="button"
            >
              {p.name}
            </button>
          ))}
        </div>
      ) : null}
      <iframe className="m-4 min-h-0 flex-1 rounded border-0 bg-white shadow" ref={frame} sandbox="allow-scripts" srcDoc={html} title={page.name} />
    </div>
  );
}

function ModelPreview({ scene, thumb }: { scene: ModelFile; thumb: boolean }) {
  const host = React.useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const engine = React.useRef<ModelScene | null>(null);
  React.useEffect(() => {
    if (thumb || !host.current) return;
    const e = new ModelScene(host.current, scene);
    e.gizmo.getHelper().visible = false;
    e.gizmo.enabled = false;
    engine.current = e;
    requestAnimationFrame(() => e.focus());
    return () => e.dispose();
  }, [scene, thumb]);
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const span = Math.max(1, scene.frameEnd - scene.frameStart);
      engine.current?.setFrame(scene.frameStart + (((now - t0) / 1000) * scene.fps) % span);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, scene]);
  if (thumb) {
    return scene.preview ? (
      <img alt="" className="absolute inset-0 h-full w-full object-cover" src={scene.preview} />
    ) : (
      <div className="absolute inset-0 flex items-center justify-center bg-[#3a3a3a] text-xs text-white/60">3D scene</div>
    );
  }
  const animated = scene.objects.some((o) => o.keys?.length || o.kind === "import");
  return (
    <div className="relative mx-6 mb-8 h-[70vh] overflow-hidden rounded">
      <div className="absolute inset-0" ref={host} />
      {animated ? (
        <button className="absolute bottom-3 left-3 rounded bg-black/70 px-3 py-1 text-xs text-white" onClick={() => setPlaying((p) => !p)} type="button">
          {playing ? "Pause" : "Play animation"}
        </button>
      ) : null}
    </div>
  );
}

function VideoPreview({ project, thumb }: { project: VideoFile; thumb: boolean }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const engine = React.useRef<VideoEngine | null>(null);
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const duration = projectDuration(project);
  React.useEffect(() => {
    if (thumb || !canvas.current) return;
    const e = new VideoEngine(canvas.current, project);
    e.onTime = setTime;
    e.onStop = () => setPlaying(false);
    engine.current = e;
    e.seek(0);
    return () => e.dispose();
  }, [project, thumb]);
  if (thumb) {
    return project.preview ? (
      <img alt="" className="absolute inset-0 h-full w-full object-cover" src={project.preview} />
    ) : (
      <div className="absolute inset-0 flex items-center justify-center bg-black text-xs text-white/60">Video project</div>
    );
  }
  const toggle = () => {
    const e = engine.current;
    if (!e) return;
    if (e.playing) {
      e.pause();
      setPlaying(false);
    } else {
      e.play(time);
      setPlaying(true);
    }
  };
  return (
    <div className="flex flex-col items-center gap-2 px-6 pb-8">
      <canvas
        className="max-h-[70vh] max-w-full cursor-pointer bg-black shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
        onClick={toggle}
        ref={canvas}
        style={{ aspectRatio: `${project.width} / ${project.height}` }}
      />
      <div className="flex w-full max-w-3xl items-center gap-3 text-xs text-muted-foreground">
        <button className="rounded bg-black/80 px-3 py-1 text-white" onClick={toggle} type="button">
          {playing ? "Pause" : "Play"}
        </button>
        <input
          className="flex-1"
          max={duration || 0}
          min={0}
          onChange={(e) => {
            const t = Number(e.target.value);
            setTime(t);
            if (engine.current?.playing) engine.current.play(t);
            else engine.current?.seek(t);
          }}
          step={0.01}
          type="range"
          value={time}
        />
        <span className="font-mono">
          {timecode(time, project.fps).slice(3, 8)} / {timecode(duration, project.fps).slice(3, 8)}
        </span>
      </div>
    </div>
  );
}

function SlidesPreview({ deck, thumb }: { deck: SlidesFile; thumb: boolean }) {
  const box = React.useRef<HTMLDivElement>(null);
  const scale = useFitScale(box, 0.3);
  if (thumb) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#e9e9e9]" ref={box}>
        <SlideView scale={scale * 0.92} slide={deck.slides[0]} theme={deck.theme} />
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4 px-6 pb-8" ref={box}>
      {deck.slides.map((s, i) => (
        <div className="shadow-[0_2px_8px_rgba(0,0,0,0.15)]" key={`${i}-${s.title}`}>
          <SlideView scale={Math.min(1, (box.current?.clientWidth ?? SLIDE_W) / SLIDE_W)} slide={s} theme={deck.theme} />
        </div>
      ))}
    </div>
  );
}

function SheetPreview({ sheet, thumb }: { sheet: SheetFile; thumb: boolean }) {
  const get = React.useMemo(() => evaluate(sheet.cells), [sheet.cells]);
  const bold = new Set(sheet.bold ?? []);
  const { cols, rows } = usedBounds(sheet.cells);
  const showCols = Math.max(cols, thumb ? 6 : cols);
  const showRows = Math.max(rows, thumb ? 12 : rows);
  const table = (
    <table className="border-collapse bg-white text-[12px] text-[#1f1f1f] [font-family:Calibri,'Segoe_UI',sans-serif]">
      <tbody>
        {Array.from({ length: showRows }, (_, r) => (
          <tr key={r}>
            {Array.from({ length: showCols }, (_, c) => {
              const ref = refOf(c, r);
              const v = get(ref);
              return (
                <td
                  className={`h-5 min-w-20 border border-[#e1e1e1] px-1 ${typeof v === "number" ? "text-right" : ""} ${bold.has(ref) ? "font-bold" : ""}`}
                  key={ref}
                >
                  {sheet.cells[ref] === undefined ? "" : formatValue(v)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (thumb) {
    return <div className="pointer-events-none absolute inset-0 overflow-hidden bg-white">{table}</div>;
  }
  return (
    <div className="flex flex-col gap-4 px-6 pb-8">
      <div className="overflow-auto">{table}</div>
      <div className="flex flex-wrap gap-4">
        {sheet.charts.map((chart, i) => (
          <div className="w-[480px] rounded border border-black/10 bg-white p-2 shadow-sm" key={`${chart.range}-${i}`}>
            <ChartView chart={chart} get={get} />
          </div>
        ))}
      </div>
    </div>
  );
}
