import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  BookOpen,
  CircleCheck,
  CircleDot,
  Circle,
  FolderOpen,
  GraduationCap,
  Loader2,
  MessageSquare,
  NotebookPen,
  Presentation,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  askForLesson,
  type Course,
  isCourse,
  learnApi,
  progressKey,
  reportLesson,
  startCourse,
  useCourseProgress,
} from "@/features/learn/lib/learn";
import {
  addReport,
  type CourseProgress,
  courseLessons,
  courseSummary,
  EMPTY_PROGRESS,
  type LessonProgress,
  proposeCourseName,
  readLearnMessage,
} from "@/features/learn/lib/learnModel";
import {
  type Artifact,
  useArtifacts,
} from "@/features/office/ui/ArtifactsPage";
import {
  RESEARCH_KEY,
  researchApi,
  sortProjects,
  useResearch,
} from "@/features/research/lib/research";
import {
  AttachButton,
  AttachmentChips,
  dropOutline,
  useAttachments,
} from "@/features/research/ui/Attachments";
import { ThemedFrame } from "@/features/office/ui/ThemedFrame";
import { EditorFileView } from "@/features/office/editors/EditorFiles";
import { docExtensions } from "@/features/office/editors/docExtensions";
import { editorKindOf } from "@/features/office/editors/formats";
import { EditorContent, useEditor } from "@tiptap/react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PageHeader, SubsectionLabel } from "@/shared/ui/PageHeader";
import { Textarea } from "@/shared/ui/textarea";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const openChat = (channelId: string | null) => {
  if (channelId) window.location.hash = `#/channels/${channelId}`;
};

/** Half-typed goals survive leaving the page. */
let draftGoal = "";

/**
 * Learn: say what you want to learn and hand over the material; the Office
 * plans a course, builds interactive lessons one at a time and shapes the
 * next one around how the last went.
 */
