import * as React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Pencil } from "lucide-react";

import { ChartView } from "./ChartView";
import { ImageEditor } from "./ImageEditor";
import { renderImageFile } from "./imageEngine";
import type { ImageFile } from "./imageFormat";
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
