import * as React from "react";
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, FileText, Home, Plus, Trash2, X } from "lucide-react";

import { cn } from "@/shared/lib/cn";

import {
  type Breakpoint,
  canHold,
  className,
  FONTS,
  type NodeTag,
  PRESETS,
  type SiteClass,
  type SiteFile,
  type SiteNode,
  type SitePage,
  slugOf,
  type Styles,
  type StyleState,
  TEXT_TAGS,
  uid,
  VOID_TAGS,
} from "./siteFormat";

export type Update = (fn: (d: SiteFile, page: SitePage) => void, key?: string) => void;

export const field = "rounded border border-black/50 bg-[#1e1e1e] px-1.5 py-0.5 text-[11px] text-[#e4e4e4] outline-none focus:border-[#2f80ed] placeholder:text-[#6f6f6f]";

// ─── styles: which bag, cascade, set ────────────────────────────────────────

type Holder = SiteNode | SiteClass;
type Bag = "style" | "tablet" | "mobile" | "hover";

function bagOf(bp: Breakpoint, state: StyleState): Bag {
  if (state === "hover") return "hover";
  return bp === "desktop" ? "style" : bp;
}

/** The value a property has before this bag (what shows greyed). */
function cascade(holders: Holder[], bp: Breakpoint, state: StyleState, prop: string, includeLast: boolean): string | undefined {
  const order = (["style", "tablet", "mobile"] as Bag[]).slice(0, bp === "desktop" ? 1 : bp === "tablet" ? 2 : 3);
  if (state === "hover") order.push("hover");
  let v: string | undefined;
  holders.forEach((h, hi) => {
    for (const b of order) {
      if (!includeLast && hi === holders.length - 1 && b === bagOf(bp, state)) continue;
      const val = longhand(h[b] as Styles | undefined, prop);
      if (val != null && val !== "") v = val;
    }
  });
  return v;
}

const BOX = ["top", "right", "bottom", "left"] as const;

function expandBox(v: string): [string, string, string, string] {
  const p = v.trim().split(/\s+(?![^(]*\))/);
  const [t, r = t, b = t, l = r] = p;
  return [t, r, b, l];
}

/** A property's value in a bag, reading margin/padding shorthands too. */
function longhand(s: Styles | undefined, prop: string): string | undefined {
  if (!s) return undefined;
  if (s[prop] != null) return s[prop];
  const m = /^(margin|padding)-(top|right|bottom|left)$/.exec(prop);
  if (m && s[m[1]]) return expandBox(s[m[1]])[BOX.indexOf(m[2] as (typeof BOX)[number])];
  return undefined;
}

const UNITLESS = new Set(["opacity", "z-index", "font-weight", "line-height", "flex", "flex-grow", "flex-shrink", "order"]);

function normalize(prop: string, v: string): string {
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t) && !UNITLESS.has(prop) && t !== "0") return `${t}px`;
  return t;
}

export type StyleTarget = { kind: "element" } | { kind: "class"; name: string };

export function useStyleAccess(site: SiteFile, node: SiteNode | null, target: StyleTarget, bp: Breakpoint, state: StyleState, update: Update) {
  const holders = React.useMemo<Holder[]>(() => {
    if (!node) return [];
    const cls = (node.classes ?? []).map((c) => site.classes.find((x) => x.name === c)).filter((c): c is SiteClass => !!c);
    if (target.kind === "class") {
      const i = cls.findIndex((c) => c.name === target.name);
      return cls.slice(0, i + 1);
    }
    return [...cls, node];
  }, [site, node, target]);
  const bag = bagOf(bp, state);
  const own = holders.length ? (holders[holders.length - 1][bag] as Styles | undefined) : undefined;
  const get = (prop: string) => longhand(own, prop) ?? "";
  const inherited = (prop: string) => cascade(holders, bp, state, prop, false) ?? "";
  const set = (prop: string, value: string) => {
    if (!node) return;
    update((d, page) => {
      let h: Holder | undefined;
      if (target.kind === "class") h = d.classes.find((c) => c.name === target.name);
      else h = findIn(page.body, node.id) ?? undefined;
      if (!h) return;
      const s: Styles = ((h as Record<Bag, Styles | undefined>)[bag] ??= {});
      // Writing one side of a shorthand: spell the shorthand out first.
      const m = /^(margin|padding)-(top|right|bottom|left)$/.exec(prop);
      if (m && s[m[1]]) {
        const parts = expandBox(s[m[1]]);
        delete s[m[1]];
        BOX.forEach((side, i) => {
          if (s[`${m[1]}-${side}`] == null) s[`${m[1]}-${side}`] = parts[i];
        });
      }
      const v = normalize(prop, value);
      if (v === "") delete s[prop];
      else s[prop] = v;
      if (!Object.keys(s).length && bag !== "style") delete (h as Record<Bag, Styles | undefined>)[bag];
    }, `style:${target.kind === "class" ? target.name : node.id}:${bag}:${prop}`);
  };
  const setAll = (text: string) => {
    if (!node) return;
    update((d, page) => {
      const h: Holder | undefined = target.kind === "class" ? d.classes.find((c) => c.name === target.name) : (findIn(page.body, node.id) ?? undefined);
      if (!h) return;
      const s: Styles = {};
      for (const line of text.split(/;|\n/)) {
        const i = line.indexOf(":");
        if (i < 1) continue;
        const k = line.slice(0, i).trim().toLowerCase();
        const v = line.slice(i + 1).trim().replace(/[{}]/g, "");
        if (/^-?-?[a-z][a-z0-9-]*$/.test(k) && v) s[k] = v;
      }
      (h as Record<Bag, Styles | undefined>)[bag] = s;
    }, `styleall:${node.id}:${bag}`);
  };
  return { get, inherited, set, setAll, own: own ?? {}, bag };
}

