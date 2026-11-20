import { invoke } from "@tauri-apps/api/core";

import modelEvalPy from "@/features/office/tools/model_eval.py?raw";
import modelevalPy from "@/features/office/tools/modeleval.py?raw";

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
  lines.push(
    "## Checking a 3D model: use the shared evaluator (modeleval)",
    "",
    "Never load a whole .model.json assembly in your own script: each copy costs about 2 GB, and several builders doing it at once run the machine out of memory. Use the Office's shared evaluation service next to this file (it keeps the evaluated model in one process and reloads only what changed):",
    "",
    "- `python <tools>/modeleval.py eval <file.model.json>`: parts, triangles, watertight, volume, bounds, mass.",
    "- `python <tools>/modeleval.py glb <file.model.json> <out.glb>`: export the evaluated model.",
    "- `python <tools>/modeleval.py run <your_check.py> [args]`: run your float / clearance / render script INSIDE the service. In it, `import model_eval` (or `import havik_eval`) and `model_eval.evaluate(path)` return the cached model; change the copy you get freely.",
    "",
    "It starts on first use and stops itself when idle; checks queue and run one at a time. `model_eval.py` (same folder) is the evaluator itself: the same reading of the format as the app's 3D editor.",
    "",
  );
  return lines.join("\n");
}

/** Write the guide where every agent of the active Office reads its tools
 *  (<hive>/tools/EDITORS.md; the hive is the notes vault's folder). */
export async function writeEditorGuide(): Promise<void> {
  const vault = await invoke<{ path?: string }>("office_vault");
  if (!vault.path) return;
  const sep = vault.path.includes(String.fromCharCode(92)) ? String.fromCharCode(92) : "/";
  const hive = vault.path.slice(0, vault.path.lastIndexOf(sep));
  await invoke("office_export_file", { path: `${hive}${sep}tools${sep}EDITORS.md`, text: editorGuide() });
  // The shared 3D evaluation service (see the guide's last section).
  await invoke("office_install_tool", { name: "model_eval.py", text: modelEvalPy });
  await invoke("office_install_tool", { name: "modeleval.py", text: modelevalPy });
}
