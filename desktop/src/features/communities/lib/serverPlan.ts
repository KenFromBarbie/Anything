/**
 * The setup for a new server, from what it's for: the permanent staff to
 * hire (each owns one area and lives in its own office), the channels and
 * starter threads to create, the files and links handed over, and the
 * starting prompt for Michael. Drafted by Claude from the description and
 * attachments (`server_plan`), or from a template when that isn't possible,
 * then edited by the owner before the server is made (see serverSetup).
 */

export type PlanAgent = { name: string; role: string };
export type PlanChannel = { name: string; purpose: string };
export type PlanThread = { channel: string; title: string };

export type ServerPlan = {
  name: string;
  purpose: string;
  agents: PlanAgent[];
  channels: PlanChannel[];
  threads: PlanThread[];
  /** Files handed to the agents (copied into the work folder's inputs/). */
  files: string[];
  links: string[];
  /** Where the agents work; set when the server is created. */
  workFolder?: string;
  /** Claude's summary of the mission and first goals, for Michael. */
  brief: string;
  prompt: string;
};

/** What `server_plan` returns: Claude's draft. */
export type DraftFromClaude = {
  staff?: Array<{ name?: unknown; role?: unknown }>;
  channels?: Array<{ name?: unknown; purpose?: unknown }>;
  threads?: Array<{ channel?: unknown; title?: unknown }>;
  brief?: unknown;
};

type Template = {
  match: RegExp;
  agents: PlanAgent[];
  channels: PlanChannel[];
  threads: PlanThread[];
};

const TEMPLATES: Template[] = [
  {
    match:
      /\b(app|software|code|coding|website|web ?site|api|product|engineer|develop|build|bug|feature|saas)\b/i,
    agents: [
      {
        name: "Pam",
        role: "Product lead: turns goals into small, testable tasks",
      },
      { name: "Jim", role: "Engineer: builds features and fixes bugs" },
      {
        name: "Dwight",
        role: "Reviewer and tester: checks every change before it lands",
      },
    ],
    channels: [
      { name: "planning", purpose: "Goals, priorities and the roadmap" },
      { name: "dev", purpose: "Building: progress, questions, code review" },
      { name: "bugs", purpose: "Problems found and their fixes" },
      { name: "releases", purpose: "What shipped and when" },
    ],
    threads: [
      { channel: "planning", title: "Roadmap: what we build first" },
      { channel: "dev", title: "Tech stack and setup decisions" },
    ],
  },
  {
    match:
      /\b(research|study|analy[sz]e|analysis|investigat|report|market|competitor|survey|paper|thesis)\b/i,
    agents: [
      { name: "Jim", role: "Researcher: finds and reads the sources" },
      {
        name: "Oscar",
        role: "Analyst: checks the numbers and draws conclusions",
      },
      { name: "Pam", role: "Writer: turns findings into clear reports" },
    ],
    channels: [
      {
        name: "sources",
        purpose: "Links, papers and data found along the way",
      },
      { name: "findings", purpose: "What we learned, with evidence" },
      { name: "reports", purpose: "Drafts and finished reports" },
    ],
    threads: [
      { channel: "findings", title: "Key questions we need to answer" },
      { channel: "reports", title: "Report outline" },
    ],
  },
  {
    match:
      /\b(content|marketing|social|brand|campaign|video|youtube|tiktok|instagram|blog|newsletter|seo|ads?)\b/i,
    agents: [
      {
        name: "Kelly",
        role: "Strategist: plans campaigns and the content calendar",
      },
      { name: "Pam", role: "Creator: writes and designs the content" },
      { name: "Ryan", role: "Growth: tracks what works and suggests changes" },
    ],
    channels: [
      { name: "ideas", purpose: "Content ideas and hooks" },
      { name: "drafts", purpose: "Work in progress for review" },
      { name: "calendar", purpose: "What goes out, where and when" },
      { name: "results", purpose: "Numbers and lessons from each post" },
    ],
    threads: [
      { channel: "ideas", title: "This month's themes" },
      { channel: "calendar", title: "Publishing schedule" },
    ],
  },
  {
    match:
      /\b(sales|leads?|clients?|customers?|crm|outreach|prospect|deals?|pipeline)\b/i,
    agents: [
      { name: "Andy", role: "Prospector: finds and qualifies leads" },
      { name: "Phyllis", role: "Account lead: writes outreach and follows up" },
      { name: "Oscar", role: "Ops: keeps the pipeline and numbers tidy" },
    ],
    channels: [
      { name: "leads", purpose: "New leads and their fit" },
      { name: "outreach", purpose: "Messages, replies and follow-ups" },
      { name: "deals", purpose: "Active deals and next steps" },
    ],
    threads: [{ channel: "leads", title: "Who our ideal customer is" }],
  },
  {
    match:
      /\b(business|company|startup|launch|plan|finance|budget|legal|operations?|ops|cafe|shop|store|restaurant)\b/i,
    agents: [
      { name: "Jim", role: "Researcher: market, competitors and regulations" },
      { name: "Oscar", role: "Finance: budget, costs and the financial model" },
      { name: "Pam", role: "Operations: suppliers, processes and checklists" },
    ],
    channels: [
      { name: "planning", purpose: "The plan, milestones and decisions" },
      { name: "research", purpose: "Market, location and competitor findings" },
      { name: "finance", purpose: "Budget, costs and funding" },
      {
        name: "operations",
        purpose: "Suppliers, permits and day-to-day setup",
      },
    ],
    threads: [
      { channel: "planning", title: "Milestones to opening" },
      { channel: "finance", title: "Start-up budget" },
    ],
  },
];

