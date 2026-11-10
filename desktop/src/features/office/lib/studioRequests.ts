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
  | "clothing"
  | "simulation"
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
    kind: "clothing",
    label: "Clothing",
    placeholder: "A boxy linen shirt for a 175 cm man, chest 100, in two sizes",
  },
  {
    kind: "simulation",
    label: "Simulation",
    placeholder: "Will the boat bike stay upright in 30 cm waves with an 85 kg rider?",
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
    "Model it in code with the office's simkit (mesh primitives and loft, glb.Scene; see the 3D section of BUZZ.md), or Blender in background mode (blender -b -P script.py) if it's installed, or three.js in Node with GLTFExporter. Real proportions in metres, real materials and colours; if it has moving parts, animate them (glb.Scene.animate). Export one binary .glb, centred at the origin, Y up, under about 20 MB. Publish the .glb; the app shows it in a 3D viewer and plays its animation.",
  clothing:
    "Use the office's simkit cloth module (its README is linked from BUZZ.md, start from examples/garment.py): a Body from the measurements given (or a standard size, and say which), the garment's pattern pieces with ease and seam allowance, a printable 1:1 SVG pattern, and a drape of it on the body in the chosen fabric. Publish the SVG pattern, the animated fit .glb (red tight, blue loose) and an HTML report with the measurements, the fit of each size or fabric tried, and what you'd change.",
  simulation:
    "Use the office's simkit (README linked from BUZZ.md; start from examples/boat.py for anything on water, examples/aircraft.py for anything that flies or meets wind). Build the thing as a closed mesh at real scale with a realistic mass and centre of gravity, run the simulation, check one number against a hand calculation, and try the cases that matter (heavier load, bigger waves, other speeds). Publish an animated .glb of it (on the water, or coloured by lift) and an HTML report (simkit.report): the answer to the question first, then the numbers, charts, the assumptions and what would make it better.",
  site: 'Build it as a static site (HTML/CSS/JS) in a folder of its own, with an index.html. Publish the folder with --dir "<folder>" (the app serves it, so it keeps working); never publish a localhost --url, which dies when its server stops.',
};

/** Made to be seen in the app (the same rules as the agents' BUZZ.md). */
const FIT_THE_APP =
  "Design it for the app, where it's shown across a chat message (about 500 to 1200px wide) and full size on the Create page: a fluid layout that fills the width (no fixed page width or outer margins), the app's light and dark themes (prefers-color-scheme), no scrolling inside it. For HTML, add the height snippet from BUZZ.md so it shows at its full height.";

/** Every piece of work runs down the office and is checked on the way back. */
export const THROUGH_THE_OFFICE =
  "Run it through the office: the CEO gives it to the executive who owns the area, they split it into tasks for floor workers, check each worker's result, and send the CEO one reviewed result; the CEO reviews that before it is published or answered. Publish only the reviewed result, once.";

const PUBLISH = (showCommand: string) =>
  `Publish what you made with ${showCommand} --file "<path>" --title "<what it is>" so the owner sees it on the app's Create page. When it's published you're done: no channel reply is needed.`;

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
  /** The Office's notebook on it (agents read it first, add what they learn). */
  memoryPath?: string;
  /** graphify's code map of it (graph.json), and whether it's built. */
  graphPath?: string;
  hasGraph?: boolean;
  /** An executive leads it for the Office. */
  managed?: boolean;
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

/** How agents work in a linked codebase: its memory, its code map, GitHub. */
export function codebaseWorkspaceLines(codebase: Codebase): string[] {
  const lines: string[] = [];
  if (codebase.memoryPath) {
    lines.push(
      `The Office's memory of it is ${codebase.memoryPath}: read it before you start, and when you finish add what the next agent should know (how to build and test, conventions, decisions, gotchas). Correct what's wrong rather than piling on.`,
    );
  }
  if (codebase.hasNotes) {
    lines.push(`Its design notes: ${codebase.notesPath}.`);
  }
  lines.push(
    codebase.hasGraph && codebase.graphPath
      ? `Find your way with its code map before reading files: graphify query "<question>" --graph "${codebase.graphPath}" (also graphify explain "<thing>" and graphify path "<a>" "<b>" with the same --graph). After big changes, bring the map up to date with graphify update "${codebase.path}".`
      : `It has no code map yet; for anything beyond a small change, make one first with graphify update "${codebase.path}" and use graphify query "<question>" --graph "${codebase.path}/graphify-out/graph.json".`,
  );
  if (codebase.source === "github" || codebase.url) {
    lines.push(
      "It's on GitHub: read issues and pull requests with gh (gh issue view N, gh pr view N, gh pr diff N, gh pr checks N). Don't push, comment, review on GitHub or open pull requests unless this request says to.",
    );
  }
  return lines;
}

