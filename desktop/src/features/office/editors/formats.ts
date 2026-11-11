// The app's own Office-style editors (Create → Document, Slides, Chart) and
// the files they save: one editable JSON file per thing, which Create draws,
// the editor reopens, and agents can write new versions of.

import { blankImage, IMAGE_SPEC, type ImageFile, parseImage } from "./imageFormat";

export type EditorKind = "doc" | "slides" | "sheet" | "image";

export type DocFile = {
  type: "doc";
  version: 1;
  /** The document as HTML (headings, paragraphs, lists, quotes, links,
   *  images, rules; inline styles for colour, size, font and alignment). */
  html: string;
};

export type SlideLayout = "title" | "content" | "section" | "two" | "blank";
export type Slide = {
  layout: SlideLayout;
  title: string;
  /** One point per line. */
  body: string;
  /** The second column of a "two" layout. */
  right?: string;
  notes?: string;
};
export type SlidesTheme = "office" | "dark" | "ocean" | "sunset" | "forest";
export type SlidesFile = {
  type: "slides";
  version: 1;
  theme: SlidesTheme;
  slides: Slide[];
};

export type ChartType = "bar" | "line" | "pie";
export type SheetChart = { type: ChartType; range: string; title: string };
export type SheetFile = {
  type: "sheet";
  version: 1;
  /** "A1" → what was typed: a number, text, or a formula ("=SUM(B2:B4)"). */
  cells: Record<string, string>;
  /** Bold cells. */
  bold?: string[];
  charts: SheetChart[];
};

export type EditorFile = DocFile | SlidesFile | SheetFile | ImageFile;

export const EXT: Record<EditorKind, string> = {
  doc: ".doc.json",
  slides: ".slides.json",
  sheet: ".sheet.json",
  image: ".image.json",
};

export const APP: Record<EditorKind, { name: string; color: string; noun: string }> = {
  doc: { name: "Document", color: "#185ABD", noun: "document" },
  slides: { name: "Slides", color: "#C43E1C", noun: "presentation" },
  sheet: { name: "Sheet", color: "#107C41", noun: "workbook" },
  image: { name: "Image", color: "#2F7FE8", noun: "image" },
};

/** Which editor a saved file belongs to, from its name. */
export function editorKindOf(path: string | undefined | null): EditorKind | null {
  if (!path) return null;
  const p = path.toLowerCase();
  if (p.endsWith(EXT.doc)) return "doc";
  if (p.endsWith(EXT.slides)) return "slides";
  if (p.endsWith(EXT.sheet)) return "sheet";
  if (p.endsWith(EXT.image)) return "image";
  return null;
}

export function blankFile(kind: EditorKind): EditorFile {
  if (kind === "image") return blankImage();
  if (kind === "doc") return { type: "doc", version: 1, html: "<p></p>" };
  if (kind === "slides") {
    return {
      type: "slides",
      version: 1,
      theme: "office",
      slides: [{ layout: "title", title: "", body: "" }],
    };
  }
  return { type: "sheet", version: 1, cells: {}, bold: [], charts: [] };
}

