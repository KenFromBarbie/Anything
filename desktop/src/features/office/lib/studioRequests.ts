// The Studio (Research → Artifacts): what an agent is asked when the owner
// wants something made, or changed. Agents make everything with their own
// tools — code — and publish it with buzz-show, so it lands in Artifacts.

export type MakeKind =
  | "document"
  | "slides"
  | "chart"
  | "image"
  | "video"
  | "model"
  | "site";

export const MAKE_KINDS: {
  kind: MakeKind;
  label: string;
  placeholder: string;
}[] = [
  {
    kind: "document",
    label: "Document",
    placeholder: "A one-page brief on our Q3 numbers, for the team",
  },
  {
    kind: "slides",
    label: "Slides",
    placeholder: "A 10-slide deck on digital funnels for my marketing class",
  },
  {
    kind: "chart",
    label: "Chart",
    placeholder: "A live BTC and ETH price chart with 1D–1Y ranges",
  },
  {
    kind: "image",
    label: "Image",
    placeholder: "A clean diagram of our customer journey, five stages",
  },
  {
    kind: "video",
    label: "Video",
    placeholder: "A 30-second explainer of the funnel, slides with captions",
  },
  {
    kind: "model",
    label: "3D model",
    placeholder: "A low-poly desk lamp, matte black, ready for a product shot",
  },
  {
    kind: "site",
    label: "Site",
    placeholder: "A landing page for the student portal, one page",
  },
];

/** How each kind is made with an agent's own tools, and what to publish. */
const HOW: Record<MakeKind, string> = {
  document:
    "Write it as Markdown, and also make a PDF of it (e.g. pandoc, or HTML printed to PDF). Publish the PDF, with the Markdown as a second artifact if useful.",
  slides:
    "Make a PPTX (python-pptx) with a clean, consistent design, and a PDF of the same deck. Publish the PPTX with the PDF as --preview so it can be viewed in the app.",
  chart:
    "Make it a self-contained HTML file (inline the data, or fetch public data in the page; a charting library from a CDN is fine). Publish the HTML file.",
  image:
    "Draw it in code: SVG, or a PNG rendered with Pillow, matplotlib or headless HTML. Publish a PNG (and the SVG if you made one).",
  video:
    "Build it in code: frames (Pillow/matplotlib/HTML) or slides turned into an MP4 with ffmpeg (or moviepy), with captions burnt in. Publish the MP4.",
  model:
    "Model it in code: Python with trimesh (or Blender in background mode, blender -b -P script.py, if it's installed), or three.js in Node with GLTFExporter. Give it real materials and colours. Export one binary .glb with everything inside it, centred at the origin, Y up, at a sensible scale and under about 20 MB. Publish the .glb; the app shows it in a 3D viewer.",
  site: 'Build it as a static site (HTML/CSS/JS) in a folder of its own, with an index.html. Publish the folder with --dir "<folder>" (the app serves it, so it keeps working); never publish a localhost --url, which dies when its server stops.',
};

/** Made to be seen in the app (the same rules as the agents' BUZZ.md). */
const FIT_THE_APP =
  "Design it for the app, where it's shown across a chat message (about 500 to 1200px wide) and full size in Artifacts: a fluid layout that fills the width (no fixed page width or outer margins), the app's light and dark themes (prefers-color-scheme), no scrolling inside it. For HTML, add the height snippet from BUZZ.md so it shows at its full height.";

/** Every piece of work runs down the office and is checked on the way back. */
export const THROUGH_THE_OFFICE =
  "Run it through the office: the CEO gives it to the executive who owns the area, they split it into tasks for floor workers, check each worker's result, and send the CEO one reviewed result; the CEO reviews that before it is published or answered. Publish only the reviewed result, once.";

const PUBLISH = (showCommand: string) =>
  `Publish what you made with ${showCommand} --file "<path>" --title "<what it is>" so the owner sees it in the app's Artifacts. When it's published you're done: no channel reply is needed.`;

/** A codebase the owner linked (Research → Artifacts → Codebases). */
export type Codebase = {
  id: string;
  name: string;
  source: "github" | "local";
  url?: string;
  path: string;
  addedAt: number;
  pulledAt?: number;
  exists?: boolean;
  git?: boolean;
  branch?: string | null;
  notesPath: string;
  hasNotes?: boolean;
};

/** Making something in a codebase's look, with its parts. */
function codebaseLines(codebase: Codebase | null | undefined): string[] {
  if (!codebase) return [];
  return [
    `Make it with the codebase "${codebase.name}" at ${codebase.path}: use its design system (colours, type, spacing, icons) and its components, so it looks like part of that product. ${codebase.hasNotes ? `Read the design notes on it first: ${codebase.notesPath}.` : "Read its theme, styles and components first."} Don't change the codebase itself unless asked; build in a folder of your own.`,
  ];
}

