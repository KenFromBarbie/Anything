// The Site editor's file (Create → Site): a small multi-page website as a
// tree of elements with styles per breakpoint, shared classes, theme colours
// and fonts, laid out like a visual site builder. It renders to plain static
// HTML + CSS (the editor's canvas, the preview and the exported .zip all use
// the same renderer), so what the owner sees is what gets published.

export type Breakpoint = "desktop" | "tablet" | "mobile";
export type StyleState = "none" | "hover";
/** CSS declarations, by property name in kebab case ("font-size": "18px"). */
export type Styles = Record<string, string>;

export type NodeTag =
  | "section" | "div" | "header" | "footer" | "nav"
  | "h1" | "h2" | "h3" | "h4" | "p" | "span" | "a" | "button"
  | "img" | "video" | "ul" | "ol" | "li" | "hr"
  | "form" | "input" | "textarea" | "label" | "embed";

export const TAGS: NodeTag[] = [
  "section", "div", "header", "footer", "nav", "h1", "h2", "h3", "h4", "p", "span", "a", "button",
  "img", "video", "ul", "ol", "li", "hr", "form", "input", "textarea", "label", "embed",
];
/** Elements that hold text rather than children. */
export const TEXT_TAGS = new Set<NodeTag>(["h1", "h2", "h3", "h4", "p", "span", "a", "button", "li", "label"]);
/** Elements that never hold anything. */
export const VOID_TAGS = new Set<NodeTag>(["img", "video", "hr", "input", "textarea", "embed"]);

export type NodeAttrs = {
  /** Link: a URL, "#section-id", or "page:<page id>" for another page. */
  href?: string;
  newTab?: boolean;
  src?: string;
  alt?: string;
  placeholder?: string;
  type?: string;
  name?: string;
  /** Anchor id other links can jump to. */
  anchor?: string;
  /** video */
  autoplay?: boolean;
  loop?: boolean;
  controls?: boolean;
};

export type SiteNode = {
  id: string;
  tag: NodeTag;
  /** Shown in the navigator instead of the tag. */
  name?: string;
  /** Text elements: their text (new lines become line breaks). */
  text?: string;
  /** "embed": raw HTML. */
  html?: string;
  attrs?: NodeAttrs;
  classes?: string[];
  /** This element's own styles: base (desktop), then overrides. */
  style?: Styles;
  tablet?: Styles;
  mobile?: Styles;
  hover?: Styles;
  hidden?: boolean;
  children?: SiteNode[];
};

export type SiteClass = { name: string; style: Styles; tablet?: Styles; mobile?: Styles; hover?: Styles };

export type SitePage = {
  id: string;
  name: string;
  /** "index" for the home page; otherwise the file name without .html. */
  slug: string;
  title: string;
  description: string;
  body: SiteNode[];
};

export type SiteTheme = {
  /** Named colours, usable anywhere as var(--name). */
  colors: { name: string; value: string }[];
  headingFont: string;
  bodyFont: string;
  /** Base text size in px. */
  baseSize: number;
};

export type SiteFile = {
  type: "site";
  version: 1;
  theme: SiteTheme;
  classes: SiteClass[];
  pages: SitePage[];
  /** Extra CSS the owner wrote. */
  css?: string;
  /** Extra <head> code (analytics, meta tags). */
  head?: string;
  /** A small picture of the home page, for cards. */
  preview?: string;
};

export const BREAKPOINTS: Record<Breakpoint, { label: string; width: number; query: string | null }> = {
  desktop: { label: "Desktop", width: 1280, query: null },
  tablet: { label: "Tablet", width: 768, query: "(max-width: 991px)" },
  mobile: { label: "Mobile", width: 375, query: "(max-width: 767px)" },
};