/** Read a saved file, filling in what an agent may have left out. */
export function parseFile(kind: EditorKind, value: unknown): EditorFile {
  if (kind === "image") return parseImage(value);
  const v = (value ?? {}) as Record<string, unknown>;
  if (kind === "doc") {
    return { type: "doc", version: 1, html: typeof v.html === "string" ? v.html : "<p></p>" };
  }
  if (kind === "slides") {
    const slides = Array.isArray(v.slides) ? v.slides : [];
    const layouts: SlideLayout[] = ["title", "content", "section", "two", "blank"];
    const themes: SlidesTheme[] = ["office", "dark", "ocean", "sunset", "forest"];
    return {
      type: "slides",
      version: 1,
      theme: themes.includes(v.theme as SlidesTheme) ? (v.theme as SlidesTheme) : "office",
      slides: (slides.length ? slides : [{}]).map((raw) => {
        const s = (raw ?? {}) as Record<string, unknown>;
        return {
          layout: layouts.includes(s.layout as SlideLayout) ? (s.layout as SlideLayout) : "content",
          title: String(s.title ?? ""),
          body: String(s.body ?? ""),
          right: s.right == null ? undefined : String(s.right),
          notes: s.notes == null ? undefined : String(s.notes),
        };
      }),
    };
  }
  const cells: Record<string, string> = {};
  if (v.cells && typeof v.cells === "object") {
    for (const [k, val] of Object.entries(v.cells as Record<string, unknown>)) {
      if (/^[A-Z]{1,2}\d{1,4}$/.test(k) && val != null && String(val) !== "") cells[k] = String(val);
    }
  }
  const charts = Array.isArray(v.charts)
    ? (v.charts as Record<string, unknown>[])
        .filter((c) => c && typeof c.range === "string")
        .map((c) => ({
          type: (["bar", "line", "pie"].includes(String(c.type)) ? c.type : "bar") as ChartType,
          range: String(c.range),
          title: String(c.title ?? ""),
        }))
    : [];
  return {
    type: "sheet",
    version: 1,
    cells,
    bold: Array.isArray(v.bold) ? v.bold.map(String) : [],
    charts,
  };
}

export function fileName(title: string, kind: EditorKind): string {
  const stem =
    title
      .trim()
      .replace(/[^A-Za-z0-9 _-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "Untitled";
  return `${stem}${EXT[kind]}`;
}

// ─── slides ─────────────────────────────────────────────────────────────────

export const THEMES: Record<
  SlidesTheme,
  { label: string; bg: string; fg: string; accent: string; muted: string; title: string }
> = {
  office: { label: "Office", bg: "#ffffff", fg: "#262626", accent: "#C43E1C", muted: "#595959", title: "#1f1f1f" },
  dark: { label: "Dark", bg: "#1e1e1e", fg: "#f0f0f0", accent: "#4cc2ff", muted: "#b3b3b3", title: "#ffffff" },
  ocean: { label: "Ocean", bg: "#0b3a5b", fg: "#e8f2f9", accent: "#5ad1e6", muted: "#a9c7dc", title: "#ffffff" },
  sunset: { label: "Sunset", bg: "#fff4ec", fg: "#3d2416", accent: "#e8590c", muted: "#8a5a3c", title: "#5c2c0f" },
  forest: { label: "Forest", bg: "#f2f6f1", fg: "#1f2e22", accent: "#2f7d32", muted: "#56705a", title: "#173a1c" },
};

export function bulletLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[-•*]\s?/, "").trimEnd())
    .filter((l) => l.trim());
}

// ─── sheets ─────────────────────────────────────────────────────────────────

export function colName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]{1,2})(\d{1,4})$/.exec(ref.toUpperCase());
  if (!m) return null;
  return { col: colIndex(m[1]), row: Number(m[2]) - 1 };
}

export function refOf(col: number, row: number): string {
  return `${colName(col)}${row + 1}`;
}

export function rangeRefs(range: string): string[][] {
  const [a, b] = range.toUpperCase().split(":");
  const p = parseRef(a ?? "");
  const q = parseRef(b ?? a ?? "");
  if (!p || !q) return [];
  const rows: string[][] = [];
  for (let r = Math.min(p.row, q.row); r <= Math.max(p.row, q.row); r++) {
    const row: string[] = [];
    for (let c = Math.min(p.col, q.col); c <= Math.max(p.col, q.col); c++) row.push(refOf(c, r));
    rows.push(row);
  }
  return rows;
}

export type CellValue = number | string;
const ERR = "#ERROR!";

/**
 * Evaluates a sheet: numbers, text, and formulas with + - * / ^, brackets,
 * cell references, ranges and SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS, IF.
 * No `eval`: a small parser of its own. Cycles read as #CYCLE!.
 */
