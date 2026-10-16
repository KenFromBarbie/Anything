import assert from "node:assert/strict";
import test from "node:test";

import { asksForYou, openQuestion, stuckBehind } from "./askMe.ts";

const task = (id, fields = {}) => ({
  id,
  title: id,
  status: "blocked",
  priority: 3,
  createdAt: "",
  ...fields,
});

test("only blocked tasks with an open question wait on you, newest first", () => {
  const tasks = [
    task("old", { humanQA: [{ q: "a?", askedAt: "2026-10-01T10:00:00Z" }] }),
    task("new", { humanQA: [{ q: "b?", askedAt: "2026-10-09T10:00:00Z" }] }),
    task("untimed", { humanQA: [{ q: "c?" }] }),
    task("answered", { humanQA: [{ q: "d?", a: "yes" }] }),
    task("dismissed", { humanQA: [{ q: "e?", dismissedAt: "x" }] }),
    task("doing", { status: "doing", humanQA: [{ q: "f?" }] }),
  ];
  assert.deepEqual(
    asksForYou(tasks).map((t) => t.id),
    ["new", "old", "untimed"],
  );
});

test("the open question is the latest unresolved one", () => {
  const t = task("t", {
    humanQA: [{ q: "first?", a: "done" }, { q: "second?" }],
  });
  assert.equal(openQuestion(t)?.q, "second?");
});

test("stuck tasks follow the dependency chain, skip done ones, and survive cycles", () => {
  const tasks = [
    task("root"),
    task("a", { status: "todo", dependsOn: ["root"] }),
    task("b", { status: "todo", dependsOn: ["a"] }),
    task("done", { status: "done", dependsOn: ["root"] }),
    task("loop", { status: "todo", dependsOn: ["b", "loop"] }),
  ];
  assert.deepEqual(
    stuckBehind("root", tasks).map((t) => t.id),
    ["a", "b", "loop"],
  );
});