export const FONTS: { label: string; stack: string; google?: string }[] = [
  { label: "System", stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { label: "Inter", stack: "'Inter', system-ui, sans-serif", google: "Inter:wght@400;500;600;700;800" },
  { label: "Poppins", stack: "'Poppins', system-ui, sans-serif", google: "Poppins:wght@400;500;600;700" },
  { label: "DM Sans", stack: "'DM Sans', system-ui, sans-serif", google: "DM+Sans:wght@400;500;700" },
  { label: "Montserrat", stack: "'Montserrat', system-ui, sans-serif", google: "Montserrat:wght@400;600;800" },
  { label: "Playfair Display", stack: "'Playfair Display', Georgia, serif", google: "Playfair+Display:wght@400;600;800" },
  { label: "Lora", stack: "'Lora', Georgia, serif", google: "Lora:wght@400;600" },
  { label: "Space Grotesk", stack: "'Space Grotesk', system-ui, sans-serif", google: "Space+Grotesk:wght@400;500;700" },
  { label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", stack: "ui-monospace, 'Cascadia Code', Consolas, monospace" },
];

let seq = 0;
export function uid(prefix = "n"): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}${seq.toString(36)}`;
}

// ─── tree helpers ───────────────────────────────────────────────────────────

export function walk(nodes: SiteNode[], fn: (n: SiteNode, parent: SiteNode | null, depth: number) => void, parent: SiteNode | null = null, depth = 0) {
  for (const n of nodes) {
    fn(n, parent, depth);
    if (n.children) walk(n.children, fn, n, depth + 1);
  }
}

export function findNode(nodes: SiteNode[], id: string): SiteNode | null {
  let out: SiteNode | null = null;
  walk(nodes, (n) => {
    if (!out && n.id === id) out = n;
  });
  return out;
}

/** The list holding a node and its index there. */
export function locate(body: SiteNode[], id: string): { list: SiteNode[]; index: number; parent: SiteNode | null } | null {
  const search = (list: SiteNode[], parent: SiteNode | null): { list: SiteNode[]; index: number; parent: SiteNode | null } | null => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { list, index: i, parent };
      const c = list[i].children;
      if (c) {
        const r = search(c, list[i]);
        if (r) return r;
      }
    }
    return null;
  };
  return search(body, null);
}

export function canHold(n: SiteNode): boolean {
  return !TEXT_TAGS.has(n.tag) && !VOID_TAGS.has(n.tag);
}

/** A deep copy with new ids (duplicate / paste). */
export function cloneNode(n: SiteNode): SiteNode {
  const c: SiteNode = JSON.parse(JSON.stringify(n));
  const fresh = (x: SiteNode) => {
    x.id = uid();
    x.children?.forEach(fresh);
  };
  fresh(c);
  return c;
}

/** Remove a node; true if found. */
export function removeNode(body: SiteNode[], id: string): boolean {
  const at = locate(body, id);
  if (!at) return false;
  at.list.splice(at.index, 1);
  return true;
}

/** Is `id` inside `ancestor` (or the same)? */
export function isWithin(body: SiteNode[], ancestor: string, id: string): boolean {
  const a = findNode(body, ancestor);
  return !!a && (a.id === id || !!findNode(a.children ?? [], id));
}

/** Move a node before/after/inside another. */
export function moveNode(body: SiteNode[], id: string, target: string, where: "before" | "after" | "inside"): boolean {
  if (id === target || isWithin(body, id, target)) return false;
  const from = locate(body, id);
  if (!from) return false;
  const [node] = from.list.splice(from.index, 1);
  if (where === "inside") {
    const t = findNode(body, target);
    if (!t || !canHold(t)) {
      from.list.splice(from.index, 0, node);
      return false;
    }
    (t.children ??= []).push(node);
    return true;
  }
  const to = locate(body, target);
  if (!to) {
    from.list.splice(from.index, 0, node);
    return false;
  }
  to.list.splice(to.index + (where === "after" ? 1 : 0), 0, node);
  return true;
}

// ─── parsing (agents write these files too) ─────────────────────────────────

const str = (v: unknown, max = 100000) => (typeof v === "string" ? v.slice(0, max) : undefined);

function parseStyles(v: unknown): Styles | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Styles = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val == null || val === "") continue;
    const key = k.includes("-") || k.toLowerCase() === k ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    if (!/^-?-?[a-z][a-z0-9-]*$/.test(key)) continue;
    out[key] = String(val).slice(0, 2000).replace(/[{}]/g, "");
  }
  return Object.keys(out).length ? out : undefined;
}

function parseNode(v: unknown, depth = 0): SiteNode | null {
  if (!v || typeof v !== "object" || depth > 40) return null;
  const o = v as Record<string, unknown>;
  const tag = (TAGS.includes(o.tag as NodeTag) ? o.tag : o.tag === "img" ? "img" : "div") as NodeTag;
  const a = (o.attrs ?? {}) as Record<string, unknown>;
  const attrs: NodeAttrs = {};
  for (const k of ["href", "src", "alt", "placeholder", "type", "name", "anchor"] as const) {
    const s = str(a[k], k === "src" ? 8_000_000 : 4000);
    if (s) attrs[k] = s;
  }
  for (const k of ["newTab", "autoplay", "loop", "controls"] as const) if (a[k] === true) attrs[k] = true;
  const node: SiteNode = { id: str(o.id, 80) || uid(), tag };
  if (str(o.name, 200)) node.name = str(o.name, 200);
  if (typeof o.text === "string") node.text = o.text.slice(0, 20000);
  if (tag === "embed" && typeof o.html === "string") node.html = o.html.slice(0, 200000);
  if (Object.keys(attrs).length) node.attrs = attrs;
  if (Array.isArray(o.classes)) {
    const cls = o.classes.map(String).map(className).filter(Boolean);
    if (cls.length) node.classes = [...new Set(cls)];
  }
  for (const k of ["style", "tablet", "mobile", "hover"] as const) {
    const s = parseStyles(o[k]);
    if (s) node[k] = s;
  }
  if (o.hidden === true) node.hidden = true;
  if (Array.isArray(o.children) && !TEXT_TAGS.has(tag) && !VOID_TAGS.has(tag)) {
    node.children = o.children.map((c) => parseNode(c, depth + 1)).filter((c): c is SiteNode => !!c);
  }
  return node;
}

/** A class name made safe ("Hero Title" → "hero-title"). */
export function className(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(\d)/, "c-$1").slice(0, 60);
}

export function slugOf(s: string): string {
  const v = s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return v || "page";
}

export function parseSite(value: unknown): SiteFile {
  const v = (value ?? {}) as Record<string, unknown>;
  const t = (v.theme ?? {}) as Record<string, unknown>;
  const base = blankSite();
  const colors = Array.isArray(t.colors)
    ? (t.colors as Record<string, unknown>[])
        .filter((c) => c && typeof c.name === "string" && typeof c.value === "string")
        .map((c) => ({ name: className(String(c.name)) || "color", value: String(c.value).slice(0, 100) }))
    : base.theme.colors;
  const theme: SiteTheme = {
    colors: colors.length ? colors : base.theme.colors,
    headingFont: str(t.headingFont, 200) || base.theme.headingFont,
    bodyFont: str(t.bodyFont, 200) || base.theme.bodyFont,
    baseSize: typeof t.baseSize === "number" && t.baseSize >= 10 && t.baseSize <= 32 ? t.baseSize : base.theme.baseSize,
  };
  const classes = Array.isArray(v.classes)
    ? (v.classes as Record<string, unknown>[])
        .filter((c) => c && typeof c.name === "string")
        .map((c) => {
          const out: SiteClass = { name: className(String(c.name)), style: parseStyles(c.style) ?? {} };
          for (const k of ["tablet", "mobile", "hover"] as const) {
            const s = parseStyles(c[k]);
            if (s) out[k] = s;
          }
          return out;
        })
        .filter((c) => c.name)
    : [];
  const seen = new Set<string>();
  const pages = (Array.isArray(v.pages) ? (v.pages as Record<string, unknown>[]) : [])
    .filter((p) => p && typeof p === "object")
    .slice(0, 100)
    .map((p, i) => {
      let slug = i === 0 ? "index" : slugOf(str(p.slug) || str(p.name) || `page-${i + 1}`);
      if (slug === "index" && i > 0) slug = `page-${i + 1}`;
      while (seen.has(slug)) slug = `${slug}-2`;
      seen.add(slug);
      const name = str(p.name, 200) || (i === 0 ? "Home" : slug);
      return {
        id: str(p.id, 80) || uid("p"),
        name,
        slug,
        title: str(p.title, 300) ?? name,
        description: str(p.description, 1000) ?? "",
        body: (Array.isArray(p.body) ? p.body : []).map((n) => parseNode(n)).filter((n): n is SiteNode => !!n),
      };
    });
  return {
    type: "site",
    version: 1,
    theme,
    classes,
    pages: pages.length ? pages : base.pages,
    ...(str(v.css, 200000) ? { css: str(v.css, 200000) } : {}),
    ...(str(v.head, 50000) ? { head: str(v.head, 50000) } : {}),
    ...(str(v.preview, 2_000_000)?.startsWith("data:image/") ? { preview: str(v.preview, 2_000_000) } : {}),
  };
}

// ─── rendering ──────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function decls(s: Styles | undefined): string {
  if (!s) return "";
  return Object.entries(s)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

function fontOf(label: string): { stack: string; google?: string } {
  const f = FONTS.find((x) => x.label === label);
  return f ?? { stack: label };
}

/** All the site's CSS: reset, theme, classes, then each element's own. */
export function siteCss(site: SiteFile, page?: SitePage): string {
  const th = site.theme;
  const hf = fontOf(th.headingFont).stack;
  const bf = fontOf(th.bodyFont).stack;
  const vars = th.colors.map((c) => `--${c.name}:${c.value}`).join(";");
  const out: string[] = [
    `:root{${vars};--heading-font:${hf};--body-font:${bf}}`,
    "*,*::before,*::after{box-sizing:border-box}",
    `html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}body{margin:0;font-family:var(--body-font);font-size:${th.baseSize}px;line-height:1.6;color:var(--text,#1f2328);background:var(--background,#fff)}`,
    "h1,h2,h3,h4{font-family:var(--heading-font);line-height:1.15;margin:0 0 .5em}h1{font-size:3.2em}h2{font-size:2.3em}h3{font-size:1.5em}h4{font-size:1.2em}",
    "p{margin:0 0 1em}img,video{max-width:100%;display:block}a{color:var(--primary,#2563eb)}button{font:inherit;cursor:pointer}input,textarea{font:inherit}ul,ol{margin:0 0 1em;padding-left:1.3em}hr{border:0;border-top:1px solid currentColor;opacity:.15;margin:1.5em 0}",
  ];
  const media: Record<"tablet" | "mobile", string[]> = { tablet: [], mobile: [] };
  for (const c of site.classes) {
    if (c.style && Object.keys(c.style).length) out.push(`.${c.name}{${decls(c.style)}}`);
    if (c.hover) out.push(`.${c.name}:hover{${decls(c.hover)}}`);
    if (c.tablet) media.tablet.push(`.${c.name}{${decls(c.tablet)}}`);
    if (c.mobile) media.mobile.push(`.${c.name}{${decls(c.mobile)}}`);
  }
  const pages = page ? [page] : site.pages;
  for (const p of pages) {
    walk(p.body, (n) => {
      const sel = `[data-n="${n.id}"]`;
      if (n.style && Object.keys(n.style).length) out.push(`${sel}{${decls(n.style)}}`);
      if (n.hover) out.push(`${sel}:hover{${decls(n.hover)}}`);
      if (n.tablet) media.tablet.push(`${sel}{${decls(n.tablet)}}`);
      if (n.mobile) media.mobile.push(`${sel}{${decls(n.mobile)}}`);
    });
  }
  if (media.tablet.length) out.push(`@media ${BREAKPOINTS.tablet.query}{${media.tablet.join("")}}`);
  if (media.mobile.length) out.push(`@media ${BREAKPOINTS.mobile.query}{${media.mobile.join("")}}`);
  if (site.css) out.push(site.css);
  return out.join("\n");
}

