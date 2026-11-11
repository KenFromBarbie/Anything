import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import { trianglesOf } from "./marine.ts";
import { DEFAULT_PRINT, hatch, offsetLoop, parseGcode, signedArea, slice, sliceAt, toGcode, toPrinter } from "./slicer.ts";

const close = (a, b, rel = 0.02, msg = "") => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel + 1e-9, `${msg} ${a} vs ${b}`);

test("outlines: a cube slices to a square, a tube to a ring with a hole", () => {
  const cube = toPrinter(trianglesOf(new THREE.BoxGeometry(0.02, 0.02, 0.02).toNonIndexed()));
  const loops = sliceAt(cube, 3);
  assert.equal(loops.length, 1);
  close(signedArea(loops[0]), 400, 1e-6, "square area (counter-clockwise)");
  // tube: outer r 10, inner r 6, standing on the bed (extruded ring)
  const shape = new THREE.Shape().absarc(0, 0, 0.01, 0, Math.PI * 2, false);
  shape.holes.push(new THREE.Path().absarc(0, 0, 0.006, 0, Math.PI * 2, true));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false, curveSegments: 48 }).rotateX(-Math.PI / 2).toNonIndexed();
  const ring = sliceAt(toPrinter(trianglesOf(g)), 5);
  assert.equal(ring.length, 2);
  const [outer, hole] = ring.sort((a, b) => signedArea(b) - signedArea(a));
  assert.ok(signedArea(outer) > 0 && signedArea(hole) < 0, "outer ccw, hole cw");
  close(signedArea(outer) + signedArea(hole), Math.PI * (100 - 36), 0.01, "ring area");
  // walls move into the material: the outer shrinks, the hole grows
  close(signedArea(offsetLoop(outer, 1)), Math.PI * 81, 0.02);
  close(-signedArea(offsetLoop(hole, 1)), Math.PI * 49, 0.02);
  assert.equal(offsetLoop(loops[0], 15), null, "closes up");
});

test("infill hatch stays inside and skips holes", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole = [[4, 4], [4, 6], [6, 6], [6, 4]];
  const lines = hatch([sq, hole], 1, 0);
  assert.ok(lines.length >= 10);
  for (const [a, b] of lines) {
    for (const p of [a, b]) assert.ok(p[0] >= -1e-9 && p[0] <= 10 + 1e-9 && p[1] >= 0 && p[1] <= 10);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    assert.ok(!(mid[0] > 4.01 && mid[0] < 5.99 && mid[1] > 4.01 && mid[1] < 5.99), "no line through the hole");
  }
  const total = lines.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
  close(total, 100 - 4, 0.12, "hatch covers the area");
});

test("a 20 mm cube: layers, plausible filament and time, valid G-code", () => {
  const tris = trianglesOf(new THREE.BoxGeometry(0.02, 0.02, 0.02).toNonIndexed());
  const r = slice(tris, DEFAULT_PRINT);
  assert.ok(r.ok, r.error);
  assert.equal(r.layers.length, 99);
  assert.deepEqual(r.size.map((v) => Math.round(v)), [20, 20, 20]);
  assert.ok(r.fits);
  // 8 cm³ solid would be 9.9 g of PLA; 2 walls + 20% infill lands well under
  assert.ok(r.grams > 2 && r.grams < 7, `grams ${r.grams}`);
  assert.ok(r.seconds > 8 * 60 && r.seconds < 60 * 60, `seconds ${r.seconds}`);
  assert.equal(r.overhang, 0);
  // centred on a 220 mm bed
  const xs = r.layers[10].loops[0].map((p) => p[0]);
  close(Math.min(...xs), 100, 1e-6); close(Math.max(...xs), 120, 1e-6);
  const g = toGcode(r, DEFAULT_PRINT, "cube");
  for (const must of ["G28", "M190 S60", "M109 S205", ";LAYER:0", ";LAYER:98", "M106", "M84", ";TYPE:WALL-OUTER", ";TYPE:FILL", ";TYPE:SKIRT"]) assert.ok(g.includes(must), must);
  // reading it back gives the same layers and filament
  const back = parseGcode(g);
  assert.ok(back.layers.length >= 99);
  close(back.filament, r.filament, 0.02, "filament round trip");
  // every extrusion stays on the bed
  for (const l of back.layers) for (const m of l.moves) assert.ok(m.x >= 0 && m.x <= 220 && m.y >= 0 && m.y <= 220);
});

test("too big, too small and overhangs are reported", () => {
  const big = slice(trianglesOf(new THREE.BoxGeometry(0.5, 0.05, 0.05).toNonIndexed()), DEFAULT_PRINT);
  assert.ok(big.ok && !big.fits && big.warnings.length);
  const tiny = slice(trianglesOf(new THREE.BoxGeometry(0.00005, 0.00005, 0.00005).toNonIndexed()), DEFAULT_PRINT);
  assert.equal(tiny.ok, false);
  // a T: a wide top on a thin stem overhangs
  const stem = new THREE.BoxGeometry(0.01, 0.02, 0.01).translate(0, 0.01, 0).toNonIndexed();
  const top = new THREE.BoxGeometry(0.05, 0.005, 0.05).translate(0, 0.0225, 0).toNonIndexed();
  const pos = [...stem.getAttribute("position").array, ...top.getAttribute("position").array];
  const t = slice(new Float64Array(pos), DEFAULT_PRINT);
  assert.ok(t.overhang > 0.1 && t.warnings.some((w) => /overhang/.test(w)));
});
