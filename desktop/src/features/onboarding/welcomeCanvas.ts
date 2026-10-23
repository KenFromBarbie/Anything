import { getCanvas, setCanvas } from "@/shared/api/tauri";

export const WELCOME_CANVAS_CONTENT = `# Welcome to Anything

This server runs an AI office for you. **Michael** runs it: you tell him what you need, he splits it up and hands each part to the right person, and he comes back with one answer. Under him sit your **permanent staff**, each owning one area of the work in an office of their own, and they hire **floor workers** whenever a job needs more hands.

## Start here

1. **Tell Michael what you're working on.** Mention @Michael in any channel or message him directly: the goal, who it's for, what done looks like, and any deadline.
2. **Hand over your material.** Attach files or paste links in your message; the agents read them before they start.
3. **Watch it happen in the Office.** Open the Office view to see who is at their desk, what each agent is doing, and to click a desk to manage the agent sitting there.
4. **Check the board.** Tasks shows every piece of work, who owns it and what is blocked on you.

## Things you can ask for

- "Michael, plan the first month of this project and give each of the staff their part."
- "Research our three closest competitors and summarise what they do better than us."
- "Draft replies to the questions in the attached file, and flag anything you're unsure of."
- "Set up a weekly report every Monday on what got done and what's next."
- "Hire someone to handle our bookkeeping and give them a desk."

## Meetings

Use **Meeting room** under Channels (or the button in the Office) to talk to your agents out loud. Pick who joins, ask questions, and hand tasks out; they take their seats at the table and go back to their desks when it's over.

## Good habits

- One request per message works best; say what done looks like.
- Keep decisions and results in the channel they belong to, so everyone works from the same context.
- When an agent asks you something, answer in the same thread so the work can carry on.
`;

type WelcomeCanvasClient = {
  getCanvas: typeof getCanvas;
  setCanvas: typeof setCanvas;
};

/** Seed the Welcome canvas without overwriting anything the user has written. */
export async function ensureWelcomeCanvas(
  channelId: string,
  client: WelcomeCanvasClient = { getCanvas, setCanvas },
) {
  const existing = await client.getCanvas(channelId);
  // Nullish (not `!== null`) so an absent field can never masquerade as an
  // existing canvas — that exact mismatch silently skipped seeding before.
  if (existing.updatedAt != null || existing.author != null) {
    return false;
  }

  await client.setCanvas({ channelId, content: WELCOME_CANVAS_CONTENT });
  return true;
}
