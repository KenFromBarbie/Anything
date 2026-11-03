import { useQuery } from "@tanstack/react-query";

import {
  michaelPubkey,
  type ResearchProject,
  researchApi,
  saveAttachment,
} from "@/features/research/lib/research";
import {
  addChannelMembers,
  createChannel,
  invokeTauri,
  sendChannelMessage,
} from "@/shared/api/tauri";

import {
  type CourseProgress,
  EMPTY_PROGRESS,
  type LessonProgress,
} from "./learnModel";

/** A Learn course: a research project of kind "course", with its folder (the
 *  material) and the chat where the Office teaches it. */
export type Course = ResearchProject;

export const isCourse = (project: ResearchProject) => project.kind === "course";

export const progressKey = (id: string) => ["learn", "progress", id] as const;

export const learnApi = {
  progress: async (id: string) =>
    (await invokeTauri<CourseProgress | null>("learn_progress_read", { id })) ??
    EMPTY_PROGRESS,
  saveProgress: (id: string, progress: CourseProgress) =>
    invokeTauri<void>("learn_progress_write", { id, progress }),
};

export function useCourseProgress(id: string | null) {
  return useQuery({
    queryKey: progressKey(id ?? ""),
    queryFn: () => learnApi.progress(id ?? ""),
    enabled: !!id,
  });
}

function channelName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `learn-${slug || "course"}`;
}

/** The owner's words, and what the Office needs to find the course. How to
 *  run a course (the chain, the lessons, how progress is reported) is in the
 *  agents' own guide, not in the chat. */
function courseBrief(course: Course, goal: string, attached: string[]): string {
  return [
    `New course: **${course.name}**`,
    "",
    goal.trim(),
    "",
    ...(attached.length > 0
      ? ["My material:", ...attached.map((path) => `- \`${path}\``), ""]
      : []),
    `_Course \`${course.id}\` · folder \`${course.path}\`_`,
  ].join("\n");
}

export type StartedCourse = {
  course: Course;
  channelId: string;
  michaelAdded: boolean;
};

/** Start a course: its folder with the material, a private channel with
 *  Michael, and the brief that has the Office plan and teach it. */
export async function startCourse(
  name: string,
  goal: string,
  files: File[] = [],
): Promise<StartedCourse> {
  const created = await researchApi.create(name, goal.trim(), "course");
  const attached: string[] = [];
  for (const file of files)
    attached.push(await saveAttachment(created.id, file));
  const channel = await createChannel({
    name: channelName(created.name),
    channelType: "stream",
    visibility: "private",
    description: `Learn: ${created.name}`,
  });
  const course = await researchApi.update(created.id, {
    channelId: channel.id,
  });
  const michael = await michaelPubkey().catch(() => null);
  if (michael) {
    await addChannelMembers({ channelId: channel.id, pubkeys: [michael] });
  }
  await sendChannelMessage(
    channel.id,
    courseBrief(course, goal, attached),
    null,
    undefined,
    michael ? [michael] : undefined,
  );
  return { course, channelId: channel.id, michaelAdded: !!michael };
}

/** Tell the course's chat (and Michael) something about the course. */
async function tellCourse(course: Course, text: string): Promise<void> {
  if (!course.channelId) throw new Error("This course has no chat.");
  const michael = await michaelPubkey().catch(() => null);
  await sendChannelMessage(
    course.channelId,
    text,
    null,
    undefined,
    michael ? [michael] : undefined,
  );
}

/** A finished lesson, for the Office to plan the next one around. */
export function reportLesson(
  course: Course,
  lessonId: string,
  entry: LessonProgress,
): Promise<void> {
  const score =
    entry.total !== null
      ? ` ${entry.score ?? 0}/${entry.total} (${Math.round(((entry.score ?? 0) / Math.max(1, entry.total)) * 100)}%)`
      : "";
  return tellCourse(
    course,
    [
      `Finished **${entry.title}**${score}${entry.attempts > 1 ? `, attempt ${entry.attempts}` : ""}.`,
      entry.note ? `What I found hard: ${entry.note}` : null,
      `Lesson artifact \`${lessonId}\`. Plan the next lesson around this (progress.json has the rest).`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/** Ask for the next lesson (or a first one, when none came yet). */
export function askForLesson(course: Course, request: string): Promise<void> {
  return tellCourse(
    course,
    request.trim() ||
      `I'm ready for the next lesson in **${course.name}**. Publish it with --course ${course.id}.`,
  );
}