const FALLBACK: Omit<Template, "match"> = {
  agents: [
    { name: "Jim", role: "Generalist: researches and does the work" },
    {
      name: "Pam",
      role: "Coordinator: keeps tasks, notes and updates in order",
    },
  ],
  channels: [
    { name: "planning", purpose: "Goals, tasks and decisions" },
    { name: "updates", purpose: "Progress from the agents" },
  ],
  threads: [{ channel: "planning", title: "What we're working towards" }],
};

/** Channel names as the relay wants them: lower case, words joined by -. */
export function channelSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** A first draft of the setup from the server's description (a template,
 *  used when Claude can't draft one). */
export function draftPlan(
  name: string,
  purpose: string,
  files: string[] = [],
  links: string[] = [],
): ServerPlan {
  const template = TEMPLATES.find((t) => t.match.test(purpose)) ?? FALLBACK;
  const plan: ServerPlan = {
    name,
    purpose,
    agents: template.agents.map((a) => ({ ...a })),
    channels: template.channels.map((c) => ({ ...c })),
    threads: template.threads.map((t) => ({ ...t })),
    files,
    links,
    brief: "",
    prompt: "",
  };
  plan.prompt = startingPrompt(plan);
  return plan;
}

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** The setup from Claude's draft; anything missing or empty falls back to
 *  the template, so the owner always gets a complete setup to edit. */
export function planFromDraft(
  name: string,
  purpose: string,
  draft: DraftFromClaude,
  files: string[] = [],
  links: string[] = [],
): ServerPlan {
  const fallback = draftPlan(name, purpose, files, links);
  const seen = new Set<string>(["michael"]);
  const agents = (draft.staff ?? [])
    .map((a) => ({ name: str(a.name, 40), role: str(a.role, 200) }))
    .filter((a) => {
      const key = a.name.toLowerCase();
      if (!a.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, STAFF_SEATS);
  const channels = (draft.channels ?? [])
    .map((c) => ({
      name: channelSlug(str(c.name, 60)),
      purpose: str(c.purpose, 200),
    }))
    .filter((c) => c.name)
    .slice(0, 10);
  const names = new Set(channels.map((c) => c.name));
  const threads = (draft.threads ?? [])
    .map((t) => ({
      channel: channelSlug(str(t.channel, 60)),
      title: str(t.title, 200),
    }))
    .filter((t) => t.title && names.has(t.channel))
    .slice(0, 6);
  const plan: ServerPlan = {
    ...fallback,
    agents: agents.length ? agents : fallback.agents,
    channels: channels.length ? channels : fallback.channels,
    threads: channels.length ? threads : fallback.threads,
    brief: str(draft.brief, 2000),
  };
  plan.prompt = startingPrompt(plan);
  return plan;
}

/** Permanent staff each have an office of their own; there are this many. */
export const STAFF_SEATS = 4;

const fileName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** " (a.pdf, b.docx, https://…)": the first few things to read, or nothing. */
function materialList(plan: ServerPlan): string {
  const items = [...plan.files.map(fileName), ...plan.links];
  if (items.length === 0) return "";
  const shown = items.slice(0, 4).join(", ");
  return ` (${shown}${items.length > 4 ? ", ..." : ""})`;
}

/** The kickoff for Michael: the work, his staff and how work flows through
 *  them, the channels, the material, and his first steps. */
export function startingPrompt(plan: ServerPlan): string {
  const lines = [
    `You are running "${plan.name}", a new server, from today.`,
    "",
    "THE WORK",
    plan.purpose.trim() || "(not described yet: ask me what it is first)",
  ];
  if (plan.brief.trim()) lines.push("", plan.brief.trim());
  lines.push("");
  if (plan.agents.length > 0) {
    lines.push(
      "YOUR STAFF (permanent: each has an office of their own and owns one area)",
    );
    for (const agent of plan.agents)
      lines.push(`- ${agent.name}: ${agent.role || "(role to agree)"}`);
    lines.push("");
  }
  lines.push(
    "HOW WORK FLOWS",
    "1. You plan and delegate; you don't do the work yourself. Split every request from me by area and send each part to the staff member who owns it, as a contract: objective, expected output, references and tools, boundaries and the definition of done.",
    "2. Your staff break their part into tasks and hire floor workers to do them, check the results, and report back to you. Work that fits no one's area: give it to the closest fit, or ask me whether it needs a new permanent role.",
    "3. Keep the task board true: every card has an owner, and you are the one who signs work off.",
    "4. Answer me with one combined result, not a relay of everyone's messages. Anything only I can decide or do, ask me in the thread it came from.",
    "",
  );
  if (plan.channels.length > 0) {
    lines.push("CHANNELS (post each update where it belongs)");
    for (const channel of plan.channels) {
      lines.push(`- #${channelSlug(channel.name)}: ${channel.purpose}`);
    }
    lines.push("");
  }
  if (plan.workFolder || plan.files.length > 0 || plan.links.length > 0) {
    lines.push("MATERIAL");
    if (plan.workFolder) lines.push(`- Work folder: ${plan.workFolder}`);
    for (const file of plan.files) lines.push(`- File: ${file}`);
    for (const link of plan.links) lines.push(`- Link: ${link}`);
    lines.push("");
  }
  const first = plan.channels[0]
    ? `#${channelSlug(plan.channels[0].name)}`
    : "a channel";
  lines.push(
    "FIRST STEPS",
    `1. Read the material${materialList(plan)}.`,
    "2. Write the plan on the board: the goals, the first milestones, and each staff member's first tasks.",
    "3. Brief each staff member on their area and their first tasks, and get them started.",
    `4. Post the plan in ${first}, then tell me what you need from me.`,
  );
  return lines.join("\n");
}
