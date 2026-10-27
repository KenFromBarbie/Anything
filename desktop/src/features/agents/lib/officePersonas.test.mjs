import assert from "node:assert/strict";
import test from "node:test";

import {
  officeAgentPubkeys,
  withoutStaleOfficePersonas,
} from "./officePersonas.ts";

const office = (pubkey, name) => ({
  pubkey,
  name,
  backend: { type: "provider", id: "office", config: {} },
});
const local = (pubkey, name) => ({ pubkey, name, backend: { type: "local" } });

test("Office agents are known by their pubkeys", () => {
  const keys = officeAgentPubkeys([office("AA", "Michael"), local("bb", "Bot")]);
  assert.deepEqual([...keys], ["aa"]);
});

test("stale copies of Office agents are not offered; the live one and others are", () => {
  const agents = [office("aa", "Michael"), local("cc", "Michael")];
  const personas = [
    { id: "aa", displayName: "Michael" },
    { id: "dd", displayName: "Michael" },
    { id: "ee", displayName: "Michael (Office)" },
    { id: "ff", displayName: "Stanley" },
  ];
  assert.deepEqual(
    withoutStaleOfficePersonas(personas, agents).map((p) => p.id),
    ["aa", "ff"],
  );
});