export function evaluate(cells: Record<string, string>): (ref: string) => CellValue {
  const memo = new Map<string, CellValue>();
  const busy = new Set<string>();

  const value = (ref: string): CellValue => {
    const key = ref.toUpperCase();
    if (memo.has(key)) return memo.get(key) as CellValue;
    if (busy.has(key)) return "#CYCLE!";
    const raw = (cells[key] ?? "").trim();
    let out: CellValue;
    if (raw.startsWith("=")) {
      busy.add(key);
      try {
        out = formula(raw.slice(1));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        out = msg.startsWith("#") ? msg : ERR;
      }
      busy.delete(key);
    } else if (raw !== "" && !Number.isNaN(Number(raw.replace(/,/g, "")))) {
      out = Number(raw.replace(/,/g, ""));
    } else {
      out = raw;
    }
    memo.set(key, out);
    return out;
  };

  const num = (v: CellValue): number => {
    if (typeof v === "number") return v;
    if (v === "") return 0;
    if (v.startsWith("#")) throw new Error(v);
    const n = Number(v);
    if (Number.isNaN(n)) throw new Error("not a number");
    return n;
  };

  function formula(src: string): CellValue {
    const tokens = src.match(/\s*([A-Za-z]{1,2}\d{1,4}:[A-Za-z]{1,2}\d{1,4}|[A-Za-z]+(?=\()|[A-Za-z]{1,2}\d{1,4}|\d+(?:\.\d+)?|"[^"]*"|<=|>=|<>|[-+*/^(),<>=&])\s*/g);
    if (!tokens || tokens.join("").replace(/\s/g, "") !== src.replace(/\s/g, "")) throw new Error("syntax");
    const t = tokens.map((x) => x.trim());
    let i = 0;
    const peek = () => t[i];
    const take = (want?: string) => {
      const tok = t[i++];
      if (want && tok !== want) throw new Error(`expected ${want}`);
      return tok;
    };

    type V = CellValue | CellValue[];
    const flat = (v: V): CellValue[] => (Array.isArray(v) ? v : [v]);

    const compare = (): V => {
      let left = concat();
      while (["=", "<>", "<", ">", "<=", ">="].includes(peek() ?? "")) {
        const op = take();
        const a = left as CellValue;
        const b = concat() as CellValue;
        const [x, y] = typeof a === "number" && typeof b === "number" ? [a, b] : [String(a), String(b)];
        left = Number(
          op === "=" ? x === y : op === "<>" ? x !== y : op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y,
        );
      }
      return left;
    };
    const concat = (): V => {
      let left = add();
      while (peek() === "&") {
        take();
        left = `${left as CellValue}${add() as CellValue}`;
      }
      return left;
    };
    const add = (): V => {
      let left = mul();
      while (peek() === "+" || peek() === "-") {
        const op = take();
        const right = mul();
        left = op === "+" ? num(left as CellValue) + num(right as CellValue) : num(left as CellValue) - num(right as CellValue);
      }
      return left;
    };
    const mul = (): V => {
      let left = pow();
      while (peek() === "*" || peek() === "/") {
        const op = take();
        const right = num(pow() as CellValue);
        if (op === "/" && right === 0) throw new Error("#DIV/0!");
        left = op === "*" ? num(left as CellValue) * right : num(left as CellValue) / right;
      }
      return left;
    };
    const pow = (): V => {
      const base = unary();
      if (peek() === "^") {
        take();
        return num(base as CellValue) ** num(pow() as CellValue);
      }
      return base;
    };
    const unary = (): V => {
      if (peek() === "-") {
        take();
        return -num(unary() as CellValue);
      }
      if (peek() === "+") {
        take();
        return unary();
      }
      return atom();
    };
    const atom = (): V => {
      const tok = take();
      if (tok === undefined) throw new Error("end");
      if (tok === "(") {
        const v = compare();
        take(")");
        return v;
      }
      if (/^\d/.test(tok)) return Number(tok);
      if (tok.startsWith('"')) return tok.slice(1, -1);
      if (tok.includes(":")) return rangeRefs(tok).flat().map(value);
      if (/^[A-Za-z]{1,2}\d{1,4}$/.test(tok)) return value(tok);
      if (/^[A-Za-z]+$/.test(tok)) {
        const fn = tok.toUpperCase();
        take("(");
        const args: V[] = [];
        if (peek() !== ")") {
          args.push(compare());
          while (peek() === ",") {
            take();
            args.push(compare());
          }
        }
        take(")");
        const nums = args.flatMap(flat).filter((v) => v !== "").map((v) => (typeof v === "number" ? v : Number(v))).filter((v) => !Number.isNaN(v));
        switch (fn) {
          case "SUM":
            return nums.reduce((a, b) => a + b, 0);
          case "AVERAGE":
            if (!nums.length) throw new Error("#DIV/0!");
            return nums.reduce((a, b) => a + b, 0) / nums.length;
          case "MIN":
            return nums.length ? Math.min(...nums) : 0;
          case "MAX":
            return nums.length ? Math.max(...nums) : 0;
          case "COUNT":
            return nums.length;
          case "ABS":
            return Math.abs(num(flat(args[0] ?? 0)[0]));
          case "ROUND": {
            const p = 10 ** num(flat(args[1] ?? 0)[0]);
            return Math.round(num(flat(args[0] ?? 0)[0]) * p) / p;
          }
          case "IF":
            return num(flat(args[0] ?? 0)[0]) ? flat(args[1] ?? "")[0] : flat(args[2] ?? "")[0];
          default:
            throw new Error(`#NAME?`);
        }
      }
      throw new Error("syntax");
    };

    const result = compare();
    if (i !== t.length) throw new Error("syntax");
    if (Array.isArray(result)) return result[0] ?? "";
    return result;
  }

  return (ref: string) => {
    try {
      return value(ref);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      return msg.startsWith("#") ? msg : ERR;
    }
  };
}

export function formatValue(v: CellValue): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "#NUM!";
    return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return v;
}

/** How big the sheet's content is (for drawing and export). */
export function usedBounds(cells: Record<string, string>): { cols: number; rows: number } {
  let cols = 0;
  let rows = 0;
  for (const k of Object.keys(cells)) {
    const p = parseRef(k);
    if (!p) continue;
    cols = Math.max(cols, p.col + 1);
    rows = Math.max(rows, p.row + 1);
  }
  return { cols, rows };
}

/** A chart's data: first column = labels, the other columns = series (the
 *  first row names them when it isn't numbers). */
export function chartData(
  range: string,
  get: (ref: string) => CellValue,
): { labels: string[]; series: { name: string; values: number[] }[] } {
  const grid = rangeRefs(range);
  if (!grid.length) return { labels: [], series: [] };
  const header = grid[0].slice(1).every((r) => typeof get(r) !== "number") && grid.length > 1;
  const body = header ? grid.slice(1) : grid;
  const width = grid[0].length;
  const labels = body.map((row) => formatValue(get(row[0])));
  const series: { name: string; values: number[] }[] = [];
  for (let c = 1; c < Math.max(width, 2); c++) {
    if (width === 1) break;
    series.push({
      name: header ? formatValue(get(grid[0][c])) : `Series ${c}`,
      values: body.map((row) => {
        const v = get(row[c]);
        return typeof v === "number" ? v : Number(v) || 0;
      }),
    });
  }
  if (width === 1) {
    series.push({ name: "Values", values: body.map((row) => Number(get(row[0])) || 0) });
  }
  return { labels, series };
}

// ─── exports ────────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A .doc Word opens (HTML in Word's own wrapper). */
export function docToWord(title: string, html: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4}h1{font-size:20pt}h2{font-size:15pt}h3{font-size:13pt}img{max-width:100%}</style></head><body>${html}</body></html>`;
}

export function docToHtml(title: string, html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:Calibri,"Segoe UI",Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;line-height:1.5;color:#222}img{max-width:100%}blockquote{border-left:3px solid #ccc;margin:0;padding-left:12px;color:#555}</style></head><body>${html}</body></html>`;
}

