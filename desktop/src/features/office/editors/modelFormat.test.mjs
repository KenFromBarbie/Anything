// Run: node --import ./scripts/ts-ext-hook.mjs --test src/features/office/editors/modelFormat.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { parseModel } from "./modelFormat.ts";

const obj = (params) => ({ id: "c", name: "c", kind: "cylinder", visible: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], params });

test("a cylinder without a top radius is straight (not a 0.5 m cone)", () => {
  const m = parseModel({ type: "model", objects: [obj({ radius: 0.0025, height: 0.165 })] });
  assert.equal(m.objects[0].params.radius, 0.0025);
  assert.equal(m.objects[0].params.radiusTop, 0.0025);
});

test("an explicit top radius is kept", () => {
  const m = parseModel({ type: "model", objects: [obj({ radius: 0.1, radiusTop: 0.05, height: 1 })] });
  assert.equal(m.objects[0].params.radiusTop, 0.05);
});