function findIn(body: SiteNode[], id: string): SiteNode | null {
  for (const n of body) {
    if (n.id === id) return n;
    const c = n.children ? findIn(n.children, id) : null;
    if (c) return c;
  }
  return null;
}

// ─── small fields ───────────────────────────────────────────────────────────

function Section({ title, children, open: start = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = React.useState(start);
  return (
    <div className="border-b border-black/50">
      <button className="flex h-7 w-full items-center gap-1 px-2 text-[11px] font-semibold text-[#cfcfcf] hover:bg-white/5" onClick={() => setOpen((v) => !v)} type="button">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open ? <div className="flex flex-col gap-1.5 px-3 pb-3">{children}</div> : null}
    </div>
  );
}

type Access = ReturnType<typeof useStyleAccess>;

/** A text value that commits as you type; drag the label to scrub numbers. */
function Prop({ a, prop, label, options, wide }: { a: Access; prop: string; label: string; options?: string[]; wide?: boolean }) {
  const value = a.get(prop);
  const ph = a.inherited(prop);
  const scrub = (e: React.PointerEvent) => {
    const start = value || ph;
    const m = /^(-?\d*\.?\d+)([a-z%]*)$/.exec(start.trim());
    if (!m && start) return;
    const n0 = m ? Number(m[1]) : 0;
    const unit = m ? m[2] : UNITLESS.has(prop) ? "" : "px";
    const x0 = e.clientX;
    const step = unit === "em" || unit === "rem" || prop === "opacity" || prop === "line-height" ? 0.05 : 1;
    const move = (ev: PointerEvent) => {
      const n = Math.round((n0 + Math.round((ev.clientX - x0) / 3) * step) * 100) / 100;
      a.set(prop, `${prop === "opacity" ? Math.min(1, Math.max(0, n)) : n}${unit}`);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <label className={cn("flex items-center gap-2", wide && "col-span-2")}>
      <span className={cn("w-[72px] shrink-0 truncate text-[11px]", value ? "text-[#6cb2ff]" : "text-[#a8a8a8]", !options && "cursor-ew-resize")} onPointerDown={options ? undefined : scrub} title={prop}>
        {label}
      </span>
      {options ? (
        <select className={cn(field, "min-w-0 flex-1")} onChange={(e) => a.set(prop, e.target.value)} value={value}>
          <option value="">{ph ? `${ph}` : "—"}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input className={cn(field, "min-w-0 flex-1")} onChange={(e) => a.set(prop, e.target.value)} placeholder={ph || "auto"} value={value} />
      )}
    </label>
  );
}

function ColorProp({ a, prop, label, site }: { a: Access; prop: string; label: string; site: SiteFile }) {
  const value = a.get(prop);
  const ph = a.inherited(prop);
  const shown = value || ph;
  const varName = /^var\(--([a-z0-9_-]+)\)$/.exec(shown)?.[1];
  const hex = varName ? site.theme.colors.find((c) => c.name === varName)?.value : shown;
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2">
        <span className={cn("w-[72px] shrink-0 text-[11px]", value ? "text-[#6cb2ff]" : "text-[#a8a8a8]")}>{label}</span>
        <input
          className="h-5 w-6 shrink-0 cursor-pointer rounded border border-black/50 bg-transparent p-0"
          onChange={(e) => a.set(prop, e.target.value)}
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(hex ?? "") ? (hex as string) : "#000000"}
        />
        <input className={cn(field, "min-w-0 flex-1")} onChange={(e) => a.set(prop, e.target.value)} placeholder={ph || "none"} value={value} />
      </label>
      <div className="ml-[80px] flex flex-wrap gap-1">
        {site.theme.colors.map((c) => (
          <button
            className={cn("h-3.5 w-3.5 rounded-sm border border-white/20", varName === c.name && "ring-1 ring-[#2f80ed]")}
            key={c.name}
            onClick={() => a.set(prop, `var(--${c.name})`)}
            style={{ background: c.value }}
            title={`var(--${c.name})`}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}

function Seg({ a, prop, items }: { a: Access; prop: string; items: { v: string; label: string }[] }) {
  const value = a.get(prop) || a.inherited(prop);
  return (
    <div className="flex overflow-hidden rounded border border-black/50">
      {items.map((it) => (
        <button
          className={cn("flex-1 px-1 py-0.5 text-[10.5px]", value === it.v ? "bg-[#2f6fd6] text-white" : "bg-[#1e1e1e] text-[#b5b5b5] hover:bg-[#333]")}
          key={it.v}
          onClick={() => a.set(prop, a.get(prop) === it.v ? "" : it.v)}
          title={it.v}
          type="button"
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Margin and padding as nested boxes, like a box-model diagram. */
function BoxModel({ a }: { a: Access }) {
  const cell = (prop: string) => {
    const v = a.get(prop);
    return (
      <input
        className={cn("w-11 rounded bg-transparent px-0.5 text-center text-[10.5px] outline-none hover:bg-white/10 focus:bg-[#1e1e1e]", v ? "text-[#6cb2ff]" : "text-[#8a8a8a]")}
        onChange={(e) => a.set(prop, e.target.value)}
        placeholder={a.inherited(prop) || "0"}
        title={prop}
        value={v}
      />
    );
  };
  return (
    <div className="relative rounded border border-dashed border-[#5a5a5a] px-1 py-1 text-[9px] text-[#7a7a7a]">
      <span className="absolute left-1 top-0.5">MARGIN</span>
      <div className="flex justify-center">{cell("margin-top")}</div>
      <div className="flex items-center justify-between">
        {cell("margin-left")}
        <div className="relative my-1 flex-1 rounded border border-[#5a5a5a] bg-[#262626] px-1 py-1">
          <span className="absolute left-1 top-0.5">PADDING</span>
          <div className="flex justify-center">{cell("padding-top")}</div>
          <div className="flex items-center justify-between">
            {cell("padding-left")}
            <div className="h-4 flex-1 rounded-sm bg-[#3a3a3a]" />
            {cell("padding-right")}
          </div>
          <div className="flex justify-center">{cell("padding-bottom")}</div>
        </div>
        {cell("margin-right")}
      </div>
      <div className="flex justify-center">{cell("margin-bottom")}</div>
    </div>
  );
}

// ─── Style panel ────────────────────────────────────────────────────────────

export function StylePanel({
  site,
  node,
  target,
  onTarget,
  bp,
  state,
  onState,
  update,
}: {
  site: SiteFile;
  node: SiteNode | null;
  target: StyleTarget;
  onTarget: (t: StyleTarget) => void;
  bp: Breakpoint;
  state: StyleState;
  onState: (s: StyleState) => void;
  update: Update;
}) {
  const a = useStyleAccess(site, node, target, bp, state, update);
  const [newClass, setNewClass] = React.useState("");
  const [raw, setRaw] = React.useState<string | null>(null);
  if (!node) return <p className="p-3 text-[11px] text-[#8a8a8a]">Select an element on the canvas or in the navigator to style it.</p>;
  const display = a.get("display") || a.inherited("display");
  const addClass = (name: string) => {
    const c = className(name);
    if (!c) return;
    update((d, page) => {
      const n = findIn(page.body, node.id);
      if (!n) return;
      n.classes = [...new Set([...(n.classes ?? []), c])];
      if (!d.classes.some((x) => x.name === c)) d.classes.push({ name: c, style: {} });
    });
    onTarget({ kind: "class", name: c });
    setNewClass("");
  };
  const text = TEXT_TAGS.has(node.tag);
  return (
    <div className="text-[11px]">
      <div className="flex flex-col gap-1.5 border-b border-black/50 p-2">
        <div className="text-[10px] uppercase tracking-wide text-[#8a8a8a]">Selector</div>
        <div className="flex flex-wrap items-center gap-1">
          {(node.classes ?? []).map((c) => (
            <span
              className={cn("flex items-center gap-1 rounded px-1.5 py-0.5", target.kind === "class" && target.name === c ? "bg-[#2f6fd6] text-white" : "bg-[#3a3a3a] text-[#d4d4d4]")}
              key={c}
            >
              <button onClick={() => onTarget({ kind: "class", name: c })} type="button">
                .{c}
              </button>
              <button
                aria-label={`Remove class ${c}`}
                className="opacity-60 hover:opacity-100"
                onClick={() => {
                  update((_d, page) => {
                    const n = findIn(page.body, node.id);
                    if (n) n.classes = (n.classes ?? []).filter((x) => x !== c);
                  });
                  onTarget({ kind: "element" });
                }}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            className={cn("rounded px-1.5 py-0.5", target.kind === "element" ? "bg-[#2f6fd6] text-white" : "bg-[#3a3a3a] text-[#d4d4d4]")}
            onClick={() => onTarget({ kind: "element" })}
            title="Styles only this element"
            type="button"
          >
            This element
          </button>
        </div>
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            addClass(newClass);
          }}
        >
          <input className={cn(field, "min-w-0 flex-1")} list="site-classes" onChange={(e) => setNewClass(e.target.value)} placeholder="Add a class…" value={newClass} />
          <datalist id="site-classes">
            {site.classes.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
        </form>
        <div className="flex items-center gap-2 text-[10.5px] text-[#9a9a9a]">
          <span>State</span>
          <div className="flex overflow-hidden rounded border border-black/50">
            {(["none", "hover"] as StyleState[]).map((s) => (
              <button className={cn("px-2 py-0.5", state === s ? "bg-[#2f6fd6] text-white" : "bg-[#1e1e1e]")} key={s} onClick={() => onState(s)} type="button">
                {s === "none" ? "Normal" : "Hover"}
              </button>
            ))}
          </div>
          <span className="ml-auto">
            {state === "hover" ? "Hover" : bp === "desktop" ? "Desktop (base)" : bp === "tablet" ? "Tablet ≤ 991px" : "Mobile ≤ 767px"}
          </span>
        </div>
        {target.kind === "class" ? (
          <p className="text-[10.5px] text-[#d9a441]">Editing .{target.name}: changes every element with this class.</p>
        ) : null}
      </div>

      <Section title="Layout">
        <Seg
          a={a}
          items={[
            { v: "block", label: "Block" },
            { v: "flex", label: "Flex" },
            { v: "grid", label: "Grid" },
            { v: "inline-block", label: "Inline" },
            { v: "none", label: "None" },
          ]}
          prop="display"
        />
        {display === "flex" || display === "inline-flex" ? (
          <>
            <Seg a={a} items={[{ v: "row", label: "→ Row" }, { v: "column", label: "↓ Column" }]} prop="flex-direction" />
            <Prop a={a} label="Justify" options={["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"]} prop="justify-content" />
            <Prop a={a} label="Align" options={["stretch", "flex-start", "center", "flex-end", "baseline"]} prop="align-items" />
            <Prop a={a} label="Wrap" options={["nowrap", "wrap"]} prop="flex-wrap" />
            <Prop a={a} label="Gap" prop="gap" />
          </>
        ) : null}
        {display === "grid" ? (
          <>
            <Prop a={a} label="Columns" prop="grid-template-columns" />
            <Prop a={a} label="Rows" prop="grid-template-rows" />
            <Prop a={a} label="Gap" prop="gap" />
            <Prop a={a} label="Align" options={["stretch", "start", "center", "end"]} prop="align-items" />
            <Prop a={a} label="Justify" options={["stretch", "start", "center", "end"]} prop="justify-items" />
          </>
        ) : null}
        <Prop a={a} label="Flex child" prop="flex" />
      </Section>

      <Section title="Spacing">
        <BoxModel a={a} />
      </Section>

      <Section title="Size">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Prop a={a} label="Width" prop="width" />
          <Prop a={a} label="Height" prop="height" />
          <Prop a={a} label="Min W" prop="min-width" />
          <Prop a={a} label="Min H" prop="min-height" />
          <Prop a={a} label="Max W" prop="max-width" />
          <Prop a={a} label="Max H" prop="max-height" />
        </div>
        <Prop a={a} label="Overflow" options={["visible", "hidden", "auto", "scroll"]} prop="overflow" />
        {node.tag === "img" || node.tag === "video" ? (
          <>
            <Prop a={a} label="Fit" options={["fill", "cover", "contain", "none", "scale-down"]} prop="object-fit" />
            <Prop a={a} label="Aspect" prop="aspect-ratio" />
          </>
        ) : null}
      </Section>

      <Section open={false} title="Position">
        <Prop a={a} label="Position" options={["static", "relative", "absolute", "fixed", "sticky"]} prop="position" />
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Prop a={a} label="Top" prop="top" />
          <Prop a={a} label="Right" prop="right" />
          <Prop a={a} label="Bottom" prop="bottom" />
          <Prop a={a} label="Left" prop="left" />
        </div>
        <Prop a={a} label="Z-index" prop="z-index" />
      </Section>

      <Section open={text || node.tag === "a"} title="Typography">
        <Prop a={a} label="Font" options={["var(--heading-font)", "var(--body-font)", ...FONTS.map((f) => f.stack)]} prop="font-family" />
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Prop a={a} label="Size" prop="font-size" />
          <Prop a={a} label="Weight" options={["300", "400", "500", "600", "700", "800", "900"]} prop="font-weight" />
          <Prop a={a} label="Height" prop="line-height" />
          <Prop a={a} label="Spacing" prop="letter-spacing" />
        </div>
        <ColorProp a={a} label="Color" prop="color" site={site} />
        <Seg
          a={a}
          items={[
            { v: "left", label: "Left" },
            { v: "center", label: "Center" },
            { v: "right", label: "Right" },
            { v: "justify", label: "Justify" },
          ]}
          prop="text-align"
        />
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Prop a={a} label="Case" options={["none", "uppercase", "lowercase", "capitalize"]} prop="text-transform" />
          <Prop a={a} label="Line" options={["none", "underline", "line-through"]} prop="text-decoration" />
          <Prop a={a} label="Style" options={["normal", "italic"]} prop="font-style" />
          <Prop a={a} label="Wrap" options={["normal", "nowrap", "balance", "pretty"]} prop="text-wrap" />
        </div>
      </Section>

      <Section title="Background">
        <ColorProp a={a} label="Color" prop="background" site={site} />
        <Prop a={a} label="Image" prop="background-image" />
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Prop a={a} label="Size" options={["auto", "cover", "contain"]} prop="background-size" />
          <Prop a={a} label="Position" options={["center", "top", "bottom", "left", "right"]} prop="background-position" />
        </div>
        <p className="text-[10px] text-[#7a7a7a]">Image takes url(https://…) or linear-gradient(…).</p>
      </Section>

      <Section open={false} title="Borders">
        <Prop a={a} label="Radius" prop="border-radius" />
        <Prop a={a} label="Border" prop="border" />
        <ColorProp a={a} label="Color" prop="border-color" site={site} />
      </Section>

      <Section open={false} title="Effects">
        <Prop a={a} label="Opacity" prop="opacity" />
        <Prop a={a} label="Shadow" prop="box-shadow" />
        <Prop a={a} label="Transform" prop="transform" />
        <Prop a={a} label="Transition" prop="transition" />
        <Prop a={a} label="Filter" prop="filter" />
        <Prop a={a} label="Backdrop" prop="backdrop-filter" />
        <Prop a={a} label="Cursor" options={["auto", "pointer", "default", "text", "not-allowed"]} prop="cursor" />
      </Section>

      <Section open={false} title="All CSS (this selector)">
        <textarea
          className={cn(field, "h-32 w-full resize-y font-mono")}
          onBlur={() => {
            if (raw != null) a.setAll(raw);
            setRaw(null);
          }}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          value={
            raw ??
            Object.entries(a.own)
              .map(([k, v]) => `${k}: ${v};`)
              .join("\n")
          }
        />
      </Section>
    </div>
  );
}

// ─── Settings panel (the element's content) ─────────────────────────────────

const TEXT_SWAP: NodeTag[] = ["h1", "h2", "h3", "h4", "p", "span", "li", "label", "a", "button"];
const BOX_SWAP: NodeTag[] = ["div", "section", "header", "footer", "nav", "form", "ul", "ol"];

export function SettingsPanel({ site, node, update, onImage }: { site: SiteFile; node: SiteNode | null; update: Update; onImage: (file: File) => Promise<string> }) {
  if (!node) return <p className="p-3 text-[11px] text-[#8a8a8a]">Select an element to change its content, link or image.</p>;
  const set = (fn: (n: SiteNode) => void, key?: string) =>
    update((_d, page) => {
      const n = findIn(page.body, node.id);
      if (n) fn(n);
    }, key);
  const a = node.attrs ?? {};
  const attr = (k: keyof NonNullable<SiteNode["attrs"]>, v: string | boolean | undefined) =>
    set((n) => {
      const at = (n.attrs ??= {}) as Record<string, unknown>;
      if (v === "" || v === false || v == null) delete at[k];
      else at[k] = v;
      if (!Object.keys(at).length) delete n.attrs;
    }, `attr:${node.id}:${k}`);
  const swaps = TEXT_TAGS.has(node.tag) ? TEXT_SWAP : VOID_TAGS.has(node.tag) ? [node.tag] : BOX_SWAP;
  const linkable = node.tag === "a" || node.tag === "button";
  const pageLink = a.href?.startsWith("page:") ? a.href.slice(5) : "";
  return (
    <div className="flex flex-col gap-2 p-3 text-[11px]">
      <Row label="Element">
        <select
          className={cn(field, "flex-1")}
          onChange={(e) =>
            set((n) => {
              n.tag = e.target.value as NodeTag;
            })
          }
          value={node.tag}
        >
          {swaps.map((t) => (
            <option key={t} value={t}>
              {TAG_LABEL[t] ?? t}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Name">
        <input className={cn(field, "flex-1")} onChange={(e) => set((n) => void (n.name = e.target.value || undefined), `name:${node.id}`)} placeholder={TAG_LABEL[node.tag] ?? node.tag} value={node.name ?? ""} />
      </Row>
      {TEXT_TAGS.has(node.tag) ? (
        <label className="flex flex-col gap-1">
          <span className="text-[#a8a8a8]">Text (or double-click it on the canvas)</span>
          <textarea className={cn(field, "h-20 resize-y")} onChange={(e) => set((n) => void (n.text = e.target.value), `text:${node.id}`)} value={node.text ?? ""} />
        </label>
      ) : null}
      {linkable ? (
        <div className="flex flex-col gap-1.5 rounded border border-black/40 p-2">
          <span className="font-semibold text-[#cfcfcf]">Link</span>
          <Row label="To page">
            <select className={cn(field, "flex-1")} onChange={(e) => attr("href", e.target.value ? `page:${e.target.value}` : "")} value={pageLink}>
              <option value="">— a URL or anchor —</option>
              {site.pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Row>
          {!pageLink ? (
            <Row label="URL">
              <input className={cn(field, "flex-1")} onChange={(e) => attr("href", e.target.value)} placeholder="https://… or #section" value={a.href ?? ""} />
            </Row>
          ) : null}
          <label className="flex items-center gap-2">
            <input checked={!!a.newTab} onChange={(e) => attr("newTab", e.target.checked)} type="checkbox" />
            Open in a new tab
          </label>
          {node.tag === "button" ? (
            <label className="flex items-center gap-2">
              <input checked={a.type === "submit"} onChange={(e) => attr("type", e.target.checked ? "submit" : "")} type="checkbox" />
              Submits its form
            </label>
          ) : null}
        </div>
      ) : null}
      {node.tag === "img" || node.tag === "video" ? (
        <div className="flex flex-col gap-1.5 rounded border border-black/40 p-2">
          <span className="font-semibold text-[#cfcfcf]">{node.tag === "img" ? "Image" : "Video"}</span>
          <Row label="Source">
            <input className={cn(field, "flex-1")} onChange={(e) => attr("src", e.target.value)} placeholder="https://…" value={a.src?.startsWith("data:") ? "(uploaded)" : (a.src ?? "")} />
          </Row>
          <label className="flex cursor-pointer items-center justify-center gap-1 rounded bg-[#3a3a3a] py-1 hover:bg-[#454545]">
            Upload from this computer…
            <input
              accept={node.tag === "img" ? "image/*" : "video/*"}
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) attr("src", await onImage(f));
              }}
              type="file"
            />
          </label>
          {node.tag === "img" ? (
            <Row label="Alt text">
              <input className={cn(field, "flex-1")} onChange={(e) => attr("alt", e.target.value)} placeholder="What the image shows" value={a.alt ?? ""} />
            </Row>
          ) : (
            <div className="flex gap-3">
              {(["controls", "autoplay", "loop"] as const).map((k) => (
                <label className="flex items-center gap-1" key={k}>
                  <input checked={k === "controls" ? a.controls !== false : !!a[k]} onChange={(e) => attr(k, e.target.checked)} type="checkbox" />
                  {k}
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {node.tag === "input" || node.tag === "textarea" ? (
        <div className="flex flex-col gap-1.5 rounded border border-black/40 p-2">
          {node.tag === "input" ? (
            <Row label="Type">
              <select className={cn(field, "flex-1")} onChange={(e) => attr("type", e.target.value)} value={a.type ?? "text"}>
                {["text", "email", "tel", "number", "password", "date", "checkbox"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Row>
          ) : null}
          <Row label="Name">
            <input className={cn(field, "flex-1")} onChange={(e) => attr("name", e.target.value)} value={a.name ?? ""} />
          </Row>
          <Row label="Placeholder">
            <input className={cn(field, "flex-1")} onChange={(e) => attr("placeholder", e.target.value)} value={a.placeholder ?? ""} />
          </Row>
        </div>
      ) : null}
      {node.tag === "embed" ? (
        <label className="flex flex-col gap-1">
          <span className="text-[#a8a8a8]">HTML (scripts run in Preview and the exported site, not on the canvas)</span>
          <textarea className={cn(field, "h-40 resize-y font-mono")} onChange={(e) => set((n) => void (n.html = e.target.value), `html:${node.id}`)} spellCheck={false} value={node.html ?? ""} />
        </label>
      ) : null}
      <Row label="Anchor id">
        <input className={cn(field, "flex-1")} onChange={(e) => attr("anchor", e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} placeholder="for #links to it" value={a.anchor ?? ""} />
      </Row>
      <label className="flex items-center gap-2">
        <input checked={!!node.hidden} onChange={(e) => set((n) => void (n.hidden = e.target.checked || undefined))} type="checkbox" />
        Hidden (kept, not published)
      </label>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[#a8a8a8]">{label}</span>
      {children}
    </label>
  );
}

export const TAG_LABEL: Partial<Record<NodeTag, string>> = {
  section: "Section",
  div: "Div block",
  header: "Header",
  footer: "Footer",
  nav: "Nav",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  p: "Paragraph",
  span: "Text span",
  a: "Link",
  button: "Button",
  img: "Image",
  video: "Video",
  ul: "List",
  ol: "Numbered list",
  li: "List item",
  hr: "Divider",
  form: "Form",
  input: "Input",
  textarea: "Text area",
  label: "Label",
  embed: "Embed",
};

export function nodeLabel(n: SiteNode): string {
  if (n.name) return n.name;
  const base = TAG_LABEL[n.tag] ?? n.tag;
  if (n.classes?.length) return `${base} .${n.classes[0]}`;
  return base;
}

// ─── Navigator (the element tree) ───────────────────────────────────────────

export type DropWhere = "before" | "after" | "inside";
export const DRAG_NODE = "application/x-site-node";
export const DRAG_PRESET = "application/x-site-preset";

export function Navigator({
  page,
  sel,
  onSelect,
  update,
  onDrop,
  onDragging,
}: {
  page: SitePage;
  sel: string | null;
  onSelect: (id: string) => void;
  update: Update;
  onDrop: (data: { node?: string; preset?: string }, target: string | null, where: DropWhere) => void;
  onDragging: (on: boolean) => void;
}) {
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  const [over, setOver] = React.useState<{ id: string; where: DropWhere } | null>(null);
  const rows: { n: SiteNode; depth: number }[] = [];
  const add = (list: SiteNode[], depth: number) => {
    for (const n of list) {
      rows.push({ n, depth });
      if (n.children?.length && !closed.has(n.id)) add(n.children, depth + 1);
    }
  };
  add(page.body, 0);
  const selRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    selRef.current?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  return (
    <div className="py-1 text-[11.5px]" onDragLeave={() => setOver(null)}>
      <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-[#8a8a8a]">Body</div>
      {rows.map(({ n, depth }) => {
        const hold = canHold(n);
        const mark = over?.id === n.id ? over.where : null;
        return (
          <div
            className={cn(
              "group relative flex h-6 cursor-default items-center gap-1 pr-1",
              sel === n.id ? "bg-[#2f6fd6] text-white" : "hover:bg-white/5",
              n.hidden && "opacity-50",
              mark === "inside" && "outline outline-1 -outline-offset-1 outline-[#4a9cff]",
            )}
            draggable
            key={n.id}
            onClick={() => onSelect(n.id)}
            onDragEnd={() => {
              setOver(null);
              onDragging(false);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const y = (e.clientY - r.top) / r.height;
              const where: DropWhere = hold && y > 0.28 && y < 0.72 ? "inside" : y < 0.5 ? "before" : "after";
              if (over?.id !== n.id || over.where !== where) setOver({ id: n.id, where });
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_NODE, n.id);
              e.dataTransfer.effectAllowed = "move";
              onDragging(true);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const node = e.dataTransfer.getData(DRAG_NODE);
              const preset = e.dataTransfer.getData(DRAG_PRESET);
              if (over) onDrop({ node: node || undefined, preset: preset || undefined }, n.id, over.where);
              setOver(null);
              onDragging(false);
            }}
            ref={sel === n.id ? selRef : undefined}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            {mark === "before" ? <span className="absolute inset-x-0 top-0 h-0.5 bg-[#4a9cff]" /> : null}
            {mark === "after" ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#4a9cff]" /> : null}
            {n.children?.length ? (
              <button
                className="flex h-4 w-4 items-center justify-center opacity-70"
                onClick={(e) => {
                  e.stopPropagation();
                  setClosed((s) => {
                    const t = new Set(s);
                    if (t.has(n.id)) t.delete(n.id);
                    else t.add(n.id);
                    return t;
                  });
                }}
                type="button"
              >
                {closed.has(n.id) ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            ) : (
              <span className="w-4" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {nodeLabel(n)}
              {n.text && TEXT_TAGS.has(n.tag) ? <span className="ml-1.5 opacity-50">{n.text.slice(0, 30)}</span> : null}
            </span>
            <button
              aria-label={n.hidden ? "Show" : "Hide"}
              className={cn("opacity-0 group-hover:opacity-70", n.hidden && "opacity-70")}
              onClick={(e) => {
                e.stopPropagation();
                update((_d, p) => {
                  const x = findIn(p.body, n.id);
                  if (x) x.hidden = x.hidden ? undefined : true;
                });
              }}
              type="button"
            >
              {n.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          </div>
        );
      })}
      <div
        className={cn("mx-1 mt-1 rounded border border-dashed border-transparent py-2 text-center text-[10.5px] text-[#6f6f6f]", over?.id === "__end" && "border-[#4a9cff]")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver({ id: "__end", where: "after" });
        }}
        onDrop={(e) => {
          e.preventDefault();
          const node = e.dataTransfer.getData(DRAG_NODE);
          const preset = e.dataTransfer.getData(DRAG_PRESET);
          onDrop({ node: node || undefined, preset: preset || undefined }, null, "after");
          setOver(null);
          onDragging(false);
        }}
      >
        {rows.length ? "Drop here to move to the end" : "The page is empty: add a section from Add."}
      </div>
    </div>
  );
}

// ─── Add panel ──────────────────────────────────────────────────────────────

export function AddPanel({ onAdd, onDragging }: { onAdd: (preset: string) => void; onDragging: (on: boolean) => void }) {
  return (
    <div className="flex flex-col gap-3 p-2 text-[11px]">
      {(["Sections", "Layout", "Elements"] as const).map((g) => (
        <div key={g}>
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-[#8a8a8a]">{g}</div>
          <div className="grid grid-cols-2 gap-1">
            {PRESETS.filter((p) => p.group === g).map((p) => (
              <button
                className="rounded border border-black/40 bg-[#333] px-2 py-2 text-left hover:border-[#2f80ed] hover:bg-[#3a3a3a]"
                draggable
                key={p.id}
                onClick={() => onAdd(p.id)}
                onDragEnd={() => onDragging(false)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_PRESET, p.id);
                  e.dataTransfer.effectAllowed = "copy";
                  onDragging(true);
                }}
                title="Click to add after the selection, or drag onto the canvas or navigator"
                type="button"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="px-1 text-[10.5px] text-[#7a7a7a]">Click to add after the selected element (inside it, if it's a container), or drag onto the canvas.</p>
    </div>
  );
}

// ─── Pages panel ────────────────────────────────────────────────────────────

export function PagesPanel({ site, pageId, onPage, update }: { site: SiteFile; pageId: string; onPage: (id: string) => void; update: Update }) {
  const page = site.pages.find((p) => p.id === pageId) ?? site.pages[0];
  const addPage = (copyOf?: SitePage) => {
    const id = uid("p");
    update((d) => {
      const base = copyOf ? (JSON.parse(JSON.stringify(copyOf)) as SitePage) : null;
      let name = copyOf ? `${copyOf.name} copy` : `Page ${d.pages.length + 1}`;
      let slug = slugOf(name);
      while (d.pages.some((p) => p.slug === slug)) slug = `${slug}-2`;
      if (!copyOf) {
        // a new page keeps the site's navbar and footer
        const home = d.pages[0];
        const keep = home.body.filter((n) => n.tag === "header" || n.tag === "footer").map((n) => JSON.parse(JSON.stringify(n)) as SiteNode);
        const fresh = (n: SiteNode) => {
          n.id = uid();
          n.children?.forEach(fresh);
        };
        keep.forEach(fresh);
        const header = keep.filter((n) => n.tag === "header");
        const footer = keep.filter((n) => n.tag === "footer");
        d.pages.push({
          id,
          name,
          slug,
          title: name,
          description: "",
          body: [
            ...header,
            { id: uid(), tag: "section", classes: ["section"], children: [{ id: uid(), tag: "div", classes: ["container"], children: [{ id: uid(), tag: "h1", text: name }] }] },
            ...footer,
          ],
        });
      } else if (base) {
        const fresh = (n: SiteNode) => {
          n.id = uid();
          n.children?.forEach(fresh);
        };
        base.body.forEach(fresh);
        name = `${base.name} copy`;
        d.pages.push({ ...base, id, name, slug, title: name });
      }
    });
    onPage(id);
  };
  return (
    <div className="flex flex-col text-[11.5px]">
      <div className="flex items-center gap-1 p-2">
        <button className="flex items-center gap-1 rounded bg-[#3a3a3a] px-2 py-1 hover:bg-[#454545]" onClick={() => addPage()} type="button">
          <Plus className="h-3 w-3" /> New page
        </button>
      </div>
      {site.pages.map((p, i) => (
        <div
          className={cn("group flex h-7 cursor-default items-center gap-1.5 px-2", p.id === page.id ? "bg-[#2f6fd6] text-white" : "hover:bg-white/5")}
          key={p.id}
          onClick={() => onPage(p.id)}
        >
          {i === 0 ? <Home className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5 opacity-70" />}
          <span className="flex-1 truncate">{p.name}</span>
          <span className="text-[10px] opacity-60">/{i === 0 ? "" : p.slug}</span>
          <button
            aria-label="Duplicate page"
            className="opacity-0 group-hover:opacity-80"
            onClick={(e) => {
              e.stopPropagation();
              addPage(p);
            }}
            type="button"
          >
            <Copy className="h-3 w-3" />
          </button>
          {site.pages.length > 1 ? (
            <button
              aria-label="Delete page"
              className="opacity-0 group-hover:opacity-80"
              onClick={(e) => {
                e.stopPropagation();
                if (!window.confirm(`Delete the page "${p.name}"?`)) return;
                update((d) => {
                  d.pages = d.pages.filter((x) => x.id !== p.id);
                  d.pages[0].slug = "index";
                });
                if (p.id === page.id) onPage(site.pages.find((x) => x.id !== p.id)?.id ?? "");
              }}
              type="button"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ))}
      <div className="mt-2 flex flex-col gap-1.5 border-t border-black/50 p-3">
        <div className="text-[10px] uppercase tracking-wide text-[#8a8a8a]">Page settings</div>
        <Row label="Name">
          <input
            className={cn(field, "flex-1")}
            onChange={(e) =>
              update((_d, pg) => {
                pg.name = e.target.value;
              }, `pname:${page.id}`)
            }
            value={page.name}
          />
        </Row>
        <Row label="Address">
          <input
            className={cn(field, "flex-1")}
            disabled={site.pages[0].id === page.id}
            onChange={(e) =>
              update((d, pg) => {
                let s = slugOf(e.target.value);
                if (s === "index") s = "index-2";
                while (d.pages.some((x) => x.id !== pg.id && x.slug === s)) s = `${s}-2`;
                pg.slug = s;
              }, `pslug:${page.id}`)
            }
            value={site.pages[0].id === page.id ? "(home page)" : page.slug}
          />
        </Row>
        <Row label="SEO title">
          <input className={cn(field, "flex-1")} onChange={(e) => update((_d, pg) => void (pg.title = e.target.value), `ptitle:${page.id}`)} value={page.title} />
        </Row>
        <label className="flex flex-col gap-1">
          <span className="text-[#a8a8a8]">Description (search results and link previews)</span>
          <textarea className={cn(field, "h-16 resize-y")} onChange={(e) => update((_d, pg) => void (pg.description = e.target.value), `pdesc:${page.id}`)} value={page.description} />
        </label>
        {site.pages[0].id !== page.id ? (
          <button
            className="self-start rounded bg-[#3a3a3a] px-2 py-1 hover:bg-[#454545]"
            onClick={() =>
              update((d) => {
                const i = d.pages.findIndex((x) => x.id === page.id);
                const [pg] = d.pages.splice(i, 1);
                const old = d.pages[0];
                old.slug = slugOf(old.name === "Home" ? "home" : old.name);
                while (d.pages.some((x) => x !== old && x.slug === old.slug)) old.slug = `${old.slug}-2`;
                pg.slug = "index";
                d.pages.unshift(pg);
              })
            }
            type="button"
          >
            Make this the home page
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Theme panel (colours, fonts, classes, custom code) ─────────────────────

export function ThemePanel({ site, update, usage }: { site: SiteFile; update: Update; usage: (cls: string) => number }) {
  const th = site.theme;
  return (
    <div className="flex flex-col text-[11px]">
      <Section title="Colours">
        {th.colors.map((c, i) => (
          <div className="flex items-center gap-1.5" key={i}>
            <input
              className="h-5 w-6 shrink-0 cursor-pointer rounded border border-black/50 bg-transparent p-0"
              onChange={(e) => update((d) => void (d.theme.colors[i].value = e.target.value), `color:${i}`)}
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(c.value) ? c.value : "#000000"}
            />
            <input className={cn(field, "w-24")} onChange={(e) => update((d) => void (d.theme.colors[i].name = className(e.target.value) || "color"), `cname:${i}`)} value={c.name} />
            <input className={cn(field, "min-w-0 flex-1")} onChange={(e) => update((d) => void (d.theme.colors[i].value = e.target.value), `color:${i}`)} value={c.value} />
            <button aria-label="Remove colour" className="opacity-60 hover:opacity-100" onClick={() => update((d) => void d.theme.colors.splice(i, 1))} type="button">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button className="self-start rounded bg-[#3a3a3a] px-2 py-0.5 hover:bg-[#454545]" onClick={() => update((d) => void d.theme.colors.push({ name: `color-${d.theme.colors.length + 1}`, value: "#888888" }))} type="button">
          + Colour
        </button>
        <p className="text-[10px] text-[#7a7a7a]">Use them anywhere as var(--name). primary, text, background, surface and muted are used by the built-in sections.</p>
      </Section>
      <Section title="Fonts">
        <Row label="Headings">
          <select className={cn(field, "flex-1")} onChange={(e) => update((d) => void (d.theme.headingFont = e.target.value))} value={th.headingFont}>
            {FONTS.map((f) => (
              <option key={f.label}>{f.label}</option>
            ))}
          </select>
        </Row>
        <Row label="Body">
          <select className={cn(field, "flex-1")} onChange={(e) => update((d) => void (d.theme.bodyFont = e.target.value))} value={th.bodyFont}>
            {FONTS.map((f) => (
              <option key={f.label}>{f.label}</option>
            ))}
          </select>
        </Row>
        <Row label="Base size">
          <input className={cn(field, "w-16")} max={32} min={10} onChange={(e) => update((d) => void (d.theme.baseSize = Math.min(32, Math.max(10, Number(e.target.value) || 16))), "basesize")} type="number" value={th.baseSize} />
          <span className="text-[#8a8a8a]">px</span>
        </Row>
      </Section>
      <Section open={false} title={`Classes (${site.classes.length})`}>
        {site.classes.map((c) => {
          const n = usage(c.name);
          return (
            <div className="flex items-center gap-1.5" key={c.name}>
              <span className="flex-1 truncate">.{c.name}</span>
              <span className="text-[10px] text-[#7a7a7a]">{n ? `${n} used` : "unused"}</span>
              <button
                aria-label={`Delete class ${c.name}`}
                className="opacity-60 hover:opacity-100"
                onClick={() => {
                  if (n && !window.confirm(`.${c.name} is used by ${n} element(s). Delete it and remove it from them?`)) return;
                  update((d) => {
                    d.classes = d.classes.filter((x) => x.name !== c.name);
                    for (const p of d.pages) {
                      const strip = (list: SiteNode[]) =>
                        list.forEach((x) => {
                          if (x.classes) x.classes = x.classes.filter((k) => k !== c.name);
                          if (x.children) strip(x.children);
                        });
                      strip(p.body);
                    }
                  });
                }}
                type="button"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </Section>
      <Section open={false} title="Custom code">
        <label className="flex flex-col gap-1">
          <span className="text-[#a8a8a8]">Extra CSS (every page)</span>
          <textarea className={cn(field, "h-28 resize-y font-mono")} onChange={(e) => update((d) => void (d.css = e.target.value || undefined), "css")} spellCheck={false} value={site.css ?? ""} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#a8a8a8]">Extra &lt;head&gt; code (analytics, meta tags; runs in Preview and the export)</span>
          <textarea className={cn(field, "h-20 resize-y font-mono")} onChange={(e) => update((d) => void (d.head = e.target.value || undefined), "head")} spellCheck={false} value={site.head ?? ""} />
        </label>
      </Section>
    </div>
  );
}
