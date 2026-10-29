// The Studio (Research → Artifacts): what an agent is asked when the owner
// wants something made, or changed. Agents make everything with their own
// tools — code — and publish it with buzz-show, so it lands in Artifacts.

export type MakeKind =
  | "document"
  | "slides"
  | "chart"
  | "image"
  | "video"
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
  site: "Build it as a static site (HTML/CSS/JS) in a folder of its own. Publish its index.html as a file, and if you serve it locally also with --url.",
};

/** Made to be seen in the app (the same rules as the agents' BUZZ.md). */
const FIT_THE_APP =
  "Design it for the app, where it's shown across a chat message (about 500 to 1200px wide) and full size in Artifacts: a fluid layout that fills the width (no fixed page width or outer margins), the app's light and dark themes (prefers-color-scheme), no scrolling inside it. For HTML, add the height snippet from BUZZ.md so it shows at its full height.";

const PUBLISH = (showCommand: string) =>
  `Publish what you made with ${showCommand} --file "<path>" --title "<what it is>" so the owner sees it in the app's Artifacts. When it's published you're done: no channel reply is needed.`;

/** The owner asked for something new in the Studio. */
export function makeRequest(
  kind: MakeKind,
  brief: string,
  showCommand = "buzz-show",
): string {
  const label = MAKE_KINDS.find((k) => k.kind === kind)?.label ?? kind;
  return [
    `[STUDIO from the owner] Make a ${label.toLowerCase()}: ${brief.trim()}`,
    `How: ${HOW[kind]} Work in a folder of your own under the shared workspace.`,
    FIT_THE_APP,
    "Do it yourself or hand it to the agent best placed for it (pass these instructions on).",
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
    `${PUBLISH(showCommand)} Publish it as a new version with the same title.`,
  ].join("\n");
}
