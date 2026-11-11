import assert from "node:assert/strict";
import test from "node:test";

import { curveLength, meshArea, parsePoint, surfaceGeometry } from "./cad.ts";
import { meshVolume, trianglesOf } from "./marine.ts";

const curve = (id, c, position = [0, 0, 0]) => ({ id, name: id, kind: "curve", visible: true, position, rotation: [0, 0, 0], scale: [1, 1, 1], curve: c });
const file = (objects) => ({ type: "model", version: 1, fps: 24, frameStart: 1, frameEnd: 10, world: {}, objects });

test("points: absolute, on the plane, relative", () => {
  assert.deepEqual(parsePoint("1,2,3", null, "y"), [1, 2, 3]);
  assert.deepEqual(parsePoint("1,2", null, "y"), [1, 0, 2]);
  assert.deepEqual(parsePoint("@1,0,0", [1, 1, 1], "y"), [2, 1, 1]);
  assert.equal(parsePoint("abc", null, "y"), null);
});

test("extruded closed curve is a capped solid", () => {
  const f = file([curve("r", { type: "rect", points: [[0, 0, 0], [2, 0, 1]], plane: "y" })]);
  const g = surfaceGeometry({ op: "extrude", curves: ["r"], direction: [0, 0.5, 0], cap: true }, f);
  assert.ok(Math.abs(meshArea(g) - 7) < 1e-9);
  assert.ok(Math.abs(Math.abs(meshVolume(trianglesOf(g))) - 1) < 1e-9);
});

test("loft follows its curves (history)", () => {
  const c1 = curve("a", { type: "circle", points: [[0, 0, 0], [1, 0, 0]], plane: "y" });
  const c2 = curve("b", { type: "circle", points: [[0, 0, 0], [1, 0, 0]], plane: "y" }, [0, 4, 0]);
  const g = surfaceGeometry({ op: "loft", curves: ["a", "b"] }, file([c1, c2]));
  assert.ok(Math.abs(meshArea(g) - 2 * Math.PI * 4) < 0.05);
  assert.ok(Math.abs(curveLength(c1.curve) - 2 * Math.PI) < 0.01);
});
