import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import { openEditor } from "./editorStore";
import { EXT, type EditorKind, editorKindOf, parseFile } from "./formats";
import { toast } from "sonner";
import { blankImage } from "./imageFormat";
import { blankModel, type ModelFile } from "./modelFormat";
import { blankVideo } from "./videoFormat";

/** What each editor opens from the computer: its own files and the media it takes. */
const OPENS: Record<EditorKind, string[]> = {
  doc: [],
  slides: [],
  sheet: [],
  site: [],
  image: ["png", "jpg", "jpeg", "webp", "gif"],
  video: ["mp4", "webm", "mov", "m4v", "mp3", "wav", "ogg", "m4a"],
  model: ["glb", "gltf", "obj", "stl"],
};

/** Pick files from the computer and open each in its editor (from inside an
 *  editor: the files that editor takes). */
export async function importFromComputer(kind: EditorKind): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const extensions = ["json", ...OPENS[kind]];
  const picked = await open({
    multiple: true,
    filters: [{ name: `Files for this editor (${EXT[kind]}${OPENS[kind].length ? ", " + OPENS[kind].join(", ") : ""})`, extensions }],
  });
  const list = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
  for (const path of list) {
    try {
      await importIntoEditor(path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }
}

/** Files the editors open: their own files, and what each editor imports. */
export const IMPORT_FILTERS = [
  {
    name: "Anything the editors open",
    extensions: [
      "json",
      "glb", "gltf", "obj", "stl",
      "png", "jpg", "jpeg", "webp", "gif",
      "mp4", "webm", "mov", "m4v",
      "mp3", "wav", "ogg", "m4a",
    ],
  },
];

const MODEL = /\.(glb|gltf|obj|stl)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO = /\.(mp3|wav|ogg|m4a)$/i;

const baseName = (p: string) => p.split(String.fromCharCode(92)).join("/").split("/").pop() ?? p;
const stem = (p: string) => baseName(p).replace(/(\.(doc|slides|sheet|image|video|model|site))?\.[a-z0-9]+$/i, "");

/** Copy a picked file into the Office's media folder (the editors play from there). */
async function intoMedia(path: string): Promise<string> {
  const r = await invoke<{ path: string; name: string }>("office_media_import", { path });
  return r.path;
}

/** A local file's URL the webview may load (its folder is allowed first). */
async function loadable(path: string): Promise<string> {
  const r = await invoke<{ mtime: number }>("office_live_file", { path });
  return `${convertFileSrc(path)}?v=${r.mtime}`;
}

function mediaDuration(url: string, kind: "video" | "audio"): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 10);
    el.onerror = () => resolve(10);
    el.src = url;
  });
}

async function asDataUrl(url: string): Promise<{ data: string; w: number; h: number }> {
  const blob = await (await fetch(url)).blob();
  const data = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
  const size = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1920, h: 1080 });
    img.src = data;
  });
  return { data, ...size };
}

/**
 * Open a file from the computer in the editor it belongs to: an editor file
 * as itself, a 3D model in the 3D editor, a picture in the image editor, a
 * clip or a sound in the video editor. It opens unsaved: Save keeps it in Create.
 */
export async function importIntoEditor(path: string): Promise<void> {
  const title = stem(path);
  const kind = editorKindOf(path);
  if (kind) {
    const text = await invoke<string>("office_read_import", { path });
    openEditor({ kind, title, file: parseFile(kind, JSON.parse(text)) });
    return;
  }
  if (MODEL.test(path)) {
    const src = await intoMedia(path);
    const base = blankModel();
    const file: ModelFile = {
      ...base,
      objects: [
        { id: `imp-${Date.now().toString(36)}`, name: title, kind: "import", visible: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], src },
      ],
    };
    openEditor({ kind: "model", title, file });
    return;
  }
  if (IMAGE.test(path)) {
    const src = await intoMedia(path);
    const { data, w, h } = await asDataUrl(await loadable(src));
    const file = blankImage(w, h);
    file.layers.push({ id: `img-${Date.now().toString(36)}`, kind: "raster", name: title, visible: true, opacity: 1, blend: "normal", x: 0, y: 0, src: data, w, h });
    openEditor({ kind: "image", title, file });
    return;
  }
  if (VIDEO.test(path) || AUDIO.test(path)) {
    const media = VIDEO.test(path) ? "video" : "audio";
    const src = await intoMedia(path);
    const duration = await mediaDuration(await loadable(src), media);
    const file = blankVideo();
    const track = file.tracks.find((t) => t.kind === media) ?? file.tracks[0];
    file.media.push({ id: "m1", name: baseName(path), kind: media, src, duration });
    if (track) {
      file.clips.push({ id: "c1", track: track.id, type: "media", start: 0, dur: duration, in: 0, media: "m1" } as (typeof file.clips)[number]);
    }
    openEditor({ kind: "video", title, file });
    return;
  }
  throw new Error(`Create can't open ${baseName(path)} yet.`);
}