/** Where a link goes, in the exported site. */
export function hrefOf(site: SiteFile, href: string): string {
  if (href.startsWith("page:")) {
    const p = site.pages.find((x) => x.id === href.slice(5));
    return p ? `${p.slug}.html` : "#";
  }
  if (/^\s*javascript:/i.test(href)) return "#";
  return href;
}

/** One element as HTML. `editor` adds what the canvas needs. */
export function nodeHtml(site: SiteFile, n: SiteNode, editor = false): string {
  if (n.hidden && !editor) return "";
  const a = n.attrs ?? {};
  const cls = n.classes?.length ? ` class="${esc(n.classes.join(" "))}"` : "";
  const id = a.anchor ? ` id="${esc(a.anchor)}"` : "";
  const hide = n.hidden && editor ? ` data-hidden=""` : "";
  const common = ` data-n="${n.id}"${cls}${id}${hide}`;
  const text = esc(n.text ?? "").replace(/\n/g, "<br>");
  const kids = () => (n.children ?? []).map((c) => nodeHtml(site, c, editor)).join("");
  switch (n.tag) {
    case "img":
      return `<img${common} src="${esc(a.src || PLACEHOLDER_IMG)}" alt="${esc(a.alt ?? "")}"${editor ? "" : ' loading="lazy"'}>`;
    case "video":
      return `<video${common} src="${esc(a.src ?? "")}"${a.controls !== false ? " controls" : ""}${a.autoplay ? " autoplay muted playsinline" : ""}${a.loop ? " loop" : ""}></video>`;
    case "hr":
      return `<hr${common}>`;
    case "input":
      return `<input${common} type="${esc(a.type || "text")}" name="${esc(a.name ?? "")}" placeholder="${esc(a.placeholder ?? "")}">`;
    case "textarea":
      return `<textarea${common} name="${esc(a.name ?? "")}" placeholder="${esc(a.placeholder ?? "")}"></textarea>`;
    case "embed":
      // In the editor the embed is shown inert, so its scripts can't run in the app.
      return editor ? `<div${common} data-embed="">${(n.html ?? "").replace(/<script[\s\S]*?<\/script>/gi, "")}</div>` : `<div${common}>${n.html ?? ""}</div>`;
    case "a": {
      const href = a.href ? hrefOf(site, a.href) : "#";
      return `<a${common} href="${esc(editor ? "#" : href)}"${a.newTab && !editor ? ' target="_blank" rel="noopener"' : ""}${editor && a.href ? ` data-href="${esc(a.href)}"` : ""}>${text}${kids()}</a>`;
    }
    case "button": {
      if (a.href && !editor) {
        return `<a${common} href="${esc(hrefOf(site, a.href))}" role="button"${a.newTab ? ' target="_blank" rel="noopener"' : ""}>${text}</a>`;
      }
      return `<button${common} type="${esc(a.type === "submit" ? "submit" : "button")}">${text}</button>`;
    }
    case "form":
      return `<form${common}${editor ? ' onsubmit="return false"' : ""}>${kids()}</form>`;
    default:
      if (TEXT_TAGS.has(n.tag)) return `<${n.tag}${common}>${text}</${n.tag}>`;
      return `<${n.tag}${common}>${kids()}</${n.tag}>`;
  }
}

