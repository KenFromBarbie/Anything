import assert from "node:assert/strict";
import test from "node:test";

import { editorKindOf, parseFile } from "./formats.ts";
import {
  blankSite,
  crc32,
  exportSite,
  findNode,
  moveNode,
  pageHtml,
  parseSite,
  presetNode,
  PRESETS,
  siteCss,
  zipFiles,
} from "./siteFormat.ts";

test("a new site: home page with sections, renders to a full page", () => {
  const s = blankSite();
  assert.equal(s.pages.length, 1);
  assert.equal(s.pages[0].slug, "index");
  assert.deepEqual(s.pages[0].body.map((n) => n.name), ["Navbar", "Hero", "Features", "Footer"]);
  const html = pageHtml(s, s.pages[0]);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<h1 data-n="[^"]+">Build something people love<\/h1>/);
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Inter/);
  // round trip through JSON and the parser keeps it the same
  assert.deepEqual(parseSite(JSON.parse(JSON.stringify(s))), s);
  assert.equal(editorKindOf("C:/x/My site.site.json"), "site");
  assert.equal(parseFile("site", s).type, "site");
});

test("every ready-made block builds", () => {
  const s = blankSite();
  for (const p of PRESETS) {
    const n = presetNode(p.id, s);
    assert.ok(n && n.id && n.tag, p.id);
  }
});

test("styles: classes, element styles, breakpoints and hover", () => {
  const s = parseSite({
    pages: [
      {
        name: "Home",
        body: [
          {
            id: "a",
            tag: "h1",
            text: "Hi <there>",
            classes: ["Hero Title"],
            style: { fontSize: "40px", color: "var(--primary)" },
            mobile: { "font-size": "28px" },
            hover: { color: "red" },
          },
        ],
      },
      { name: "About us", body: [] },
      { name: "About us", body: [] },
    ],
    classes: [{ name: "hero-title", style: { "letter-spacing": "-0.02em" }, tablet: { "letter-spacing": "0" } }],
  });
  assert.deepEqual(s.pages.map((p) => p.slug), ["index", "about-us", "about-us-2"]);
  const n = s.pages[0].body[0];
  assert.deepEqual(n.classes, ["hero-title"]);
  assert.equal(n.style["font-size"], "40px"); // camelCase → kebab
  const css = siteCss(s);
  assert.match(css, /\.hero-title\{letter-spacing:-0\.02em\}/);
  assert.match(css, /\[data-n="a"\]\{font-size:40px;color:var\(--primary\)\}/);
  assert.match(css, /\[data-n="a"\]:hover\{color:red\}/);
  assert.match(css, /@media \(max-width: 991px\)\{\.hero-title\{letter-spacing:0\}\}/);
  assert.match(css, /@media \(max-width: 767px\)\{\[data-n="a"\]\{font-size:28px\}\}/);
  // text is escaped
  assert.match(pageHtml(s, s.pages[0]), /Hi &lt;there&gt;/);
});

test("links between pages, hidden elements, unsafe input", () => {
  const s = parseSite({
    pages: [
      { id: "home", name: "Home", body: [{ id: "l", tag: "a", text: "About", attrs: { href: "page:ab", newTab: true } }, { id: "h", tag: "p", text: "secret", hidden: true }, { id: "x", tag: "a", text: "x", attrs: { href: "javascript:alert(1)" } }] },
      { id: "ab", name: "About", body: [] },
      "nonsense",
    ],
  });
  assert.equal(s.pages.length, 2);
  const html = pageHtml(s, s.pages[0]);
  assert.match(html, /href="about\.html" target="_blank" rel="noopener">About<\/a>/);
  assert.doesNotMatch(html, /secret/);
  assert.doesNotMatch(html, /javascript:/);
  // style values can't break out of their rule
  const t = parseSite({ pages: [{ body: [{ id: "q", tag: "div", style: { color: "red} body{display:none" } }] }] });
  assert.doesNotMatch(siteCss(t), /\}\s*body\{display:none/);
});

test("moving elements in the tree", () => {
  const body = [
    { id: "s1", tag: "section", children: [{ id: "a", tag: "p", text: "a" }, { id: "b", tag: "p", text: "b" }] },
    { id: "s2", tag: "section", children: [] },
  ];
  assert.ok(moveNode(body, "a", "s2", "inside"));
  assert.deepEqual(findNode(body, "s2").children.map((n) => n.id), ["a"]);
  assert.ok(moveNode(body, "b", "a", "before"));
  assert.deepEqual(findNode(body, "s2").children.map((n) => n.id), ["b", "a"]);
  assert.equal(moveNode(body, "s2", "a", "inside"), false); // not into itself
  assert.equal(moveNode(body, "s1", "b", "inside"), false); // a paragraph holds no children
  assert.deepEqual(body.map((n) => n.id), ["s1", "s2"]);
});

test("export: a valid zip with every page and the stylesheet", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const s = blankSite();
  s.pages.push({ id: "p2", name: "Contact", slug: "contact", title: "Contact", description: "Reach us", body: [presetNode("contact", s)] });
  const files = exportSite(s);
  assert.deepEqual(files.map((f) => f.name), ["styles.css", "index.html", "contact.html"]);
  const contact = new TextDecoder().decode(files[2].data);
  assert.match(contact, /<link rel="stylesheet" href="styles\.css">/);
  assert.match(contact, /<meta name="description" content="Reach us">/);
  const zip = zipFiles(files);
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 3);
  // the central directory points back at each local header
  let cd = dv.getUint32(end + 16, true);
  for (const f of files) {
    assert.equal(dv.getUint32(cd, true), 0x02014b50);
    const off = dv.getUint32(cd + 42, true);
    assert.equal(dv.getUint32(off, true), 0x04034b50);
    assert.equal(dv.getUint32(off + 14, true), crc32(f.data));
    cd += 46 + dv.getUint16(cd + 28, true);
  }
});
