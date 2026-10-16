import assert from "node:assert/strict";
import test from "node:test";

import { settingsNavGroups } from "./SettingsView.tsx";

// Kenn's Harness runs one local community, so the Communities group (hosted
// communities, members, relay admin) is left out of the Settings menu.
test("the Communities group is not in the Settings menu", () => {
  assert.equal(
    settingsNavGroups.find((g) => g.label === "Communities"),
    undefined,
  );
  for (const section of [
    "hosted-communities",
    "community-members",
    "relay-admin",
  ]) {
    for (const group of settingsNavGroups) {
      assert.ok(
        !group.sections.includes(section),
        `"${section}" must not appear in the "${group.label}" group`,
      );
    }
  }
});

test("the removed admin-console id is not wired into any nav group", () => {
  for (const group of settingsNavGroups) {
    assert.ok(
      !group.sections.includes("admin-console"),
      `"admin-console" must not appear in the "${group.label}" group`,
    );
  }
});
