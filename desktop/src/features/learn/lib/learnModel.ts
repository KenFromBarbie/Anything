/**
 * Learn, without the app around it: what a course's lessons are, how a
 * lesson's progress reports are read, and how progress adds up. A course is a
 * research project of kind "course"; its lessons are interactive artifacts the
 * Office publishes with `--course <id>`.
 */
import { groupVersions } from "../../office/lib/artifactVersions.ts";

/** What an interactive lesson posts to the app (`window.parent.postMessage`). */
export const LEARN_MESSAGE = "buzz-learn";

export type LessonProgress = {
  status: "started" | "done";
  /** Right answers so far, of `total`. */
  score: number | null;
  total: number | null;
  /** How many times it was finished. */
  attempts: number;
  /** What the lesson noticed (what the learner struggled with). */
  note: string | null;
  title: string;
  updatedAt: number;
};

export type CourseProgress = {
  lessons: Record<string, LessonProgress>;
  updatedAt: number;
  /** The learner's own notes for the course (a document, as HTML), kept in
   *  progress.json so the tutor reads them too. */
  notes?: { html: string; updatedAt: number };
};

export type LearnReport = {
  score: number | null;
  total: number | null;
  done: boolean;
  note: string | null;
};

type Lesson = {
  id: string;
  title: string;
  kind: string;
  createdAt: number;
  series?: string;
  course?: string;
};

export const EMPTY_PROGRESS: CourseProgress = { lessons: {}, updatedAt: 0 };

/** A course's name from what the owner wants to learn. */
export function proposeCourseName(goal: string): string {
  const first = goal.trim().split(/\n|[.?!](\s|$)/)[0] ?? "";
  const cleaned = first
    .replace(
      /^(please\s+)?(i\s+(want|need|would like)\s+to\s+|teach me\s+|help me\s+|can you teach me\s+)?(learn|understand|get better at|master|study)?\s*(about|how to)?\s*/i,
      "",
    )
    .replace(/[^\p{L}\p{N}\s&'+#.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").slice(0, 7).join(" ");
  if (!words) return "New course";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A lesson's report, or null when the message isn't one. */
export function readLearnMessage(data: unknown): LearnReport | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type !== LEARN_MESSAGE) return null;
  const count = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0
      ? Math.round(v)
      : null;
  const total = count(m.total);
  const score = count(m.score);
  return {
    score: score !== null && total !== null ? Math.min(score, total) : score,
    total,
    done: m.done === true,
    note:
      typeof m.note === "string" && m.note.trim()
        ? m.note.trim().slice(0, 500)
        : null,
  };
}

/** Progress with one lesson's report added. A finished lesson stays finished
 *  when it's opened again. */
export function addReport(
  progress: CourseProgress,
  lesson: { id: string; title: string },
  report: LearnReport,
  now: number,
): CourseProgress {
  const before = progress.lessons[lesson.id];
  const next: LessonProgress = {
    status: report.done || before?.status === "done" ? "done" : "started",
    score: report.score ?? before?.score ?? null,
    total: report.total ?? before?.total ?? null,
    attempts: (before?.attempts ?? 0) + (report.done ? 1 : 0),
    note: report.note ?? before?.note ?? null,
    title: lesson.title,
    updatedAt: now,
  };
  return {
    ...progress,
    lessons: { ...progress.lessons, [lesson.id]: next },
    updatedAt: now,
  };
}

/** A course's lessons in the order they were made, each at its latest
 *  version (progress is kept against the first version's id). */
export function courseLessons<T extends Lesson>(
  artifacts: T[],
  courseId: string,
): { lesson: T; key: string }[] {
  return groupVersions(artifacts.filter((a) => a.course === courseId))
    .sort((a, b) => a.versions[0].createdAt - b.versions[0].createdAt)
    .map((group) => ({ lesson: group.latest, key: group.versions[0].id }));
}

/** A lesson's parts, published separately but taught together: the
 *  interactive page plus, say, "Lesson 2: Pronunciation (slides)" made in the
 *  editors. Grouped by the title without its "(…)" suffix, in course order;
 *  the part that isn't an editor file leads (it reports progress). */
export function groupLessonParts<T extends Lesson & { path?: string }>(
  lessons: { lesson: T; key: string }[],
  isEditorFile: (path: string | undefined) => boolean,
): { key: string; title: string; parts: { lesson: T; key: string; label: string }[] }[] {
  const groups = new Map<string, { key: string; title: string; parts: { lesson: T; key: string; label: string }[] }>();
  for (const item of lessons) {
    const raw = (item.lesson.title || "").trim();
    const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(raw);
    const base = (m ? m[1] : raw) || item.key;
    const id = base.toLowerCase();
    const label = m ? m[2] : isEditorFile(item.lesson.path) ? "Editor" : "Lesson";
    const g = groups.get(id) ?? { key: item.key, title: base, parts: [] };
    g.parts.push({ ...item, label });
    groups.set(id, g);
  }
  for (const g of groups.values()) {
    g.parts.sort((a, b) => Number(isEditorFile(a.lesson.path)) - Number(isEditorFile(b.lesson.path)));
    g.key = g.parts[0].key;
  }
  return [...groups.values()];
}

/** How far through a course: lessons done of those made, and the average
 *  score of the finished ones that kept one. */
export function courseSummary(
  lessonKeys: string[],
  progress: CourseProgress,
): { done: number; total: number; average: number | null } {
  const done = lessonKeys.filter(
    (key) => progress.lessons[key]?.status === "done",
  );
  const scored = done
    .map((key) => progress.lessons[key])
    .filter((p) => p.total);
  const average = scored.length
    ? scored.reduce((sum, p) => sum + (p.score ?? 0) / (p.total ?? 1), 0) /
      scored.length
    : null;
  return { done: done.length, total: lessonKeys.length, average };
}
