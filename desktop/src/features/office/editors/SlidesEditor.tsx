import * as React from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  LayoutTemplate,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";

import { closeEditor, exportFile, saveToCreate } from "./editorStore";
import { type Slide, type SlideLayout, type SlidesFile, type SlidesTheme, slidesToHtml, THEMES } from "./formats";
import { OfficeShell, RibbonButton, RibbonGroup } from "./OfficeShell";
import { editorRequest } from "./requests";
import { SLIDE_H, SLIDE_W, SlideView, useFitScale } from "./SlideView";

const LAYOUTS: { key: SlideLayout; label: string }[] = [
  { key: "title", label: "Title Slide" },
  { key: "content", label: "Title and Content" },
  { key: "section", label: "Section Header" },
  { key: "two", label: "Two Content" },
  { key: "blank", label: "Blank" },
];

export function SlidesEditor({
  title: initialTitle,
  file,
  series: initialSeries,
  path,
  artifactId,
}: {
  title: string;
  file: SlidesFile;
  series?: string;
  path?: string;
  artifactId?: string;
}) {
  const [title, setTitle] = React.useState(initialTitle);
  const [deck, setDeck] = React.useState<SlidesFile>(file);
  const [at, setAt] = React.useState(0);
  const [series, setSeries] = React.useState(initialSeries);
  const [saved, setSaved] = React.useState<{ id: string; path?: string } | null>(artifactId ? { id: artifactId, path } : null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [presenting, setPresenting] = React.useState(false);
  const stage = React.useRef<HTMLDivElement>(null);
  const scale = useFitScale(stage, 0.8);

  const slide = deck.slides[Math.min(at, deck.slides.length - 1)];
  const change = (next: SlidesFile) => {
    setDeck(next);
    setDirty(true);
  };
  const patch = (p: Partial<Slide>) =>
    change({ ...deck, slides: deck.slides.map((s, i) => (i === at ? { ...s, ...p } : s)) });
  const add = (layout: SlideLayout = "content") => {
    const slides = [...deck.slides];
    slides.splice(at + 1, 0, { layout, title: "", body: "" });
    change({ ...deck, slides });
    setAt(at + 1);
  };
  const remove = () => {
    if (deck.slides.length === 1) return;
    change({ ...deck, slides: deck.slides.filter((_, i) => i !== at) });
    setAt(Math.max(0, at - 1));
  };
  const duplicate = () => {
    const slides = [...deck.slides];
    slides.splice(at + 1, 0, { ...slide });
    change({ ...deck, slides });
    setAt(at + 1);
  };
  const move = (d: -1 | 1) => {
    const j = at + d;
    if (j < 0 || j >= deck.slides.length) return;
    const slides = [...deck.slides];
    [slides[at], slides[j]] = [slides[j], slides[at]];
    change({ ...deck, slides });
    setAt(j);
  };

  const save = async (): Promise<{ id: string; path?: string } | null> => {
    if (saving) return null;
    setSaving(true);
    try {
      const out = await saveToCreate("slides", title, deck, series);
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
  const empty = deck.slides.every((s) => !s.title.trim() && !s.body.trim());

  const home = (
    <>
      <RibbonGroup label="Slides">
        <RibbonButton big icon={Plus} label="New Slide" onClick={() => add()} />
        <div className="flex flex-col gap-0.5">
          <RibbonButton icon={Copy} label="Duplicate slide" onClick={duplicate} />
          <RibbonButton disabled={deck.slides.length === 1} icon={Trash2} label="Delete slide" onClick={remove} />
        </div>
        <div className="flex flex-col gap-0.5">
          <RibbonButton disabled={at === 0} icon={ArrowUp} label="Move up" onClick={() => move(-1)} />
          <RibbonButton disabled={at === deck.slides.length - 1} icon={ArrowDown} label="Move down" onClick={() => move(1)} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Layout">
        <div className="flex gap-1">
          {LAYOUTS.map((l) => (
            <button
              className={cn(
                "flex h-[3.4rem] w-[4.8rem] flex-col items-center justify-center gap-1 rounded border px-1 text-[10px]",
                slide.layout === l.key ? "border-[#C43E1C] bg-[#C43E1C]/10" : "border-black/10 hover:border-black/30 dark:border-white/15",
              )}
              key={l.key}
              onClick={() => patch({ layout: l.key })}
              type="button"
            >
              <LayoutTemplate className="h-4 w-4 opacity-70" />
              {l.label}
            </button>
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroup label="Slide Show">
        <RibbonButton big icon={Play} label="From Start" onClick={() => { setAt(0); setPresenting(true); }} />
        <RibbonButton big icon={Play} label="From Here" onClick={() => setPresenting(true)} />
      </RibbonGroup>
    </>
  );

  const design = (
    <RibbonGroup label="Themes">
      <div className="flex gap-1.5">
        {(Object.keys(THEMES) as SlidesTheme[]).map((key) => (
          <button
            className={cn(
              "flex h-[3.4rem] w-[5.2rem] flex-col overflow-hidden rounded border text-left",
              deck.theme === key ? "border-[#C43E1C] ring-1 ring-[#C43E1C]" : "border-black/15 hover:border-black/40",
            )}
            key={key}
            onClick={() => change({ ...deck, theme: key })}
            style={{ background: THEMES[key].bg }}
            title={THEMES[key].label}
            type="button"
          >
            <span className="px-1.5 pt-1 text-[13px] font-semibold" style={{ color: THEMES[key].title }}>Aa</span>
            <span className="mx-1.5 h-1 w-8" style={{ background: THEMES[key].accent }} />
            <span className="mt-auto px-1.5 pb-0.5 text-[10px]" style={{ color: THEMES[key].muted }}>{THEMES[key].label}</span>
          </button>
        ))}
      </div>
    </RibbonGroup>
  );

  return (
    <OfficeShell
      ask={{
        placeholder: empty ? "A 10-slide deck on digital funnels for my class…" : "Add a slide comparing the three options…",
        build: async (text) => {
          if (empty) return editorRequest("slides", title, text, null);
          const current = dirty || !saved ? await save() : saved;
          return current ? editorRequest("slides", title, text, current) : null;
        },
      }}
      dirty={dirty}
      isNew={!saved}
      exports={[
        {
          label: "Export as a presentation (.html)",
          run: () => void exportFile(`${title || "Untitled"}.html`, slidesToHtml(title, deck), "html", "Presentation").catch((e) => toast.error(String(e))),
        },
      ]}
      kind="slides"
      onClose={closeEditor}
      onSave={() => void save()}
      onTitle={(t) => {
        setTitle(t);
        setDirty(true);
      }}
      saving={saving}
      status={
        <>
          <span>Slide {at + 1} of {deck.slides.length}</span>
          <span>{THEMES[deck.theme].label} theme</span>
        </>
      }
      tabs={[
        { id: "home", label: "Home", content: home },
        { id: "design", label: "Design", content: design },
      ]}
      title={title}
    >
      <div className="flex h-full min-h-0">
        {/* thumbnails */}
        <div className="w-52 shrink-0 overflow-y-auto border-r border-black/10 bg-[#f3f3f3] p-2 dark:border-white/10 dark:bg-[#1f1f1f]">
          {deck.slides.map((s, i) => (
            <button
              className="mb-2 flex w-full items-start gap-1.5 text-left"
              key={`${i}-${s.layout}`}
              onClick={() => setAt(i)}
              type="button"
            >
              <span className="w-4 pt-1 text-right text-xs text-[#616161]">{i + 1}</span>
              <span
                className={cn(
                  "overflow-hidden rounded-sm border-2",
                  i === at ? "border-[#C43E1C]" : "border-transparent hover:border-black/20",
                )}
              >
                <SlideView scale={168 / SLIDE_W} slide={s} theme={deck.theme} />
              </span>
            </button>
          ))}
          <button
            className="ml-5 flex h-[95px] w-[168px] items-center justify-center rounded-sm border border-dashed border-black/25 text-[#616161] hover:border-black/50"
            onClick={() => { setAt(deck.slides.length - 1); add(); }}
            type="button"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
        {/* the slide */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center p-6" ref={stage}>
            <div className="shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_4px_16px_rgba(0,0,0,0.15)]">
              <SlideView
                edit={{
                  onTitle: (v) => patch({ title: v }),
                  onBody: (v) => patch({ body: v }),
                  onRight: (v) => patch({ right: v }),
                }}
                scale={Math.max(0.3, scale * 0.94)}
                slide={slide}
                theme={deck.theme}
              />
            </div>
          </div>
          <textarea
            className="h-20 shrink-0 resize-none border-t border-black/10 bg-white p-3 text-sm outline-none dark:border-white/10 dark:bg-[#262626]"
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Click to add notes"
            value={slide.notes ?? ""}
          />
        </div>
      </div>
      {presenting ? <Present at={at} deck={deck} onClose={(i) => { setAt(i); setPresenting(false); }} /> : null}
    </OfficeShell>
  );
}

/** Full-screen slide show: arrows, space or click to move, Esc to stop. */
function Present({ deck, at, onClose }: { deck: SlidesFile; at: number; onClose: (at: number) => void }) {
  const [i, setI] = React.useState(at);
  const box = React.useRef<HTMLDivElement>(null);
  const scale = useFitScale(box, 1);
  React.useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) setI((n) => Math.min(deck.slides.length - 1, n + 1));
      if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) setI((n) => Math.max(0, n - 1));
      if (e.key === "Escape") onClose(i);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [deck.slides.length, i, onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black" ref={box}>
      <button className="absolute inset-0" onClick={() => setI((n) => Math.min(deck.slides.length - 1, n + 1))} type="button" aria-label="Next slide" />
      <div className="pointer-events-none" style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
        <SlideView scale={scale} slide={deck.slides[i]} theme={deck.theme} />
      </div>
      <button
        aria-label="End show"
        className="absolute right-3 top-3 rounded bg-white/10 p-1.5 text-white hover:bg-white/20"
        onClick={() => onClose(i)}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
      <span className="absolute bottom-2 right-3 text-xs text-white/50">{i + 1} / {deck.slides.length}</span>
    </div>,
    document.body,
  );
}