export function LearnPage({ courseId }: { courseId: string | null }) {
  const { data, isLoading } = useResearch();
  const { data: artifacts = [] } = useArtifacts();
  const { goLearn } = useAppNavigation();
  const courses = sortProjects((data?.projects ?? []).filter(isCourse));
  const opened = courseId
    ? (courses.find((c) => c.id === courseId) ?? null)
    : null;

  if (opened) {
    return (
      <CourseView
        artifacts={artifacts}
        course={opened}
        onBack={() => void goLearn()}
      />
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6"
      data-testid="learn-page"
    >
      <PageHeader
        description="Say what you want to learn and add any material. The Office plans a course, builds interactive lessons, and shapes each one around how you did on the last."
        title="Learn"
      />
      <StartCourseCard onStarted={(course) => void goLearn(course.id)} />
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading courses…
        </div>
      ) : courses.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No courses yet. Start one above.
        </p>
      ) : (
        <section className="grid gap-3">
          <SubsectionLabel>Your courses</SubsectionLabel>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {courses.map((course) => (
              <CourseCard
                artifacts={artifacts}
                course={course}
                key={course.id}
                onOpen={() => void goLearn(course.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StartCourseCard({
  onStarted,
}: {
  onStarted: (course: Course) => void;
}) {
  const client = useQueryClient();
  const [goal, setGoal] = React.useState(draftGoal);
  const [name, setName] = React.useState("");
  const [nameTouched, setNameTouched] = React.useState(false);
  const nameId = React.useId();
  const attachments = useAttachments((names) =>
    toast.error(`Over 200 MB, so not attached: ${names.join(", ")}`),
  );
  const suggested = proposeCourseName(goal);
  const finalName = (nameTouched ? name : suggested).trim();
  const ready = goal.trim().length > 0 && finalName.length > 0;
  const start = useMutation({
    mutationFn: () => startCourse(finalName, goal, attachments.files),
    onSuccess: ({ course, michaelAdded }) => {
      draftGoal = "";
      attachments.clear();
      setGoal("");
      setName("");
      setNameTouched(false);
      if (!michaelAdded) {
        toast.warning(
          "The CEO isn't set up yet, so the course is waiting in its chat.",
        );
      } else {
        toast.success(
          `Started ${course.name}. The Office is planning your first lesson.`,
        );
      }
      void client.invalidateQueries({ queryKey: RESEARCH_KEY });
      onStarted(course);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const submit = () => {
    if (ready && !start.isPending) start.mutate();
  };

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/40 p-4 transition-shadow",
        dropOutline(attachments.dragging),
      )}
      data-testid="learn-start-card"
      {...attachments.dropProps}
    >
      {attachments.input}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <GraduationCap className="h-3.5 w-3.5" />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">What do you want to learn?</p>
          <p className="text-xs text-muted-foreground">
            Say where you're starting from and where you want to get. Attach
            your material (notes, slides, a textbook chapter, a paper) and the
            lessons are built from it.
          </p>
        </div>
      </div>
      <Textarea
        className="min-h-24 resize-y"
        data-testid="learn-goal"
        onChange={(e) => {
          setGoal(e.target.value);
          draftGoal = e.target.value;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="e.g. Teach me the basics of contract law from these lecture notes. I'm a first-year student and my exam is in three weeks."
        value={goal}
      />
      <AttachmentChips
        files={attachments.files}
        onRemove={attachments.remove}
      />
      <div className="flex flex-wrap items-center gap-2">
        <AttachButton disabled={start.isPending} onClick={attachments.open} />
        <label className="text-xs text-muted-foreground" htmlFor={nameId}>
          Course name
        </label>
        <Input
          className="h-8 max-w-xs flex-1"
          id={nameId}
          onChange={(e) => {
            setNameTouched(true);
            setName(e.target.value);
          }}
          placeholder="New course"
          value={nameTouched ? name : goal.trim() ? suggested : ""}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Ctrl+Enter
          </span>
          <Button
            data-testid="learn-start"
            disabled={!ready || start.isPending}
            onClick={submit}
          >
            {start.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            Start learning
          </Button>
        </div>
      </div>
    </section>
  );
}

function ProgressBar({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function CourseCard({
  artifacts,
  course,
  onOpen,
}: {
  artifacts: Artifact[];
  course: Course;
  onOpen: () => void;
}) {
  const { data: progress = EMPTY_PROGRESS } = useCourseProgress(course.id);
  const lessons = courseLessons(artifacts, course.id);
  const summary = courseSummary(
    lessons.map((l) => l.key),
    progress,
  );
  return (
    <button
      className="grid gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 text-left transition-colors hover:bg-muted/50"
      data-testid={`learn-course-${course.id}`}
      onClick={onOpen}
      type="button"
    >
      <span className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BookOpen className="h-4 w-4" />
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate font-medium">{course.name}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {course.description}
          </span>
        </span>
      </span>
      <span className="grid gap-1.5">
        <ProgressBar value={summary.total ? summary.done / summary.total : 0} />
        <span className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {summary.total === 0
              ? "Planning the first lesson…"
              : `${summary.done} of ${summary.total} lessons done`}
          </span>
          <span className="tabular-nums">
            {summary.average !== null
              ? `${Math.round(summary.average * 100)}% avg · `
              : ""}
            {ago(course.updatedAt)}
          </span>
        </span>
      </span>
    </button>
  );
}

function CourseView({
  artifacts,
  course,
  onBack,
}: {
  artifacts: Artifact[];
  course: Course;
  onBack: () => void;
}) {
  const client = useQueryClient();
  const { data: progress = EMPTY_PROGRESS } = useCourseProgress(course.id);
  const lessons = courseLessons(artifacts, course.id);
  const summary = courseSummary(
    lessons.map((l) => l.key),
    progress,
  );
  // Open the first lesson not done yet, else the last one.
  const firstOpen =
    lessons.find((l) => progress.lessons[l.key]?.status !== "done") ??
    lessons[lessons.length - 1];
  const [picked, setPicked] = React.useState<string | null>(null);
  const current = lessons.find((l) => l.key === picked) ?? firstOpen ?? null;
  const [request, setRequest] = React.useState("");
  const [pane, setPane] = React.useState<"lesson" | "notes">("lesson");

  const ask = useMutation({
    mutationFn: (text: string) => askForLesson(course, text),
    onSuccess: () => {
      setRequest("");
      toast.success(
        "Sent to the Office. The lesson appears here when it's ready.",
      );
    },
    onError: (e) => toast.error(errorText(e)),
  });

  // Progress is written here and read back by the Office from the folder.
  const progressRef = React.useRef<CourseProgress>(progress);
  progressRef.current = progress;
  const record = React.useCallback(
    async (
      lesson: { key: string; title: string; id: string },
      report: ReturnType<typeof readLearnMessage>,
    ) => {
      if (!report) return;
      const before = progressRef.current.lessons[lesson.key];
      const next = addReport(
        progressRef.current,
        { id: lesson.key, title: lesson.title },
        report,
        Date.now(),
      );
      progressRef.current = next;
      client.setQueryData(progressKey(course.id), next);
      try {
        await learnApi.saveProgress(course.id, next);
        const entry = next.lessons[lesson.key] as LessonProgress;
        // A lesson may say "done" more than once; tell the Office once a
        // minute at most.
        const fresh =
          before?.status !== "done" || Date.now() - before.updatedAt > 60_000;
        if (report.done && fresh) {
          if (before?.status !== "done") toast.success(`${lesson.title} done.`);
          await reportLesson(course, lesson.id, entry);
        }
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [client, course],
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-4 sm:px-6"
      data-testid="learn-course"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          aria-label="All courses"
          onClick={onBack}
          size="icon"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <div className="grid min-w-0 flex-1 gap-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {course.name}
          </h1>
          <div className="flex max-w-md items-center gap-3">
            <ProgressBar
              className="flex-1"
              value={summary.total ? summary.done / summary.total : 0}
            />
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {summary.done}/{summary.total} lessons
              {summary.average !== null
                ? ` · ${Math.round(summary.average * 100)}% avg`
                : ""}
            </span>
          </div>
        </div>
        <Button
          onClick={() =>
            void researchApi
              .open(course.id)
              .catch((e) => toast.error(errorText(e)))
          }
          size="sm"
          variant="ghost"
        >
          <FolderOpen />
          Material
        </Button>
        <Button
          disabled={!course.channelId}
          onClick={() => openChat(course.channelId)}
          size="sm"
          variant="outline"
        >
          <MessageSquare />
          Ask the tutor
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <ol className="grid gap-1">
            {lessons.map(({ lesson, key }, index) => {
              const p = progress.lessons[key];
              const on = current?.key === key;
              return (
                <li key={key}>
                  <button
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors",
                      on ? "bg-muted" : "hover:bg-muted/60",
                    )}
                    data-testid="learn-lesson"
                    onClick={() => setPicked(key)}
                    type="button"
                  >
                    {p?.status === "done" ? (
                      <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    ) : p ? (
                      <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="grid min-w-0 gap-0.5">
                      <span className="line-clamp-2 text-sm font-medium">
                        {lesson.title || `Lesson ${index + 1}`}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {p?.total
                          ? `${p.score ?? 0}/${p.total}`
                          : p?.status === "done"
                            ? "Done"
                            : p
                              ? "In progress"
                              : "Not started"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <form
            className="grid gap-2 rounded-xl border border-border/70 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask.mutate(request);
            }}
          >
            <p className="text-xs text-muted-foreground">
              {lessons.length === 0
                ? "The Office is planning your course. Lessons appear here as they're ready."
                : "Want something different next? Say so, or just ask for the next lesson."}
            </p>
            <Textarea
              className="min-h-16 resize-y text-sm"
              onChange={(e) => setRequest(e.target.value)}
              placeholder="e.g. More practice on consideration, please"
              value={request}
            />
            <Button
              disabled={ask.isPending || !course.channelId}
              size="sm"
              type="submit"
            >
              {ask.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              {request.trim()
                ? "Send"
                : lessons.length === 0
                  ? "Ask for the first lesson"
                  : "Next lesson"}
            </Button>
          </form>
        </aside>

        <section className="flex min-h-[24rem] flex-col overflow-hidden rounded-2xl border border-border/70 bg-card">
          <div className="flex items-center gap-1 border-b border-border/60 px-2 pt-2" role="tablist">
            {(
              [
                ["lesson", "Lesson", Presentation],
                ["notes", "My notes", NotebookPen],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                aria-selected={pane === id}
                className={cn(
                  "-mb-px flex items-center gap-1.5 rounded-t-lg border border-transparent px-3 py-1.5 text-sm",
                  pane === id ? "border-border/60 border-b-card bg-card font-medium" : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`learn-pane-${id}`}
                key={id}
                onClick={() => setPane(id)}
                role="tab"
                type="button"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          {pane === "notes" ? (
            <CourseNotes course={course} />
          ) : current ? (
            <LessonPlayer
              key={current.lesson.id}
              lesson={current.lesson}
              lessonKey={current.key}
              onReport={record}
              status={progress.lessons[current.key]?.status ?? null}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <GraduationCap className="h-8 w-8 opacity-50" />
              <p>Your first lesson is on its way.</p>
              <p className="text-xs">
                Michael's office is reading your material and planning the
                course. You can follow along in the chat.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** One interactive lesson. It reports progress with `postMessage`; one that
 *  doesn't can be marked done by hand. */
function LessonPlayer({
  lesson,
  lessonKey,
  onReport,
  status,
}: {
  lesson: Artifact;
  lessonKey: string;
  onReport: (
    lesson: { key: string; title: string; id: string },
    report: ReturnType<typeof readLearnMessage>,
  ) => void;
  status: LessonProgress["status"] | null;
}) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [reports, setReports] = React.useState(false);
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const report = readLearnMessage(event.data);
      if (!report) return;
      setReports(true);
      onReport({ key: lessonKey, title: lesson.title, id: lesson.id }, report);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [lesson.id, lesson.title, lessonKey, onReport]);

  const src = lesson.path ? convertFileSrc(lesson.path) : null;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {lesson.title}
        </span>
        {status === "done" ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <CircleCheck className="h-3.5 w-3.5" />
            Done
          </span>
        ) : reports ? null : (
          <Button
            onClick={() =>
              onReport(
                { key: lessonKey, title: lesson.title, id: lesson.id },
                { score: null, total: null, done: true, note: null },
              )
            }
            size="sm"
            variant="outline"
          >
            <CircleCheck />
            Mark as done
          </Button>
        )}
      </div>
      {lesson.path && editorKindOf(lesson.path) ? (
        // Built in the app's editors (a deck, a reading, a practice sheet, a
        // 3D model): shown as it is, with "Edit in …" to work in it.
        <div className="min-h-0 flex-1 overflow-hidden" data-testid="learn-editor-lesson">
          <EditorFileView item={{ id: lesson.id, title: lesson.title, path: lesson.path, series: lesson.series }} />
        </div>
      ) : src && lesson.kind === "html" ? (
        <ThemedFrame
          className="min-h-0 w-full flex-1"
          ref={frame}
          src={src}
          title={lesson.title}
        />
      ) : src && lesson.kind === "pdf" ? (
        <iframe
          className="min-h-0 flex-1 bg-white"
          src={src}
          title={lesson.title}
        />
      ) : (
        <p className="p-6 text-sm text-muted-foreground">
          This lesson can't be shown here. Open it from Artifacts.
        </p>
      )}
    </>
  );
}

/** The learner's notes for a course, written in the app's document editor.
 *  Saved (as they type) into the course's progress.json, which the tutor
 *  reads when planning the next lesson. */
function CourseNotes({ course }: { course: Course }) {
  const client = useQueryClient();
  const { data: progress = EMPTY_PROGRESS, isLoading } = useCourseProgress(course.id);
  const [state, setState] = React.useState<"saved" | "saving" | "error">("saved");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef(progress);
  latest.current = progress;
  const save = React.useCallback(
    (html: string) => {
      if (timer.current) clearTimeout(timer.current);
      setState("saving");
      timer.current = setTimeout(() => {
        const next: CourseProgress = { ...latest.current, notes: { html, updatedAt: Date.now() } };
        client.setQueryData(progressKey(course.id), next);
        learnApi
          .saveProgress(course.id, next)
          .then(() => setState("saved"))
          .catch(() => setState("error"));
      }, 800);
    },
    [client, course.id],
  );
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const editor = useEditor(
    {
      extensions: docExtensions(),
      content: progress.notes?.html ?? "<h2>My notes</h2><p></p>",
      onUpdate: ({ editor: e }) => save(e.getHTML()),
    },
    // Load once the progress is in; after that the editor owns the text.
    [isLoading],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="learn-notes">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
        <NotebookPen className="h-3.5 w-3.5" />
        <span className="flex-1">Your notes for this course. The tutor reads them when planning your next lesson.</span>
        <span className="tabular-nums">{state === "saving" ? "Saving…" : state === "error" ? "Couldn't save" : "Saved"}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#f3f3f3] py-6 dark:bg-[#1f1f1f]">
        <div className="mx-auto max-w-[21cm] bg-white px-12 py-10 text-[#1f1f1f] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.12)]">
          <div className="office-page min-h-[20rem] text-[11pt] leading-[1.45] [font-family:Calibri,Aptos,'Segoe_UI',sans-serif]">
            {isLoading ? null : <EditorContent editor={editor} />}
          </div>
        </div>
      </div>
    </div>
  );
}