function branchLine(codebase: Codebase): string {
  return codebase.git
    ? "Work on a new git branch (anything/<short-name>) and commit there; don't push or merge unless the owner asks."
    : "It isn't a git checkout: keep a copy of anything you change.";
}

const DRAFT_PR =
  "When it's done and the tests pass, push the branch and open a draft pull request with gh pr create --draft, describing what changed and how it was tested.";

const CODEBASE_DONE =
  "When you're done, post a short summary of what you changed (and the branch) with buzz-post, and publish anything to look at with buzz-show.";

/** The owner asked an agent to work in a codebase. */
export function codebaseRequest(
  codebase: Codebase,
  ask: string,
  options: { draftPr?: boolean } = {},
): string {
  return [
    `[CODEBASE from the owner] In the codebase "${codebase.name}" at ${codebase.path}: ${ask.trim()}`,
    branchLine(codebase),
    ...codebaseWorkspaceLines(codebase),
    ...(options.draftPr && codebase.git ? [DRAFT_PR] : []),
    THROUGH_THE_OFFICE,
    CODEBASE_DONE,
  ].join("\n");
}

/** The owner wants a GitHub issue fixed. */
export function codebaseIssueRequest(
  codebase: Codebase,
  issue: { number: number; title: string },
  options: { draftPr?: boolean } = {},
): string {
  return [
    `[CODEBASE from the owner] In the codebase "${codebase.name}" at ${codebase.path}: fix GitHub issue #${issue.number}, "${issue.title}". Read it in full first (gh issue view ${issue.number} --comments).`,
    `${branchLine(codebase)} Name the branch anything/issue-${issue.number}.`,
    ...codebaseWorkspaceLines(codebase),
    "Add or update a test that fails without the fix, and run the project's tests.",
    ...(options.draftPr && codebase.git ? [`${DRAFT_PR} Put "Fixes #${issue.number}" in its description.`] : []),
    THROUGH_THE_OFFICE,
    CODEBASE_DONE,
  ].join("\n");
}

/** The owner wants a pull request reviewed (the review comes back to them). */
export function codebasePrReviewRequest(
  codebase: Codebase,
  pr: { number: number; title: string },
): string {
  return [
    `[CODEBASE from the owner] Review pull request #${pr.number}, "${pr.title}", in the codebase "${codebase.name}" at ${codebase.path}.`,
    `Read it with gh pr view ${pr.number} --comments and gh pr diff ${pr.number}, and its checks with gh pr checks ${pr.number}. Look for bugs, missing tests, and changes that don't fit how the codebase does things.`,
    ...codebaseWorkspaceLines(codebase),
    "Don't post the review on GitHub and don't change the branch: send the owner the review (a verdict, then the findings worst first, each with file:line) with buzz-post.",
    THROUGH_THE_OFFICE,
  ].join("\n");
}

/** The owner wants the open issues sorted out. */
export function codebaseTriageRequest(codebase: Codebase): string {
  return [
    `[CODEBASE from the owner] Triage the open GitHub issues of the codebase "${codebase.name}" at ${codebase.path} (gh issue list --state open --limit 100).`,
    ...codebaseWorkspaceLines(codebase),
    "For each issue: is it still real (check the code), how big is it, how much does it matter, and which part of the code it touches. Don't label, comment on or close anything on GitHub.",
    "Send the owner one ranked list with buzz-post: what to fix first and why, what's a duplicate or already fixed, and what needs their decision.",
    THROUGH_THE_OFFICE,
  ].join("\n");
}

/** The owner handed a codebase to the Office to look after. */
export function codebaseLeadRequest(codebase: Codebase): string {
  return [
    `[CODEBASE from the owner] The Office now looks after the codebase "${codebase.name}" at ${codebase.path}. Make one executive its lead, and tell the owner who with buzz-post.`,
    "The lead: learns it (build, test, layout) and writes that into its memory; makes or refreshes its code map; and from now on, whenever the owner sends work on it, owns that work, splits it for floor workers, reviews their branches and keeps the memory current.",
    ...codebaseWorkspaceLines(codebase),
    "Start with a short health report for the owner (buzz-post): does it build, do the tests pass, open issues and pull requests worth attention, and the three things you'd do first. Change nothing yet.",
    THROUGH_THE_OFFICE,
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
