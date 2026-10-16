import assert from "node:assert/strict";
import test from "node:test";

import { planSync, rowFingerprint, taskFingerprint } from "./notionSyncPlan.ts";

const names = {
  nameOf: (id) => ({ god: "Michael", "jim-1": "Jim" })[id],
  idOf: (name) => ({ Michael: "god", Jim: "jim-1" })[name],
};

const task = (overrides = {}) => ({
  id: "t1",
  title: "Write the brief",
  status: "todo",
  assignee: "jim-1",
  ...overrides,
});
const row = (overrides = {}) => ({
  pageId: "p1",
  taskId: "t1",
  title: "Write the brief",
  status: "To do",
  assignee: "Jim",
  description: "",
  ...overrides,
});
const synced = (t, r) => ({
  tasks: {
    [t.id]: {
      pageId: r.pageId,
      localFp: taskFingerprint(t, names),
      notionFp: rowFingerprint(r),
    },
  },
});
const kinds = (actions) => actions.map((action) => action.kind);

test("a new task gets a Notion row; a new Notion row becomes a task", () => {
  const actions = planSync(
    [task()],
    [row({ pageId: "p9", taskId: null, title: "From Notion" })],
    { tasks: {} },
    names,
  );
  assert.deepEqual(kinds(actions), ["create-row", "import-row"]);
});

test("matching sides are in sync, with agent ids shown as names", () => {
  const actions = planSync([task()], [row()], { tasks: {} }, names);
  assert.deepEqual(kinds(actions), ["in-sync"]);
});

test("a change on the board updates the row", () => {
  const before = task();
  const r = row();
  const actions = planSync(
    [task({ status: "doing" })],
    [r],
    synced(before, r),
    names,
  );
  assert.deepEqual(kinds(actions), ["update-row"]);
});

test("a change in Notion updates the task, names mapped back to ids", () => {
  const t = task();
  const before = row();
  const actions = planSync(
    [t],
    [row({ status: "Done", assignee: "Michael", title: "Brief, final" })],
    synced(t, before),
    names,
  );
  assert.deepEqual(kinds(actions), ["update-task"]);
  assert.deepEqual(actions[0].patch, {
    title: "Brief, final",
    status: "done",
    assignee: "god",
    description: undefined,
  });
});

test("a retired agent's task keeps its assignee when Notion edits it", () => {
  const retired = {
    nameOf: (id) => (id === "pam-mt21tapc" ? "Pam" : names.nameOf(id)),
    idOf: names.idOf,
  };
  const t = task({ assignee: "pam-mt21tapc" });
  const before = row({ assignee: "Pam" });
  const s = {
    tasks: {
      t1: {
        pageId: "p1",
        localFp: taskFingerprint(t, retired),
        notionFp: rowFingerprint(before),
      },
    },
  };
  const actions = planSync(
    [t],
    [row({ assignee: "Pam", description: "more detail" })],
    s,
    retired,
  );
  assert.deepEqual(kinds(actions), ["update-task"]);
  assert.equal(actions[0].patch.assignee, "pam-mt21tapc");
});

test("when both changed, the board wins", () => {
  const t = task();
  const r = row();
  const actions = planSync(
    [task({ status: "blocked" })],
    [row({ status: "Done" })],
    synced(t, r),
    names,
  );
  assert.deepEqual(kinds(actions), ["update-row"]);
});

test("a task removed from the board archives its row", () => {
  const t = task();
  const r = row();
  const actions = planSync([], [r], synced(t, r), names);
  assert.deepEqual(kinds(actions), ["archive-row"]);
});

test("a row deleted in Notion is recreated, never deleting the task", () => {
  const t = task();
  const r = row();
  const actions = planSync([t], [], synced(t, r), names);
  assert.deepEqual(kinds(actions), ["create-row"]);
});

test("a row paired before its Task ID was written isn't imported twice", () => {
  const t = task();
  const r = row({ taskId: null });
  const actions = planSync([t], [r], synced(t, r), names);
  assert.deepEqual(kinds(actions), ["update-row"]);
});
