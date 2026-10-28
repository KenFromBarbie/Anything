import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactLink,
  closeDeskPanel,
  getDeskPanel,
  openDeskPanel,
  parseArtifactLink,
  setDeskPanelFallback,
} from "./deskPanel.ts";

test("artifact links round-trip and nothing else parses as one", () => {
  assert.equal(parseArtifactLink(artifactLink("mvqkkafl-336aac")), "mvqkkafl-336aac");
  assert.equal(parseArtifactLink("buzz://artifact/../etc"), null);
  assert.equal(parseArtifactLink("https://example.com/artifact/abcd"), null);
  assert.equal(parseArtifactLink(undefined), null);
});

test("with no channel on screen, a panel opens through the fallback", () => {
  const opened = [];
  setDeskPanelFallback((panel) => opened.push(panel));
  openDeskPanel({ kind: "artifact", id: "abcd" });
  assert.deepEqual(opened, [{ kind: "artifact", id: "abcd" }]);
  assert.equal(getDeskPanel(), null);
  setDeskPanelFallback(null);
  openDeskPanel({ kind: "browser" });
  assert.deepEqual(getDeskPanel(), { kind: "browser" });
  closeDeskPanel();
  assert.equal(getDeskPanel(), null);
});
