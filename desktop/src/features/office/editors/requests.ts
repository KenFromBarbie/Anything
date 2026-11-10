import { THROUGH_THE_OFFICE } from "@/features/office/lib/studioRequests";

import { APP, EXT, type EditorKind, FORMAT_SPEC } from "./formats";

/**
 * What the CEO is asked from an editor's "Ask the CEO" pane: make or change
 * the file in the editor's own format, so it comes back as something the
 * owner opens and keeps editing (a new version of the same thing).
 */
export function editorRequest(
  kind: EditorKind,
  title: string,
  ask: string,
  saved: { id: string; path?: string } | null,
  showCommand = "buzz-show",
): string {
  const app = APP[kind];
  const name = title.trim() || `Untitled ${app.noun}`;
  const where = saved?.path
    ? `It's open in the app's ${app.name} editor; the current version is ${saved.path} (read it first, and keep what wasn't asked to change).`
    : `It's a new ${app.noun} in the app's ${app.name} editor, empty so far.`;
  const publish = saved
    ? `Publish it with ${showCommand} --file "<your file>" --title "${name}" --version-of ${saved.id}, so it's the next version of the same thing.`
    : `Publish it with ${showCommand} --file "<your file>" --title "${name}".`;
  return [
    `[STUDIO from the owner] ${app.name} "${name}": ${ask.trim()}`,
    where,
    `Write the result in the editor's format so the owner can open it and keep editing: a file whose name ends in ${EXT[kind]}, holding ${FORMAT_SPEC[kind]}`,
    "Work in a folder of your own under the shared workspace.",
    THROUGH_THE_OFFICE,
    `${publish} When it's published you're done: no channel reply is needed.`,
  ].join("\n");
}
