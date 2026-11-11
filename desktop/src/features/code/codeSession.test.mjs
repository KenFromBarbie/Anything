import assert from "node:assert/strict";
import test from "node:test";

import { codePrompt, codingAgentRank, displayPrompt, isWorking, relPath, scopeToChannel } from "./codeSession.ts";

const msg = (id, role, channelId, text = "x") => ({ id, type: "message", renderClass: "message", role, title: "", text, timestamp: "t", channelId });
const tool = (id, status, channelId = null) => ({ id, type: "tool", status, channelId, args: {}, result: "", isError: false });

test("prompts carry the codebase and come back off for display", () => {
  const t = { name: "site", path: "C:/code/site", branch: "main" };
  const first = codePrompt(t, "fix the header", true);
  assert.match(first, /^\[Code · site\] Work in the codebase at C:\/code\/site \(branch main\)/);
  assert.match(first, /run the project's checks/);
  assert.equal(displayPrompt(first), "fix the header");
  const later = codePrompt(t, "and the footer", false);
  assert.doesNotMatch(later, /coding agent/);
  assert.equal(displayPrompt(later), "and the footer");
  assert.equal(displayPrompt("plain"), "plain");
});

test("a conversation is its channel's items, tool calls included", () => {
  const items = [msg("1", "user", "A"), tool("t1", "completed"), msg("2", "user", "B"), tool("t2", "completed"), msg("3", "assistant", "A")];
  assert.deepEqual(scopeToChannel(items, "A").map((i) => i.id), ["1", "t1", "3"]);
  assert.deepEqual(scopeToChannel(items, "B").map((i) => i.id), ["2", "t2"]);
  assert.deepEqual(scopeToChannel(items, null), []);
});

test("working until the agent answers", () => {
  assert.equal(isWorking([msg("1", "user", "A")]), true);
  assert.equal(isWorking([msg("1", "user", "A"), tool("t", "executing")]), true);
  assert.equal(isWorking([msg("1", "user", "A"), tool("t", "completed"), msg("2", "assistant", "A")]), false);
  assert.equal(isWorking([]), false);
});

test("paths and agent choice", () => {
  assert.equal(relPath("C:\\code\\site\\src\\a.ts", "C:/code/site"), "src/a.ts");
  assert.equal(relPath("D:/other/a.ts", "C:/code/site"), "D:/other/a.ts");
  assert.ok(codingAgentRank({ agentCommand: "claude-code-acp", name: "Coder" }) < codingAgentRank({ agentCommand: "goose", name: "G" }));
});
