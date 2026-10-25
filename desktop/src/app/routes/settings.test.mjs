import assert from "node:assert/strict";
import test from "node:test";

// Import the real validateSettingsSearch so tests exercise actual production
// route-validation logic, not a mounted component (mounting SettingsView
// directly bypasses validateSettingsSearch and is what let the earlier gap
// slip past the existing test).
const { validateSettingsSearch } = await import("./settings.tsx");

test("removed sections fall back to the default", () => {
  for (const section of ["moderation", "relay-admin", "compute"]) {
    assert.equal(validateSettingsSearch({ section }).section, undefined);
  }
});

test("?section=doctor still migrates to agents", () => {
  const result = validateSettingsSearch({ section: "doctor" });
  assert.equal(result.section, "agents");
});

test("valid section passes through unchanged", () => {
  const result = validateSettingsSearch({ section: "profile" });
  assert.equal(result.section, "profile");
});

test("unknown section resolves to undefined (falls back to default)", () => {
  const result = validateSettingsSearch({ section: "totally-unknown-value" });
  assert.equal(result.section, undefined);
});

test("missing section resolves to undefined", () => {
  const result = validateSettingsSearch({});
  assert.equal(result.section, undefined);
});

test("the updates and meetings sections open", () => {
  assert.equal(validateSettingsSearch({ section: "updates" }).section, "updates");
  assert.equal(validateSettingsSearch({ section: "meetings" }).section, "meetings");
});
