import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { DEFAULT_HULL, equilibrium, gzCurve, holtrop, hullGeometry, meshVolume, savitsky, submerged, trianglesOf, waterlineFor } from "./marine.ts";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// A 10 × 2 (beam) × 2 (high) box barge, keel at y = 0, centred on x = 5.
const box = () => {
  const g = new THREE.BoxGeometry(10, 2, 2);
  g.translate(5, 1, 0);
  return trianglesOf(g);
};

test("box hydrostatics match the hand calculation", () => {
  const t = box();
  close(meshVolume(t), 40, 1e-9, "closed volume");
  const h = submerged(t, 1); // draft 1 m
  close(h.volume, 20, 1e-9, "volume");
  close(h.centre[0], 5, 1e-9, "LCB");
  close(h.centre[1], 0.5, 1e-9, "KB");
  close(h.awp, 20, 1e-9, "Awp");
  close(h.lcf, 5, 1e-9, "LCF");
  close(h.it, (10 * 2 ** 3) / 12, 1e-9, "It");
  close(h.il, (2 * 10 ** 3) / 12, 1e-9, "Il");
  close(h.wetted, 10 * 2 + 2 * 10 * 1 + 2 * 2 * 1, 1e-9, "wetted");
});

test("free-floating box: draft from weight, GM and GZ", () => {
  const t = box();
  const mass = 20 * 1025; // 1 m draft in sea water
  const e = equilibrium(t, { name: "w", mass, cg: [5, 0.8, 0] }, 1025);
  close(e.draft, 1, 1e-4, "draft");
  close(e.trim, 0, 1e-3, "trim");
  close(e.bmt, 1 / 3, 1e-4, "BMt = B²/12T");
  close(e.gmt, 0.5 + 1 / 3 - 0.8, 1e-4, "GMt");
  close(e.cb, 1, 1e-6, "Cb");
  // small-angle GZ ≈ GM sin φ
  const gz = gzCurve(t, { name: "w", mass, cg: [5, 0.8, 0] }, 1025, 0, [5]);
  close(gz[0].gz, Math.sin((5 * Math.PI) / 180) * (0.5 + 1 / 3 - 0.8), 0.0005, "GZ at 5°");
  // weight forward → trims bow down
  const f = equilibrium(t, { name: "w", mass, cg: [5.5, 0.8, 0] }, 1025);
  assert.ok(f.trim > 0, `bow-down trim ${f.trim}`);
  close(f.centre[0], 5.5, 1e-3, "LCB under LCG");
});

test("the parametric hull is closed and floats sensibly", () => {
  for (const type of ["planing", "round"]) {
    const t = trianglesOf(hullGeometry({ ...DEFAULT_HULL, type }));
    const v = meshVolume(t);
    assert.ok(v > 3 && v < 15, `${type} volume ${v}`);
    const h = waterlineFor(t, 1.2);
    assert.ok(h && h.waterline > 0 && h.waterline < DEFAULT_HULL.depth, `${type} waterline`);
    close(h.volume, 1.2, 1e-3, `${type} displaced volume`);
  }
});

test("resistance methods give plausible numbers", () => {
  // 6 m planing boat, 1200 kg, at 25 kn
  const s = savitsky({ mass: 1200, b: 2.0, lcg: 2.3, beta: 16, rho: 1025, nu: 1.1892e-6 }, 25 * 0.5144);
  assert.ok(s && s.trim > 1 && s.trim < 8, `trim ${s?.trim}`);
  assert.ok(s.r > 1200 * 9.81 * 0.08 && s.r < 1200 * 9.81 * 0.3, `R/W ${s.r / (1200 * 9.81)}`);
  // 100 m cargo ship-like at 12 kn: R in the 100–400 kN range
  const r = holtrop({ L: 100, B: 16, T: 6, V: 100 * 16 * 6 * 0.7, cm: 0.98, cwp: 0.8, cb: 0.7, lcb: 0, S: 2400, AT: 0, rho: 1025, nu: 1.1892e-6 }, 12 * 0.5144);
  assert.ok(r > 60e3 && r < 400e3, `Holtrop ${r}`);
});
