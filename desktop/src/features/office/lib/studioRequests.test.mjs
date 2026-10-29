import assert from "node:assert/strict";
import test from "node:test";

import { MAKE_KINDS, changeRequest, makeRequest } from "./studioRequests.ts";

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
    { id: "a1", title: "Funnel deck", path: "C:/hive/shared/artifacts/a1/deck.pptx" },
    "make slide 3 shorter",
  );
  assert.match(text, /"Funnel deck" \(artifact a1, C:\/hive/);
  assert.match(text, /make slide 3 shorter/);
  assert.match(text, /new version with the same title/);
});
