import assert from "node:assert/strict";
import test from "node:test";

import { channelSlug, draftPlan, startingPrompt } from "./serverPlan.ts";

test("the draft follows what the server is for", () => {
  const software = draftPlan("Shop app", "Build a web app for our bakery");
  assert.ok(software.channels.some((c) => c.name === "dev"));
  const content = draftPlan("Studio", "Run our YouTube and newsletter content");
  assert.ok(content.channels.some((c) => c.name === "calendar"));
  const other = draftPlan("Misc", "Something entirely unusual");
  assert.ok(other.agents.length > 0 && other.channels.length > 0);
});

test("the starting prompt names the team, channels and files", () => {
  const plan = draftPlan("Race Cafe", "Open a sim racing cafe");
  plan.files = ["C:/work/race-cafe"];
  const prompt = startingPrompt(plan);
  assert.match(prompt, /Race Cafe/);
  assert.match(prompt, /Open a sim racing cafe/);
  for (const agent of plan.agents) assert.ok(prompt.includes(agent.name));
  assert.match(prompt, /#planning/);
  assert.match(prompt, /C:\/work\/race-cafe/);
});

test("channel names become relay-friendly slugs", () => {
  assert.equal(channelSlug("  #Big Ideas! "), "big-ideas");
  assert.equal(channelSlug("Q&A / Help"), "q-a-help");
});
