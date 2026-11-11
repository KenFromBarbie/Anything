import * as React from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Calendar,
  Code,
  Eraser,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { docExtensions } from "./docExtensions";
import { closeEditor, exportFile, saveToCreate } from "./editorStore";
import { type DocFile, docToHtml, docToWord } from "./formats";
import { OfficeShell, RibbonButton, RibbonGroup, RibbonSelect } from "./OfficeShell";
import { editorRequest } from "./requests";

const FONTS = ["Calibri", "Aptos", "Arial", "Cambria", "Georgia", "Segoe UI", "Times New Roman", "Courier New"];
const SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "36", "48", "72"];
const STYLES = [
  { key: "p", label: "Normal" },
  { key: "h1", label: "Heading 1" },
  { key: "h2", label: "Heading 2" },
  { key: "h3", label: "Heading 3" },
  { key: "quote", label: "Quote" },
];
const COLORS = ["#000000", "#C00000", "#E36C09", "#F2C200", "#00B050", "#0070C0", "#7030A0", "#7F7F7F"];
const MARKS = ["#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#FFC000"];

export function WordEditor({
  title: initialTitle,
  file,
  series: initialSeries,
  path,
  artifactId,
}: {
  title: string;
  file: DocFile;
  series?: string;
  path?: string;
  artifactId?: string;
}) {
  const [title, setTitle] = React.useState(initialTitle);
  const [series, setSeries] = React.useState(initialSeries);
  const [saved, setSaved] = React.useState<{ id: string; path?: string } | null>(
    artifactId ? { id: artifactId, path } : null,
  );
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [zoom, setZoom] = React.useState(100);
  const imageInput = React.useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: docExtensions(),
    content: file.html,
    onUpdate: () => setDirty(true),
    editorProps: {
      attributes: {
        class:
          "office-page outline-none min-h-[22cm] text-[11pt] leading-[1.45] [font-family:Calibri,Aptos,'Segoe_UI',sans-serif]",
        spellcheck: "true",
      },
    },
  });

  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const style = e.getAttributes("textStyle");
      const block = e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : e.isActive("blockquote")
              ? "quote"
              : "p";
      const align =
        e.getAttributes("paragraph").textAlign ?? e.getAttributes("heading").textAlign ?? "left";
      const text = e.state.doc.textContent;
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        code: e.isActive("code"),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        link: e.isActive("link"),
        block,
        align,
        font: (style.fontFamily as string | null)?.split(",")[0]?.replace(/['"]/g, "") ?? "Calibri",
        size: (style.fontSize as string | null)?.replace("pt", "") ?? "11",
        words: text.trim() ? text.trim().split(/\s+/).length : 0,
        chars: text.length,
        table: e.isActive("table"),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });

  const save = async (): Promise<{ id: string; path?: string } | null> => {
    if (!editor || saving) return null;
    setSaving(true);
    try {
      const out = await saveToCreate("doc", title, { type: "doc", version: 1, html: editor.getHTML() }, series);
      setSeries(out.series);
      const next = { id: out.id, path: out.path };
      setSaved(next);
      setDirty(false);
      toast(`Saved "${title.trim() || "Untitled"}" to Create.`);
      return next;
    } catch (e) {
      toast.error(String(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  if (!editor || !st) return null;
  const c = () => editor.chain().focus();
  const setBlock = (key: string) => {
    if (key === "p") c().setParagraph().run();
    else if (key === "quote") c().setParagraph().toggleBlockquote().run();
    else c().setHeading({ level: Number(key.slice(1)) as 1 | 2 | 3 }).run();
  };
  const align = (a: string) =>
    c().updateAttributes("paragraph", { textAlign: a }).updateAttributes("heading", { textAlign: a }).run();
  const style = (attrs: Record<string, string | null>) => c().setMark("textStyle", attrs).run();
  const link = () => {
    const url = window.prompt("Link to", editor.getAttributes("link").href ?? "https://");
    if (url === null) return;
    if (!url.trim()) c().unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const home = (
    <>
      <RibbonGroup label="Undo">
        <div className="flex flex-col gap-0.5">
          <RibbonButton disabled={!st.canUndo} icon={Undo2} label="Undo (Ctrl+Z)" onClick={() => c().undo().run()} />
          <RibbonButton disabled={!st.canRedo} icon={Redo2} label="Redo (Ctrl+Y)" onClick={() => c().redo().run()} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Font">
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <RibbonSelect
              label="Font"
              onChange={(v) => style({ fontFamily: v })}
              options={FONTS.map((f) => ({ value: f, label: f }))}
              value={FONTS.includes(st.font) ? st.font : "Calibri"}
            />
            <RibbonSelect
              label="Font size"
              onChange={(v) => style({ fontSize: `${v}pt` })}
              options={SIZES.map((s) => ({ value: s, label: s }))}
              value={SIZES.includes(st.size) ? st.size : "11"}
              width="w-14"
            />
          </div>
          <div className="flex gap-0.5">
            <RibbonButton active={st.bold} icon={Bold} label="Bold (Ctrl+B)" onClick={() => c().toggleBold().run()} />
            <RibbonButton active={st.italic} icon={Italic} label="Italic (Ctrl+I)" onClick={() => c().toggleItalic().run()} />
            <RibbonButton active={st.underline} icon={Underline} label="Underline (Ctrl+U)" onClick={() => c().toggleUnderline().run()} />
            <RibbonButton active={st.strike} icon={Strikethrough} label="Strikethrough" onClick={() => c().toggleStrike().run()} />
            <Swatches icon={Palette} label="Font colour" colors={COLORS} onPick={(v) => style({ color: v })} />
            <Swatches icon={Highlighter} label="Highlight" colors={MARKS} onPick={(v) => style({ background: v })} clear={() => style({ background: null })} />
            <RibbonButton icon={Eraser} label="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().run()} />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroup label="Paragraph">
        <div className="flex flex-col gap-1">
          <div className="flex gap-0.5">
            <RibbonButton active={st.bullet} icon={List} label="Bullets" onClick={() => c().toggleBulletList().run()} />
            <RibbonButton active={st.ordered} icon={ListOrdered} label="Numbering" onClick={() => c().toggleOrderedList().run()} />
            <RibbonButton active={st.block === "quote"} icon={Quote} label="Quote" onClick={() => c().toggleBlockquote().run()} />
          </div>
          <div className="flex gap-0.5">
            <RibbonButton active={st.align === "left"} icon={AlignLeft} label="Align left" onClick={() => align("left")} />
            <RibbonButton active={st.align === "center"} icon={AlignCenter} label="Center" onClick={() => align("center")} />
            <RibbonButton active={st.align === "right"} icon={AlignRight} label="Align right" onClick={() => align("right")} />
            <RibbonButton active={st.align === "justify"} icon={AlignJustify} label="Justify" onClick={() => align("justify")} />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroup label="Styles">
        <div className="flex gap-1">
          {STYLES.map((s) => (
            <button
              className={
                "flex h-[3.4rem] w-[4.6rem] flex-col items-start justify-center rounded border px-2 text-left " +
                (st.block === s.key
                  ? "border-[#185ABD] bg-[#185ABD]/10"
                  : "border-black/10 hover:border-black/30 dark:border-white/15")
              }
              key={s.key}
              onClick={() => setBlock(s.key)}
              onMouseDown={(e) => e.preventDefault()}
              type="button"
            >
              <span
                className={
                  s.key === "h1"
                    ? "text-[15px] font-semibold text-[#185ABD]"
                    : s.key === "h2"
                      ? "text-[13px] font-semibold text-[#185ABD]"
                      : s.key === "h3"
                        ? "text-[12px] font-semibold"
                        : s.key === "quote"
                          ? "text-[12px] italic text-[#595959]"
                          : "text-[12px]"
                }
              >
                AaBb
              </span>
              <span className="text-[10px] text-[#616161]">{s.label}</span>
            </button>
          ))}
        </div>
      </RibbonGroup>
    </>
  );

  const insert = (
    <>
      <RibbonGroup label="Illustrations">
        <RibbonButton big icon={ImagePlus} label="Picture" onClick={() => imageInput.current?.click()} />
      </RibbonGroup>
      <RibbonGroup label="Tables">
        <RibbonButton
          big
          icon={TableIcon}
          label="Table"
          onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        />
      </RibbonGroup>
      <RibbonGroup label="Links">
        <RibbonButton active={st.link} big icon={Link2} label="Link" onClick={link} />
      </RibbonGroup>
      <RibbonGroup label="Text">
        <RibbonButton big icon={Minus} label="Line" onClick={() => c().setHorizontalRule().run()} />
        <RibbonButton big icon={Code} label="Code" onClick={() => c().toggleCodeBlock().run()} />
        <RibbonButton
          big
          icon={Calendar}
          label="Date"
          onClick={() => c().insertContent(new Date().toLocaleDateString(undefined, { dateStyle: "long" })).run()}
        />
      </RibbonGroup>
    </>
  );

  const tableTools = (
    <>
      <RibbonGroup label="Rows & Columns">
        {[
          ["Insert Above", () => c().addRowBefore().run()],
          ["Insert Below", () => c().addRowAfter().run()],
          ["Insert Left", () => c().addColumnBefore().run()],
          ["Insert Right", () => c().addColumnAfter().run()],
        ].map(([label, run]) => (
          <button className="h-[3.4rem] rounded px-2 text-[11px] hover:bg-black/5 dark:hover:bg-white/10" key={label as string} onClick={run as () => void} onMouseDown={(e) => e.preventDefault()} type="button">
            {label as string}
          </button>
        ))}
      </RibbonGroup>
      <RibbonGroup label="Delete & Merge">
        {[
          ["Delete Row", () => c().deleteRow().run()],
          ["Delete Column", () => c().deleteColumn().run()],
          ["Merge / Split", () => c().mergeOrSplit().run()],
          ["Header Row", () => c().toggleHeaderRow().run()],
          ["Delete Table", () => c().deleteTable().run()],
        ].map(([label, run]) => (
          <button className="h-[3.4rem] rounded px-2 text-[11px] hover:bg-black/5 dark:hover:bg-white/10" key={label as string} onClick={run as () => void} onMouseDown={(e) => e.preventDefault()} type="button">
            {label as string}
          </button>
        ))}
      </RibbonGroup>
    </>
  );

  const view = (
    <RibbonGroup label="Zoom">
      {[75, 100, 125, 150].map((z) => (
        <button
          className={"h-7 rounded px-2 text-sm " + (zoom === z ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10")}
          key={z}
          onClick={() => setZoom(z)}
          type="button"
        >
          {z}%
        </button>
      ))}
    </RibbonGroup>
  );

  return (
    <OfficeShell
      ask={{
        placeholder: saved ? "Tighten the intro and add a summary table…" : "Write a one-page brief on our Q3 numbers…",
        build: async (text) => {
          // Something on the page: save it, and the Office works from that.
          if (editor.isEmpty) return editorRequest("doc", title, text, null);
          const current = dirty || !saved ? await save() : saved;
          return current ? editorRequest("doc", title, text, current) : null;
        },
      }}
      dirty={dirty}
      isNew={!saved}
      exports={[
        { label: "Export as Word (.doc)", run: () => void exportFile(`${title || "Untitled"}.doc`, docToWord(title, editor.getHTML()), "doc", "Word document").catch((e) => toast.error(String(e))) },
        { label: "Export as web page (.html)", run: () => void exportFile(`${title || "Untitled"}.html`, docToHtml(title, editor.getHTML()), "html", "Web page").catch((e) => toast.error(String(e))) },
      ]}
      kind="doc"
      onClose={closeEditor}
      onSave={() => void save()}
      onTitle={(t) => {
        setTitle(t);
        setDirty(true);
      }}
      saving={saving}
      status={
        <>
          <span>{st.words.toLocaleString()} words</span>
          <span>{st.chars.toLocaleString()} characters</span>
          <span className="ml-auto">{zoom}%</span>
        </>
      }
      tabs={[
        { id: "home", label: "Home", content: home },
        { id: "insert", label: "Insert", content: insert },
        // Word's contextual tab: only while the cursor is in a table.
        ...(st.table ? [{ id: "table", label: "Table Layout", content: tableTools }] : []),
        { id: "view", label: "View", content: view },
      ]}
      title={title}
    >
      <div className="flex justify-center px-6 py-8">
        <div
          className="bg-white text-[#1f1f1f] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.12)]"
          style={{ width: "21cm", minHeight: "29.7cm", padding: "2.54cm", zoom: zoom / 100 }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
      <input
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 8 * 1024 * 1024) {
            toast.error("That picture is too big (8 MB at most).");
            return;
          }
          const reader = new FileReader();
          reader.onload = () => c().insertContent({ type: "image", attrs: { src: String(reader.result), alt: f.name } }).run();
          reader.readAsDataURL(f);
        }}
        ref={imageInput}
        type="file"
      />
    </OfficeShell>
  );
}

function Swatches({
  icon: Icon,
  label,
  colors,
  onPick,
  clear,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  colors: string[];
  onPick: (c: string) => void;
  clear?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button
        aria-label={label}
        className="flex h-7 w-7 items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => setOpen((v) => !v)}
        onMouseDown={(e) => e.preventDefault()}
        title={label}
        type="button"
      >
        <Icon className="h-4 w-4" />
      </button>
      {open ? (
        <div
          className="absolute left-0 top-8 z-20 flex w-40 flex-wrap gap-1 rounded border border-black/10 bg-white p-2 shadow-lg dark:border-white/10 dark:bg-[#2d2d2d]"
          onMouseLeave={() => setOpen(false)}
        >
          {colors.map((col) => (
            <button
              aria-label={col}
              className="h-5 w-5 rounded-sm border border-black/20"
              key={col}
              onClick={() => {
                onPick(col);
                setOpen(false);
              }}
              onMouseDown={(e) => e.preventDefault()}
              style={{ background: col }}
              type="button"
            />
          ))}
          {clear ? (
            <button className="mt-1 w-full text-left text-xs hover:underline" onClick={() => { clear(); setOpen(false); }} onMouseDown={(e) => e.preventDefault()} type="button">
              No colour
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
