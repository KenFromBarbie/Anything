/**
 * The setup for a new server, from what it's for: the agents to hire (with
 * their roles), the channels and starter threads to create, files to hand
 * over, and the starting prompt for Michael. Drafted from the description,
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
  files: string[];
  prompt: string;
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

/** A first draft of the setup from the server's description. */
export function draftPlan(name: string, purpose: string): ServerPlan {
  const template = TEMPLATES.find((t) => t.match.test(purpose)) ?? FALLBACK;
  const plan: ServerPlan = {
    name,
    purpose,
    agents: template.agents.map((a) => ({ ...a })),
    channels: template.channels.map((c) => ({ ...c })),
    threads: template.threads.map((t) => ({ ...t })),
    files: [],
    prompt: "",
  };
  plan.prompt = startingPrompt(plan);
  return plan;
}

/** The kickoff for Michael: what the server is for and how it's set up. */
export function startingPrompt(plan: ServerPlan): string {
  const lines = [
    `This is a new server, "${plan.name}". What it's for:`,
    plan.purpose.trim() || "(not described yet: ask me)",
    "",
  ];
  if (plan.agents.length > 0) {
    lines.push("Your team (hired for you, one desk each):");
    for (const agent of plan.agents)
      lines.push(`- ${agent.name}: ${agent.role}`);
    lines.push("");
  }
  if (plan.channels.length > 0) {
    lines.push("Channels:");
    for (const channel of plan.channels) {
      lines.push(`- #${channelSlug(channel.name)}: ${channel.purpose}`);
    }
    lines.push("");
  }
  if (plan.files.length > 0) {
    lines.push("Files to start from (on this computer):");
    for (const file of plan.files) lines.push(`- ${file}`);
    lines.push("");
  }
  lines.push(
    "Start by reading the files, then break the work into first tasks on the board, assign them to the team by role, and post a short plan in the right channels. Ask me anything you need to decide.",
  );
  return lines.join("\n");
}
