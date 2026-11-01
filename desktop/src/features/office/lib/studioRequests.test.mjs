import assert from "node:assert/strict";
import test from "node:test";

import {
  MAKE_KINDS,
  appRequest,
  changeRequest,
  codebaseLearnRequest,
  codebaseRequest,
  makeRequest,
  workflowRequest,
} from "./studioRequests.ts";

const codebase = {
  id: "acme-site",
  name: "acme/site",
  source: "github",
  path: "C:/hive/shared/codebases/acme-site",
  addedAt: 1,
  git: true,
  notesPath: "C:/hive/shared/codebases/acme-site.design.md",
  hasNotes: true,
};

test("every kind of thing the Studio makes says how, and to publish it", () => {
  for (const { kind } of MAKE_KINDS) {
    const text = makeRequest(kind, "something");
    assert.match(text, /How: /);
    assert.match(text, /buzz-show --file/);
  }
  assert.match(makeRequest("slides", "a deck"), /python-pptx/);
  assert.match(makeRequest("slides", "a deck"), /--preview/);
});

test("a change names the artifact and asks for a new version", () => {
  const text = changeRequest(
    {
      id: "a1",
      title: "Funnel deck",
      path: "C:/hive/shared/artifacts/a1/deck.pptx",
    },
    "make slide 3 shorter",
  );
  assert.match(text, /"Funnel deck" \(artifact a1, C:\/hive/);
  assert.match(text, /make slide 3 shorter/);
  assert.match(text, /new version: the same title and --version-of a1/);
});

test("a 3D model is made as one .glb", () => {
  assert.match(makeRequest("model", "a lamp"), /binary \.glb/);
});

test("making in a codebase's look points at it and its design notes", () => {
  const text = makeRequest("site", "a pricing page", "buzz-show", codebase);
  assert.match(text, /codebase "acme\/site" at C:\/hive\/shared\/codebases\/acme-site/);
  assert.match(text, /acme-site\.design\.md/);
  assert.doesNotMatch(makeRequest("site", "a page"), /codebase/);
});

test("the owner's workflows and apps carry their instructions", () => {
  const workflow = {
    id: "w1",
    kind: "workflow",
    name: "Weekly report",
    instructions: "Chart last week's sales.",
    icon: "chart",
    tone: "sky",
    createdAt: 1,
  };
  const run = workflowRequest(workflow, "include returns");
  assert.match(run, /"Weekly report"/);
  assert.match(run, /Chart last week's sales\./);
  assert.match(run, /This time: include returns/);
  const app = appRequest({ ...workflow, kind: "app", name: "Habits" });
  assert.match(app, /--dir "<folder>" --title "Habits"/);
});

test("work in a codebase goes on a branch; learning it writes the notes", () => {
  assert.match(codebaseRequest(codebase, "add dark mode"), /new git branch/);
  assert.match(codebaseRequest({ ...codebase, git: false }, "x"), /isn't a git checkout/);
  assert.match(codebaseLearnRequest(codebase), /acme-site\.design\.md/);
  assert.match(codebaseLearnRequest(codebase), /Don't change the codebase/);
});

test("all Studio work goes down the office and is reviewed on the way back", () => {
  for (const text of [
    makeRequest("model", "a lamp"),
    changeRequest({ id: "a1", title: "Lamp" }, "taller"),
    codebaseRequest(codebase, "add dark mode"),
  ]) {
    assert.match(text, /Michael gives it to the staff member/);
    assert.match(text, /floor workers/);
  }
  assert.match(changeRequest({ id: "a1", title: "Lamp" }, "x"), /--version-of a1/);
});