/** The owner asked for something new in the Studio. */
export function makeRequest(
  kind: MakeKind,
  brief: string,
  showCommand = "buzz-show",
  codebase?: Codebase | null,
): string {
  const label = MAKE_KINDS.find((k) => k.kind === kind)?.label ?? kind;
  return [
    `[STUDIO from the owner] Make a ${label.toLowerCase()}: ${brief.trim()}`,
    `How: ${HOW[kind]} Work in a folder of your own under the shared workspace.`,
    ...codebaseLines(codebase),
    FIT_THE_APP,
    THROUGH_THE_OFFICE,
    PUBLISH(showCommand),
  ].join("\n");
}

/** The owner asked for changes to something an agent made. */
export function changeRequest(
  artifact: { id: string; title: string; path?: string; url?: string },
  ask: string,
  showCommand = "buzz-show",
): string {
  const where = artifact.path ?? artifact.url ?? "";
  return [
    `[STUDIO CHANGE from the owner] Change "${artifact.title}" (artifact ${artifact.id}${where ? `, ${where}` : ""}): ${ask.trim()}`,
    "Work from your source for it (not the published copy) if you still have it, and keep what wasn't asked to change.",
    FIT_THE_APP,
    THROUGH_THE_OFFICE,
    `${PUBLISH(showCommand)} Publish it as a new version: the same title and --version-of ${artifact.id}.`,
  ].join("\n");
}

/** A Studio tile of the owner's own: a workflow (instructions an agent
 *  follows each time) or an app (built once; the tile then opens it). */
export type StudioWorkflow = {
  id: string;
  kind: "workflow" | "app";
  name: string;
  instructions: string;
  icon: string;
  tone: string;
  createdAt: number;
};

/** The owner ran one of their workflows. */
export function workflowRequest(
  workflow: StudioWorkflow,
  input: string,
  showCommand = "buzz-show",
  codebase?: Codebase | null,
): string {
  return [
    `[STUDIO WORKFLOW from the owner] Run the workflow "${workflow.name}".`,
    `The workflow: ${workflow.instructions.trim()}`,
    ...(input.trim() ? [`This time: ${input.trim()}`] : []),
    ...codebaseLines(codebase),
    "Work in a folder of your own under the shared workspace.",
    FIT_THE_APP,
    THROUGH_THE_OFFICE,
    `${PUBLISH(showCommand)} If it makes nothing to show, post a short summary with buzz-post instead.`,
  ].join("\n");
}

/** The owner wants one of their apps built (or built again). */
export function appRequest(
  workflow: StudioWorkflow,
  showCommand = "buzz-show",
  codebase?: Codebase | null,
): string {
  return [
    `[STUDIO APP from the owner] Build the app "${workflow.name}": ${workflow.instructions.trim()}`,
    "Make it a working single-page web app (HTML/CSS/JS in a folder of its own, with an index.html; libraries from a CDN are fine). It runs inside the app, sandboxed: keep its data in the page (localStorage), no server of its own.",
    ...codebaseLines(codebase),
    FIT_THE_APP,
    THROUGH_THE_OFFICE,
    `Publish the folder with ${showCommand} --dir "<folder>" --title "${workflow.name}" (exactly that title: the owner's tile opens the newest artifact with it). When it's published you're done: no channel reply is needed.`,
  ].join("\n");
}

/** The owner asked an agent to work in a codebase. */
export function codebaseRequest(codebase: Codebase, ask: string): string {
  return [
    `[CODEBASE from the owner] In the codebase "${codebase.name}" at ${codebase.path}: ${ask.trim()}`,
    codebase.git
      ? "Work on a new git branch (anything/<short-name>) and commit there; don't push or merge unless the owner asks."
      : "It isn't a git checkout: keep a copy of anything you change.",
    THROUGH_THE_OFFICE,
    "When you're done, post a short summary of what you changed (and the branch) with buzz-post, and publish anything to look at with buzz-show.",
  ].join("\n");
}

/** The owner asked an agent to learn a codebase's look and parts. */
export function codebaseLearnRequest(codebase: Codebase): string {
  return [
    `[CODEBASE from the owner] Learn the design of the codebase "${codebase.name}" at ${codebase.path}, so you and the other agents can make things that look like part of it.`,
    `Write what you find to ${codebase.notesPath} (Markdown): its colours and theme tokens, type, spacing and radii, icons, the main components (name, where each lives, what it's for, how it's used), page layouts, and the rules to follow to make something new that fits.`,
    "Don't change the codebase. When the notes are written, you're done: no reply is needed.",
  ].join("\n");
}
