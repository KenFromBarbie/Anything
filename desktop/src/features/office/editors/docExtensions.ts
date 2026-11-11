import { Extension, Mark, mergeAttributes, Node } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

// ─── the few formatting extensions StarterKit doesn't have ─────────────────

/** text-align on paragraphs and headings. */
const TextAlign = Extension.create({
  name: "textAlign",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).style.textAlign || null,
            renderHTML: (a) => (a.textAlign ? { style: `text-align:${a.textAlign}` } : {}),
          },
        },
      },
    ];
  },
});

/** Colour, highlight, size and font on a run of text (a styled span). */
const TextStyle = Mark.create({
  name: "textStyle",
  addAttributes() {
    const css = (prop: string, key: string) => ({
      default: null,
      parseHTML: (el: HTMLElement) => el.style.getPropertyValue(prop) || null,
      renderHTML: (a: Record<string, string | null>) => (a[key] ? { style: `${prop}:${a[key]}` } : {}),
    });
    return {
      color: css("color", "color"),
      background: css("background-color", "background"),
      fontSize: css("font-size", "fontSize"),
      fontFamily: css("font-family", "fontFamily"),
    };
  },
  parseHTML() {
    return [{ tag: "span[style]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

const Image = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, alt: { default: null } };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes, { style: "max-width:100%" })];
  },
});

/** Everything the document editor (and its read-only preview) understands.
 *  Parsing through this schema is also what keeps an agent's HTML safe:
 *  anything it doesn't know (scripts, event handlers) is dropped. */
export function docExtensions() {
  return [
    StarterKit.configure({ link: { openOnClick: false } }),
    TextAlign,
    TextStyle,
    Image,
    TableKit.configure({ table: { resizable: true } }),
  ];
}