export function pageBody(site: SiteFile, page: SitePage, editor = false): string {
  return page.body.map((n) => nodeHtml(site, n, editor)).join("\n");
}

function fontLinks(site: SiteFile): string {
  const fams = [...new Set([site.theme.headingFont, site.theme.bodyFont].map((l) => fontOf(l).google).filter(Boolean))];
  if (!fams.length) return "";
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}`).join("&")}&display=swap">`;
}

/** A page as a complete HTML document. With `cssHref` the CSS is linked
 *  (the exported site shares one stylesheet); otherwise it's inline. */
export function pageHtml(site: SiteFile, page: SitePage, opts: { cssHref?: string } = {}): string {
  const css = opts.cssHref ? `<link rel="stylesheet" href="${esc(opts.cssHref)}">` : `<style>${siteCss(site, page)}</style>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title || page.name)}</title>
${page.description ? `<meta name="description" content="${esc(page.description)}">\n` : ""}${fontLinks(site)}
${css}
${site.head ?? ""}
</head>
<body>
${pageBody(site, page)}
</body>
</html>
`;
}

/** The editor canvas's document: the page, plus a script that reports
 *  clicks, hovers and text edits to the editor, and takes re-renders. */
export function canvasHtml(site: SiteFile, page: SitePage): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fontLinks(site)}<style id="site-css">${siteCss(site, page)}</style><style>
[data-n]{cursor:default}
.__hover{outline:1px solid #4a9cff!important;outline-offset:-1px}
.__sel{outline:2px solid #2f80ed!important;outline-offset:-2px}
[data-hidden]{opacity:.3}
[data-embed] *{pointer-events:none}
.__empty{min-height:80px;outline:1px dashed rgba(127,127,127,.5);outline-offset:-1px}
[contenteditable]{cursor:text;outline:2px solid #f5a623!important}
#__drop{position:fixed;z-index:2147483646;pointer-events:none;display:none;border:2px solid #2f80ed;background:rgba(47,128,237,.08)}
#__tag{position:fixed;z-index:2147483647;pointer-events:none;background:#2f80ed;color:#fff;font:600 10px/16px system-ui;padding:0 5px;border-radius:2px;display:none;white-space:nowrap}
</style></head><body>${pageBody(site, page, true)}<div id="__tag"></div><div id="__drop"></div><script>
(function(){
var sel=null,hov=null,tag=document.getElementById("__tag"),drop=document.getElementById("__drop"),labels={};
function holds(e){return !/^(IMG|VIDEO|HR|INPUT|TEXTAREA|H1|H2|H3|H4|P|SPAN|A|BUTTON|LI|LABEL)$/.test(e.tagName)&&!e.hasAttribute("data-embed")}
function el(id){return id?document.querySelector('[data-n="'+id+'"]'):null}
function nodeOf(t){while(t&&t!==document.body){if(t.dataset&&t.dataset.n)return t;t=t.parentElement}return null}
function mark(){document.querySelectorAll(".__sel").forEach(function(e){e.classList.remove("__sel")});var s=el(sel);if(s)s.classList.add("__sel");place()}
function place(){var s=el(sel);if(!s){tag.style.display="none";return}var r=s.getBoundingClientRect();tag.textContent=labels[sel]||s.tagName.toLowerCase();tag.style.display="block";tag.style.left=Math.max(0,r.left)+"px";tag.style.top=(r.top>18?r.top-17:r.bottom+1)+"px"}
function empties(){document.querySelectorAll("[data-n]").forEach(function(e){e.classList.toggle("__empty",holds(e)&&!e.children.length&&!e.textContent.trim())})}
function post(m){parent.postMessage(Object.assign({__site:1},m),"*")}
document.addEventListener("mouseover",function(e){var n=nodeOf(e.target);if(hov&&hov!==n)hov.classList.remove("__hover");hov=n;if(n&&n.dataset.n!==sel)n.classList.add("__hover")});
document.addEventListener("mouseout",function(e){if(hov&&!hov.contains(e.relatedTarget)){hov.classList.remove("__hover");hov=null}});
document.addEventListener("click",function(e){if(e.target.isContentEditable)return;e.preventDefault();var n=nodeOf(e.target);post({type:"select",id:n?n.dataset.n:null})},true);
document.addEventListener("dblclick",function(e){var n=nodeOf(e.target);if(!n||!/^(H1|H2|H3|H4|P|SPAN|A|BUTTON|LI|LABEL)$/.test(n.tagName))return;e.preventDefault();n.contentEditable="true";n.focus();var r=document.createRange();r.selectNodeContents(n);var s=getSelection();s.removeAllRanges();s.addRange(r);
function done(){n.removeEventListener("blur",done);n.removeEventListener("keydown",key);n.removeAttribute("contenteditable");post({type:"text",id:n.dataset.n,text:n.innerText.replace(/\\n$/,"")})}
function key(k){if(k.key==="Enter"&&!k.shiftKey){k.preventDefault();n.blur()}if(k.key==="Escape"){n.blur()}k.stopPropagation()}
n.addEventListener("blur",done);n.addEventListener("keydown",key)});
document.addEventListener("keydown",function(e){if(e.target.isContentEditable)return;post({type:"key",key:e.key,ctrl:e.ctrlKey||e.metaKey,shift:e.shiftKey});if((e.ctrlKey||e.metaKey)&&/^[zysdcvx]$/i.test(e.key))e.preventDefault()});
addEventListener("scroll",place,true);addEventListener("resize",place);
addEventListener("message",function(e){var m=e.data||{};if(m.type==="render"){var y=scrollY;document.getElementById("site-css").textContent=m.css;document.body.innerHTML=m.body;document.body.appendChild(tag);document.body.appendChild(drop);labels=m.labels||{};empties();mark();scrollTo(0,y)}
if(m.type==="hit"){var t=document.elementFromPoint(m.x,m.y),n=nodeOf(t),d=drop.style;d.display="block";
if(!n){var lb=0;document.querySelectorAll("body>[data-n]").forEach(function(x){lb=Math.max(lb,x.getBoundingClientRect().bottom)});d.left="0";d.width="100%";d.top=Math.min(lb,innerHeight-4)+"px";d.height="0";post({type:"hit",id:null});return}
var r=n.getBoundingClientRect(),rel=(m.y-r.top)/Math.max(1,r.height),w=holds(n)&&rel>.25&&rel<.75?"inside":rel<.5?"before":"after";
d.left=r.left+"px";d.width=r.width+"px";if(w==="inside"){d.top=r.top+"px";d.height=r.height+"px"}else{d.top=(w==="before"?r.top:r.bottom)-1+"px";d.height="0"}
post({type:"hit",id:n.dataset.n,where:w})}
if(m.type==="hitclear"){drop.style.display="none"}
if(m.type==="select"){sel=m.id;labels=m.labels||labels;mark();if(m.reveal){var s=el(sel);if(s){var r=s.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight)s.scrollIntoView({block:"center"})}}}});
empties();post({type:"ready"});
})();
</script></body></html>`;
}

export const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#e9ecf1"/><path d="M300 330l80-100 70 80 50-55 100 75z" fill="#c3cad6"/><circle cx="330" cy="190" r="30" fill="#c3cad6"/></svg>',
  );

// ─── export: a .zip with every page and one stylesheet ──────────────────────

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A plain (stored, uncompressed) .zip of the given files. */
export function zipFiles(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Every page as its own .html sharing styles.css, ready to host anywhere. */
export function exportSite(site: SiteFile): { name: string; data: Uint8Array }[] {
  const enc = new TextEncoder();
  return [
    { name: "styles.css", data: enc.encode(siteCss(site)) },
    ...site.pages.map((p) => ({ name: `${p.slug}.html`, data: enc.encode(pageHtml(site, p, { cssHref: "styles.css" })) })),
  ];
}

// ─── new sites and ready-made sections ──────────────────────────────────────

export const DEFAULT_COLORS = [
  { name: "primary", value: "#4f46e5" },
  { name: "accent", value: "#f59e0b" },
  { name: "text", value: "#1f2328" },
  { name: "muted", value: "#5b6472" },
  { name: "background", value: "#ffffff" },
  { name: "surface", value: "#f5f6f8" },
];

/** The classes a new site starts with (the sections below use them). */
export const BASE_CLASSES: SiteClass[] = [
  { name: "container", style: { width: "100%", "max-width": "1140px", margin: "0 auto", padding: "0 24px" } },
  { name: "section", style: { padding: "96px 0" }, mobile: { padding: "64px 0" } },
  { name: "eyebrow", style: { "text-transform": "uppercase", "letter-spacing": "0.12em", "font-size": "13px", "font-weight": "700", color: "var(--primary)", margin: "0 0 12px" } },
  { name: "lead", style: { "font-size": "1.25em", color: "var(--muted)", "max-width": "640px" } },
  {
    name: "button",
    style: { display: "inline-block", padding: "14px 26px", "border-radius": "10px", background: "var(--primary)", color: "#fff", "font-weight": "600", "text-decoration": "none", border: "0", transition: "transform .15s, box-shadow .15s" },
    hover: { transform: "translateY(-1px)", "box-shadow": "0 8px 24px rgba(0,0,0,.15)" },
  },
  { name: "button-ghost", style: { background: "transparent", color: "var(--text)", "box-shadow": "inset 0 0 0 1.5px currentColor" } },
  { name: "grid-3", style: { display: "grid", "grid-template-columns": "repeat(3, 1fr)", gap: "24px" }, tablet: { "grid-template-columns": "repeat(2, 1fr)" }, mobile: { "grid-template-columns": "1fr" } },
  { name: "card", style: { padding: "28px", "border-radius": "16px", background: "var(--surface)" } },
  { name: "center", style: { "text-align": "center" } },
  { name: "row", style: { display: "flex", "align-items": "center", gap: "16px", "flex-wrap": "wrap" } },
];

const N = (tag: NodeTag, extra: Partial<SiteNode> = {}): SiteNode => ({ id: uid(), tag, ...extra });
const T = (tag: NodeTag, text: string, extra: Partial<SiteNode> = {}): SiteNode => N(tag, { text, ...extra });

export type Preset = { id: string; label: string; group: "Elements" | "Layout" | "Sections"; make: (site: SiteFile) => SiteNode };

export const PRESETS: Preset[] = [
  // elements
  { id: "heading", label: "Heading", group: "Elements", make: () => T("h2", "Heading") },
  { id: "paragraph", label: "Paragraph", group: "Elements", make: () => T("p", "Write something here. Double-click any text on the canvas to edit it.") },
  { id: "link", label: "Text link", group: "Elements", make: () => T("a", "Link text", { attrs: { href: "#" } }) },
  { id: "button", label: "Button", group: "Elements", make: () => T("button", "Get started", { classes: ["button"], attrs: { href: "#" } }) },
  { id: "image", label: "Image", group: "Elements", make: () => N("img", { attrs: { alt: "" }, style: { width: "100%", "border-radius": "12px" } }) },
  { id: "video", label: "Video", group: "Elements", make: () => N("video", { attrs: { src: "", controls: true }, style: { width: "100%" } }) },
  { id: "list", label: "List", group: "Elements", make: () => N("ul", { children: [T("li", "First point"), T("li", "Second point"), T("li", "Third point")] }) },
  { id: "divider", label: "Divider", group: "Elements", make: () => N("hr") },
  {
    id: "form",
    label: "Form",
    group: "Elements",
    make: () =>
      N("form", {
        style: { display: "grid", gap: "12px", "max-width": "480px" },
        children: [
          N("input", { attrs: { type: "text", name: "name", placeholder: "Your name" }, classes: ["field"] }),
          N("input", { attrs: { type: "email", name: "email", placeholder: "Email" }, classes: ["field"] }),
          N("textarea", { attrs: { name: "message", placeholder: "Message" }, classes: ["field"], style: { "min-height": "120px" } }),
          T("button", "Send", { classes: ["button"], attrs: { type: "submit" } }),
        ],
      }),
  },
  { id: "embed", label: "Embed code", group: "Elements", make: () => N("embed", { html: "<p>Paste HTML here (a map, a video player, a form…)</p>" }) },
  // layout
  { id: "section", label: "Section", group: "Layout", make: () => N("section", { classes: ["section"], children: [N("div", { classes: ["container"] })] }) },
  { id: "container", label: "Container", group: "Layout", make: () => N("div", { classes: ["container"] }) },
  { id: "div", label: "Div block", group: "Layout", make: () => N("div") },
  { id: "row", label: "Flex row", group: "Layout", make: () => N("div", { classes: ["row"] }) },
  { id: "columns2", label: "2 columns", group: "Layout", make: () => N("div", { style: { display: "grid", "grid-template-columns": "1fr 1fr", gap: "32px", "align-items": "center" }, mobile: { "grid-template-columns": "1fr" }, children: [N("div"), N("div")] }) },
  { id: "grid3", label: "3-column grid", group: "Layout", make: () => N("div", { classes: ["grid-3"], children: [N("div", { classes: ["card"] }), N("div", { classes: ["card"] }), N("div", { classes: ["card"] })] }) },
  // sections
  {
    id: "navbar",
    label: "Navbar",
    group: "Sections",
    make: (site) =>
      N("header", {
        name: "Navbar",
        style: { position: "sticky", top: "0", "z-index": "10", background: "color-mix(in srgb, var(--background) 85%, transparent)", "backdrop-filter": "blur(10px)", "border-bottom": "1px solid rgba(127,127,127,.15)" },
        children: [
          N("nav", {
            classes: ["container"],
            style: { display: "flex", "align-items": "center", "justify-content": "space-between", height: "68px" },
            children: [
              T("a", "Brand", { attrs: { href: `page:${site.pages[0]?.id ?? ""}` }, style: { "font-weight": "800", "font-size": "20px", color: "var(--text)", "text-decoration": "none" } }),
              N("div", {
                classes: ["row"],
                style: { gap: "28px" },
                mobile: { display: "none" },
                children: site.pages.slice(0, 5).map((p) => T("a", p.name, { attrs: { href: `page:${p.id}` }, style: { color: "var(--text)", "text-decoration": "none", "font-weight": "500" } })),
              }),
              T("button", "Get started", { classes: ["button"], attrs: { href: "#" }, style: { padding: "10px 18px" } }),
            ],
          }),
        ],
      }),
  },
  {
    id: "hero",
    label: "Hero",
    group: "Sections",
    make: () =>
      N("section", {
        name: "Hero",
        classes: ["section"],
        style: { padding: "120px 0 96px" },
        children: [
          N("div", {
            classes: ["container", "center"],
            children: [
              T("p", "New", { classes: ["eyebrow"] }),
              T("h1", "Build something people love", { style: { "max-width": "820px", margin: "0 auto 20px" }, mobile: { "font-size": "2.3em" } }),
              T("p", "A short, clear line about what this is and who it's for. Keep it to one or two sentences.", { classes: ["lead"], style: { margin: "0 auto 32px" } }),
              N("div", {
                classes: ["row"],
                style: { "justify-content": "center" },
                children: [T("button", "Get started", { classes: ["button"], attrs: { href: "#" } }), T("button", "Learn more", { classes: ["button", "button-ghost"], attrs: { href: "#" } })],
              }),
            ],
          }),
        ],
      }),
  },
  {
    id: "features",
    label: "Features",
    group: "Sections",
    make: () =>
      N("section", {
        name: "Features",
        classes: ["section"],
        style: { background: "var(--surface)" },
        children: [
          N("div", {
            classes: ["container"],
            children: [
              T("p", "Features", { classes: ["eyebrow", "center"] }),
              T("h2", "Everything you need", { classes: ["center"], style: { "margin-bottom": "48px" } }),
              N("div", {
                classes: ["grid-3"],
                children: ["Fast", "Simple", "Reliable"].map((h) =>
                  N("div", {
                    classes: ["card"],
                    style: { background: "var(--background)" },
                    children: [T("h3", h), T("p", "One or two sentences on why this matters to the people using it.", { style: { color: "var(--muted)", margin: "0" } })],
                  }),
                ),
              }),
            ],
          }),
        ],
      }),
  },
  {
    id: "split",
    label: "Image + text",
    group: "Sections",
    make: () =>
      N("section", {
        name: "Image and text",
        classes: ["section"],
        children: [
          N("div", {
            classes: ["container"],
            style: { display: "grid", "grid-template-columns": "1fr 1fr", gap: "56px", "align-items": "center" },
            tablet: { "grid-template-columns": "1fr" },
            children: [
              N("img", { attrs: { alt: "" }, style: { width: "100%", "border-radius": "16px" } }),
              N("div", { children: [T("p", "Why us", { classes: ["eyebrow"] }), T("h2", "A heading that makes the point"), T("p", "Say more here: what it does, how it helps, and what makes it different.", { classes: ["lead"], style: { "margin-bottom": "28px" } }), T("button", "Read more", { classes: ["button"], attrs: { href: "#" } })] }),
            ],
          }),
        ],
      }),
  },
  {
    id: "pricing",
    label: "Pricing",
    group: "Sections",
    make: () =>
      N("section", {
        name: "Pricing",
        classes: ["section"],
        children: [
          N("div", {
            classes: ["container"],
            children: [
              T("h2", "Simple pricing", { classes: ["center"], style: { "margin-bottom": "48px" } }),
              N("div", {
                classes: ["grid-3"],
                children: [
                  ["Starter", "$0", "For trying it out"],
                  ["Pro", "$19", "For growing teams"],
                  ["Business", "$49", "For larger companies"],
                ].map(([name, price, note], i) =>
                  N("div", {
                    classes: ["card"],
                    style: i === 1 ? { background: "var(--primary)", color: "#fff" } : {},
                    children: [
                      T("h3", name),
                      T("p", price, { style: { "font-size": "44px", "font-weight": "800", margin: "0", "line-height": "1.1" } }),
                      T("p", note, { style: { opacity: "0.75" } }),
                      N("ul", { style: { margin: "0 0 24px" }, children: [T("li", "Everything you need"), T("li", "Unlimited projects"), T("li", "Email support")] }),
                      T("button", "Choose plan", { classes: ["button"], attrs: { href: "#" }, style: i === 1 ? { background: "#fff", color: "var(--primary)" } : {} }),
                    ],
                  }),
                ),
              }),
            ],
          }),
        ],
      }),
  },
  {
    id: "testimonials",
    label: "Testimonials",
    group: "Sections",
    make: () =>
      N("section", {
        name: "Testimonials",
        classes: ["section"],
        style: { background: "var(--surface)" },
        children: [
          N("div", {
            classes: ["container"],
            children: [
              T("h2", "What people say", { classes: ["center"], style: { "margin-bottom": "48px" } }),
              N("div", {
                classes: ["grid-3"],
                children: ["Alex P.", "Sam R.", "Jordan K."].map((who) =>
                  N("div", { classes: ["card"], style: { background: "var(--background)" }, children: [T("p", "“A short quote about how it helped them, in their own words.”", { style: { "font-size": "1.1em" } }), T("p", who, { style: { "font-weight": "700", margin: "0" } })] }),
                ),
              }),
            ],
          }),
        ],
      }),
  },
  {
    id: "faq",
    label: "FAQ",
    group: "Sections",
    make: () =>
      N("section", {
        name: "FAQ",
        classes: ["section"],
        children: [
          N("div", {
            classes: ["container"],
            style: { "max-width": "760px" },
            children: [
              T("h2", "Questions and answers", { classes: ["center"], style: { "margin-bottom": "40px" } }),
              ...["How does it work?", "What does it cost?", "Can I cancel any time?"].flatMap((q) => [T("h3", q, { style: { "font-size": "1.15em", "margin-top": "28px" } }), T("p", "A clear, short answer to the question.", { style: { color: "var(--muted)" } })]),
            ],
          }),
        ],
      }),
  },
  {
    id: "cta",
    label: "Call to action",
    group: "Sections",
    make: () =>
      N("section", {
        name: "Call to action",
        classes: ["section"],
        children: [
          N("div", {
            classes: ["container"],
            children: [
              N("div", {
                classes: ["center"],
                style: { padding: "64px 32px", "border-radius": "24px", background: "var(--primary)", color: "#fff" },
                children: [T("h2", "Ready to start?"), T("p", "One line that gives a reason to act now.", { style: { opacity: "0.85", "margin-bottom": "28px" } }), T("button", "Get started", { classes: ["button"], attrs: { href: "#" }, style: { background: "#fff", color: "var(--primary)" } })],
              }),
            ],
          }),
        ],
      }),
  },
  {
    id: "contact",
    label: "Contact",
    group: "Sections",
    make: () =>
      N("section", {
        name: "Contact",
        classes: ["section"],
        children: [
          N("div", {
            classes: ["container"],
            style: { "max-width": "560px" },
            children: [
              T("h2", "Get in touch"),
              T("p", "Send a message and we'll reply within a day.", { classes: ["lead"], style: { "margin-bottom": "28px" } }),
              N("form", {
                style: { display: "grid", gap: "12px" },
                children: [
                  N("input", { attrs: { type: "text", name: "name", placeholder: "Your name" }, classes: ["field"] }),
                  N("input", { attrs: { type: "email", name: "email", placeholder: "Email" }, classes: ["field"] }),
                  N("textarea", { attrs: { name: "message", placeholder: "Message" }, classes: ["field"], style: { "min-height": "140px" } }),
                  T("button", "Send", { classes: ["button"], attrs: { type: "submit" } }),
                ],
              }),
            ],
          }),
        ],
      }),
  },
  {
    id: "footer",
    label: "Footer",
    group: "Sections",
    make: (site) =>
      N("footer", {
        name: "Footer",
        style: { padding: "48px 0", "border-top": "1px solid rgba(127,127,127,.15)", color: "var(--muted)", "font-size": "14px" },
        children: [
          N("div", {
            classes: ["container", "row"],
            style: { "justify-content": "space-between" },
            children: [
              T("p", `© ${new Date().getFullYear()} Brand. All rights reserved.`, { style: { margin: "0" } }),
              N("div", { classes: ["row"], style: { gap: "20px" }, children: site.pages.slice(0, 4).map((p) => T("a", p.name, { attrs: { href: `page:${p.id}` }, style: { color: "inherit", "text-decoration": "none" } })) }),
            ],
          }),
        ],
      }),
  },
];

export function presetNode(id: string, site: SiteFile): SiteNode | null {
  const p = PRESETS.find((x) => x.id === id);
  return p ? p.make(site) : null;
}

/** A new site: a home page with a navbar, hero, features and footer. */
export function blankSite(): SiteFile {
  const site: SiteFile = {
    type: "site",
    version: 1,
    theme: { colors: DEFAULT_COLORS.map((c) => ({ ...c })), headingFont: "Inter", bodyFont: "Inter", baseSize: 16 },
    classes: [
      ...BASE_CLASSES.map((c) => JSON.parse(JSON.stringify(c)) as SiteClass),
      { name: "field", style: { width: "100%", padding: "12px 14px", "border-radius": "10px", border: "1px solid rgba(127,127,127,.35)", background: "var(--background)", color: "var(--text)" } },
    ],
    pages: [{ id: uid("p"), name: "Home", slug: "index", title: "Home", description: "", body: [] }],
  };
  site.pages[0].body = ["navbar", "hero", "features", "footer"].map((id) => presetNode(id, site) as SiteNode);
  return site;
}

export const SITE_SPEC =
  'JSON: {"type":"site","version":1,"theme":{"colors":[{"name":"primary","value":"#4f46e5"},{"name":"text","value":"#1f2328"},{"name":"background","value":"#fff"},{"name":"surface","value":"#f5f6f8"},{"name":"muted","value":"#5b6472"}],"headingFont":"Inter","bodyFont":"Inter","baseSize":16},"classes":[{"name":"container","style":{"max-width":"1140px","margin":"0 auto","padding":"0 24px"},"tablet":{…},"mobile":{…},"hover":{…}}],"pages":[{"id":"home","name":"Home","slug":"index","title":"…","description":"…","body":[NODE,…]}],"css":"optional extra CSS","head":"optional extra <head> code"}. A NODE is {"id":"unique","tag":"section|div|header|footer|nav|h1|h2|h3|h4|p|span|a|button|img|video|ul|ol|li|hr|form|input|textarea|label|embed","name":"optional label","text":"for text tags (h1–h4, p, span, a, button, li, label)","children":[NODE,…] (containers only),"classes":["container"],"style":{"css-property":"value"},"tablet":{…},"mobile":{…},"hover":{…},"attrs":{"href":"https://… or #anchor or page:<page id>","newTab":true,"src":"image/video URL or data: URL","alt":"…","placeholder":"…","type":"email","name":"…","anchor":"id to link to"}}. "embed" takes "html". Styles are plain CSS (kebab-case); colours can use var(--primary) etc. The first page is the home page. Fonts: System, Inter, Poppins, DM Sans, Montserrat, Playfair Display, Lora, Space Grotesk, Georgia, Mono. Build real content (no lorem ipsum), responsive with tablet/mobile overrides, and keep sections as separate nodes so the owner can keep editing them.';
