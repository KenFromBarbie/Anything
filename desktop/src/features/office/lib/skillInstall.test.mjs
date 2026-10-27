import assert from "node:assert/strict";
import test from "node:test";

import { githubRepoUrl, installSkillRequest } from "./skillInstall.ts";

test("a GitHub repository is read from a link, a bare host path or owner/repo", () => {
  const want = "https://github.com/anthropics/skills";
  assert.equal(githubRepoUrl("https://github.com/anthropics/skills"), want);
  assert.equal(githubRepoUrl("github.com/anthropics/skills.git"), want);
  assert.equal(githubRepoUrl("  anthropics/skills/ "), want);
  assert.equal(
    githubRepoUrl("https://github.com/anthropics/skills/tree/main/pdf"),
    "https://github.com/anthropics/skills/tree/main/pdf",
  );
});

test("anything that isn't a GitHub repository is refused", () => {
  assert.equal(githubRepoUrl("https://gitlab.com/a/b"), null);
  assert.equal(githubRepoUrl("just words"), null);
  assert.equal(githubRepoUrl("a/b; rm -rf ~"), null);
  assert.equal(githubRepoUrl(""), null);
});

test("Michael is asked to review a skill before installing it", () => {
  const text = installSkillRequest("https://github.com/o/r");
  assert.match(text, /https:\/\/github\.com\/o\/r/);
  assert.match(text, /harmful/);
});
