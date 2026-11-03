import assert from "node:assert/strict";
import test from "node:test";

import {
  addReport,
  courseLessons,
  courseSummary,
  EMPTY_PROGRESS,
  proposeCourseName,
  readLearnMessage,
} from "./learnModel.ts";

test("a course is named after what you want to learn", () => {
  assert.equal(
    proposeCourseName("I want to learn contract law. Exam in 3 weeks"),
    "Contract law",
  );
  assert.equal(proposeCourseName("Teach me how to read music"), "Read music");
  assert.equal(proposeCourseName("   "), "New course");
});

test("only a lesson's own message is read, and its numbers are kept sane", () => {
  assert.equal(readLearnMessage({ type: "other", score: 1 }), null);
  assert.equal(readLearnMessage("buzz-learn"), null);
  assert.deepEqual(
    readLearnMessage({
      type: "buzz-learn",
      score: 12,
      total: 10,
      done: true,
      note: "  dates ",
    }),
    { score: 10, total: 10, done: true, note: "dates" },
  );
  assert.deepEqual(
    readLearnMessage({ type: "buzz-learn", score: -1, total: "x" }),
    { score: null, total: null, done: false, note: null },
  );
});

test("progress adds up, and a finished lesson stays finished", () => {
  const lesson = { id: "a1", title: "Lesson 1: Offers" };
  let p = addReport(
    EMPTY_PROGRESS,
    lesson,
    { score: 2, total: 5, done: false, note: null },
    1,
  );
  assert.equal(p.lessons.a1.status, "started");
  assert.equal(p.lessons.a1.attempts, 0);
  p = addReport(
    p,
    lesson,
    { score: 4, total: 5, done: true, note: "acceptance" },
    2,
  );
  assert.equal(p.lessons.a1.status, "done");
  assert.equal(p.lessons.a1.attempts, 1);
  p = addReport(p, lesson, { score: 1, total: 5, done: false, note: null }, 3);
  assert.equal(p.lessons.a1.status, "done");
  assert.equal(p.lessons.a1.note, "acceptance");
  assert.equal(EMPTY_PROGRESS.lessons.a1, undefined);
});

test("a course's lessons come in the order they were made, latest version each", () => {
  const items = [
    {
      id: "l2",
      title: "Lesson 2: Consideration",
      kind: "html",
      createdAt: 20,
      course: "rp-1",
    },
    {
      id: "l1",
      title: "Lesson 1: Offers",
      kind: "html",
      createdAt: 10,
      course: "rp-1",
    },
    {
      id: "l1b",
      title: "Lesson 1: Offers",
      kind: "html",
      createdAt: 30,
      course: "rp-1",
      series: "l1",
    },
    { id: "x", title: "Other", kind: "html", createdAt: 5, course: "rp-2" },
    { id: "y", title: "Not a lesson", kind: "html", createdAt: 6 },
  ];
  const lessons = courseLessons(items, "rp-1");
  assert.deepEqual(
    lessons.map((l) => [l.key, l.lesson.id]),
    [
      ["l1", "l1b"],
      ["l2", "l2"],
    ],
  );
  const progress = addReport(
    EMPTY_PROGRESS,
    { id: "l1", title: "L1" },
    { score: 3, total: 4, done: true, note: null },
    1,
  );
  assert.deepEqual(courseSummary(["l1", "l2"], progress), {
    done: 1,
    total: 2,
    average: 0.75,
  });
});