export function sheetToCsv(file: SheetFile): string {
  const get = evaluate(file.cells);
  const { cols, rows } = usedBounds(file.cells);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      const v = get(refOf(c, r));
      const s = typeof v === "number" ? String(v) : v;
      row.push(/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    }
    lines.push(row.join(","));
  }
  return lines.join("\r\n");
}

/** A self-contained presentation: arrow keys / click to move, F for full screen. */
export function slidesToHtml(title: string, file: SlidesFile): string {
  const t = THEMES[file.theme];
  const slide = (s: Slide) => {
    const list = (text: string) =>
      `<ul>${bulletLines(text).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
    if (s.layout === "title" || s.layout === "section") {
      return `<section class="${s.layout}"><h1>${esc(s.title)}</h1>${s.body ? `<p>${esc(s.body).replace(/\n/g, "<br>")}</p>` : ""}</section>`;
    }
    if (s.layout === "two") {
      return `<section><h2>${esc(s.title)}</h2><div class="two"><div>${list(s.body)}</div><div>${list(s.right ?? "")}</div></div></section>`;
    }
    if (s.layout === "blank") return `<section>${s.body ? `<p>${esc(s.body)}</p>` : ""}</section>`;
    return `<section><h2>${esc(s.title)}</h2>${list(s.body)}</section>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
html,body{margin:0;height:100%;background:#111;font-family:"Segoe UI",Arial,sans-serif}
.deck{position:relative;width:100vw;height:56.25vw;max-height:100vh;max-width:177.78vh;margin:auto;top:50%;transform:translateY(-50%)}
section{position:absolute;inset:0;display:none;flex-direction:column;justify-content:center;padding:6% 8%;box-sizing:border-box;background:${t.bg};color:${t.fg};font-size:2.6vmin}
section.on{display:flex}section h1{font-size:3.4em;margin:0 0 .3em;color:${t.title}}section h2{font-size:2.2em;margin:0 0 .6em;color:${t.title};border-bottom:.12em solid ${t.accent};padding-bottom:.2em}
section.title h1,section.section h1{text-align:left}section.section{background:${t.accent};color:#fff}section.section h1{color:#fff}
section p{font-size:1.4em;color:${t.muted}}section.section p{color:#fff}ul{font-size:1.5em;line-height:1.5}li::marker{color:${t.accent}}
.two{display:grid;grid-template-columns:1fr 1fr;gap:4%}.n{position:fixed;right:12px;bottom:8px;color:#888;font-size:12px}
</style></head><body><div class="deck">${file.slides.map(slide).join("")}</div><div class="n"></div><script>
const s=[...document.querySelectorAll("section")];let i=0;const n=document.querySelector(".n");
function show(k){i=Math.max(0,Math.min(s.length-1,k));s.forEach((e,j)=>e.classList.toggle("on",j===i));n.textContent=(i+1)+" / "+s.length}
addEventListener("keydown",e=>{if(["ArrowRight","PageDown"," "].includes(e.key))show(i+1);if(["ArrowLeft","PageUp"].includes(e.key))show(i-1);if(e.key==="f")document.documentElement.requestFullscreen?.()});
addEventListener("click",()=>show(i+1));show(0);
</script></body></html>`;
}

/** How an agent writes each format (for requests to the Office). */
export const FORMAT_SPEC: Record<EditorKind, string> = {
  image: IMAGE_SPEC,
  doc: 'JSON: {"type":"doc","version":1,"html":"<h1>…</h1><p>…</p>"}. The html uses h1–h3, p, ul/ol/li, blockquote, strong, em, u, s, a, img (https or data: URLs), hr, and inline styles for colour, background-color, font-size, font-family and text-align.',
  slides:
    'JSON: {"type":"slides","version":1,"theme":"office|dark|ocean|sunset|forest","slides":[{"layout":"title|content|section|two|blank","title":"…","body":"one point per line","right":"second column (two only)","notes":"speaker notes"}]}. Keep each slide to a title and 3–6 short points.',
  sheet:
    'JSON: {"type":"sheet","version":1,"cells":{"A1":"Month","B1":"Sales","A2":"Jan","B2":"120","B5":"=SUM(B2:B4)"},"bold":["A1","B1"],"charts":[{"type":"bar|line|pie","range":"A1:B4","title":"…"}]}. Formulas: + - * / ^, cell refs, ranges, SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS, IF. A chart\'s range: first column = labels, other columns = series, first row = series names.',
};
