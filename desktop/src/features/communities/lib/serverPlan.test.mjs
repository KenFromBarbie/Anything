import assert from "node:assert/strict";
import test from "node:test";

import {
  channelSlug,
  draftPlan,
  planFromDraft,
  STAFF_SEATS,
  startingPrompt,
} from "./serverPlan.ts";

test("the draft follows what the server is for", () => {
  const software = draftPlan("Shop app", "Build a web app for our bakery");
  assert.ok(software.channels.some((c) => c.name === "dev"));
  const content = draftPlan("Studio", "Run our YouTube and newsletter content");
  assert.ok(content.channels.some((c) => c.name === "calendar"));
  const other = draftPlan("Misc", "Something entirely unusual");
  assert.ok(other.agents.length > 0 && other.channels.length > 0);
});

test("the starting prompt names the staff, channels and material, and how work flows", () => {
  const plan = draftPlan("Race Cafe", "Open a sim racing cafe", [
    "C:/work/race-cafe/inputs/menu.pdf",
  ], ["https://example.com/venue"]);
  plan.workFolder = "C:/work/race-cafe";
  const prompt = startingPrompt(plan);
  assert.match(prompt, /Race Cafe/);
  assert.match(prompt, /Open a sim racing cafe/);
  for (const agent of plan.agents) assert.ok(prompt.includes(agent.name));
  assert.match(prompt, /#planning/);
  assert.match(prompt, /Work folder: C:\/work\/race-cafe/);
  assert.match(prompt, /menu\.pdf/);
  assert.match(prompt, /https:\/\/example\.com\/venue/);
  assert.match(prompt, /hire floor workers/);
  assert.match(prompt, /don't do the work yourself/);
});

test("Claude's draft becomes the setup, cleaned up", () => {
  const plan = planFromDraft("wittenborg", "University assistant", {
    staff: [
      { name: "Pam", role: "Student services lead: enquiries and enrolment" },
      { name: "Michael", role: "taken" },
      { name: "pam", role: "duplicate" },
      { name: "Oscar", role: "Academic records" },
      { name: "Toby", role: "HR" },
      { name: "Kevin", role: "IT support" },
      { name: "Andy", role: "one too many" },
    ],
    channels: [
      { name: "Admissions Queries", purpose: "Applicant questions" },
      { name: "timetables", purpose: "Course schedules" },
    ],
    threads: [
      { channel: "admissions-queries", title: "This intake's open questions" },
      { channel: "nowhere", title: "dropped" },
    ],
    brief: "Help students and staff of the university.",
  });
  assert.deepEqual(
    plan.agents.map((a) => a.name),
    ["Pam", "Oscar", "Toby", "Kevin"],
  );
  assert.equal(plan.agents.length, STAFF_SEATS);
  assert.deepEqual(
    plan.channels.map((c) => c.name),
    ["admissions-queries", "timetables"],
  );
  assert.deepEqual(plan.threads.map((t) => t.channel), ["admissions-queries"]);
  assert.match(plan.prompt, /Help students and staff/);
});

test("an empty draft falls back to the template", () => {
  const plan = planFromDraft("x", "Build a web app", {});
  assert.ok(plan.agents.length > 0 && plan.channels.length > 0);
});

test("channel names become relay-friendly slugs", () => {
  assert.equal(channelSlug("  #Big Ideas! "), "big-ideas");
  assert.equal(channelSlug("Q&A / Help"), "q-a-help");
});
