import {
  APP,
  EXT,
  type EditorKind,
  FORMAT_SPEC,
} from "@/features/office/editors/formats";

const KINDS: EditorKind[] = ["doc", "slides", "sheet", "image", "video", "model", "site"];

/**
 * The app's editors, for the agents (written to <hive>/tools/EDITORS.md): what
 * each one is for and the exact file format, so deliverables are made in the
 * editors the owner opens and keeps editing, not as loose files or pictures.
 */
export function editorGuide(): string {
  const lines = [
    "# The app's editors: make deliverables in them",
    "",
    "The owner works in the app's own editors (Create page). Anything you make that one of them covers MUST be written in that editor's format, so the owner can open it, see it live while you work, and keep editing it:",
    "",
    ...KINDS.map((k) => `- ${APP[k].name}: a file ending in \`${EXT[k]}\``),
    "",
    "Rules:",
    "- Build the deliverable itself in the editor format. A PNG render, a script or a .glb on its own is NOT a deliverable.",
    "- Parts an editor can't make itself (a detailed mesh from simkit or Blender, a photo, a clip) go INTO the editor file as an import / media object, next to the editable parts.",
    "- Keep separate parts as separate objects, named, so the owner can select and change each one.",
    "- Show the finished file on the Create page with buzz-show (see BUZZ.md).",
    "",
  ];
  for (const k of KINDS) {
    lines.push(`## ${APP[k].name} (\`${EXT[k]}\`)`, "", FORMAT_SPEC[k], "");
  }
  return lines.join("\n");
}
