import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import { MATERIALS, sectionProps, solveFrame } from "./frameFea.ts";
import { trianglesOf } from "./marine.ts";
import { massProps } from "./massProps.ts";
import { applyJoints, bakeProgram, jointPose, reachCloud, runProgram, sixAxisArm, solveIk, toolPose, withValues } from "./robotics.ts";

const close = (a, b, rel = 0.01, msg = "") => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel + 1e-12, `${msg} ${a} vs ${b}`);

test("frame: cantilever tip load = PL³/3EI, stress = PLc/I", () => {
  const section = { shape: "rod", d: 20 };
  const { Iz, cy } = sectionProps(section);
  const E = MATERIALS.steel.E;
  const L = 1, P = 100;
  const members = Array.from({ length: 4 }, (_, i) => ({ a: [i / 4, 0, 0], b: [(i + 1) / 4, 0, 0], section, material: "steel" }));
  const r = solveFrame({ members, supports: [{ at: [0, 0, 0], type: "fixed" }], loads: [{ at: [1, 0, 0], force: [0, -P, 0] }], selfWeight: false });
  assert.ok(r.ok, r.error);
  close(r.maxDisplacement, (P * L ** 3) / (3 * E * Iz), 0.001, "deflection");
  close(r.maxStress, (P * L * cy) / Iz, 0.001, "stress");
  close(r.reactions[0].force[1], P, 1e-6, "reaction");
});

test("frame: simply supported centre load = PL³/48EI; axial = PL/EA", () => {
  const section = { shape: "square", d: 40, t: 3 };
  const { Iz, A } = sectionProps(section);
  const E = MATERIALS.aluminium.E;
  const members = [
    { a: [0, 0, 0], b: [1, 0, 0], section, material: "aluminium" },
    { a: [1, 0, 0], b: [2, 0, 0], section, material: "aluminium" },
  ];
  const r = solveFrame({ members, supports: [{ at: [0, 0, 0], type: "pinned" }, { at: [2, 0, 0], type: "pinned" }], loads: [{ at: [1, 0, 0], force: [0, -1000, 0] }], selfWeight: false });
  assert.ok(r.ok, r.error);
  close(r.maxDisplacement, (1000 * 2 ** 3) / (48 * E * Iz), 0.001, "midspan");
  const ax = solveFrame({ members: [members[0]], supports: [{ at: [0, 0, 0], type: "fixed" }], loads: [{ at: [1, 0, 0], force: [5000, 0, 0] }], selfWeight: false });
  close(ax.maxDisplacement, 5000 / (E * A), 0.001, "axial");
});

test("frame: cantilever under its own weight = qL⁴/8EI; a mechanism is caught", () => {
  const section = { shape: "tube", d: 30, t: 2 };
  const { Iz, A } = sectionProps(section);
  const { E, rho } = MATERIALS.steel;
  const L = 2;
  const members = Array.from({ length: 8 }, (_, i) => ({ a: [(i * L) / 8, 0, 0], b: [((i + 1) * L) / 8, 0, 0], section, material: "steel" }));
  const r = solveFrame({ members, supports: [{ at: [0, 0, 0], type: "fixed" }], loads: [], selfWeight: true });
  const q = rho * A * 9.81;
  close(r.maxDisplacement, (q * L ** 4) / (8 * E * Iz), 0.01, "self-weight");
  close(r.mass, rho * A * L, 1e-9, "mass");
  const loose = solveFrame({ members: [members[0]], supports: [{ at: [0, 0, 0], type: "pinned" }], loads: [{ at: [0.25, 0, 0], force: [0, -10, 0] }], selfWeight: false });
  assert.equal(loose.ok, false);
});

test("mass properties: a box", () => {
  const g = new THREE.BoxGeometry(2, 1, 0.5).toNonIndexed();
  g.translate(1, 2, 3);
  const m = massProps(trianglesOf(g), 1000);
  close(m.volume, 1, 1e-9, "volume");
  close(m.area, 2 * (2 + 1 + 0.5), 1e-9, "area");
  close(m.mass, 1000, 1e-9);
  close(m.cg[0], 1, 1e-9); close(m.cg[1], 2, 1e-9); close(m.cg[2], 3, 1e-9);
  close(m.inertia[0], (1000 * (1 + 0.25)) / 12, 1e-6, "Ixx");
  close(m.inertia[1], (1000 * (4 + 0.25)) / 12, 1e-6, "Iyy");
  close(m.inertia[2], (1000 * (4 + 1)) / 12, 1e-6, "Izz");
  close(m.principal[0], (1000 * 1.25) / 12, 1e-6, "principal");
});

const model = (objects) => ({ type: "model", version: 1, fps: 30, frameStart: 1, frameEnd: 120, world: {}, objects });

test("robot: joints, IK to a target, limits, program run and bake", () => {
  const arm = sixAxisArm();
  // straight up at home: tool point at the top of the chain
  const home = toolPose(arm.objects, arm.tool, arm.tip).p;
  close(home.y, 0.1 + 0.16 + 0.4 + 0.34 + 0.08 + 0.08 + 0.06, 1e-9, "home height");
  // a joint turns its link about its axis
  const j2 = arm.objects.find((o) => o.name.startsWith("J2"));
  assert.deepEqual(jointPose(j2.joint, 90).rotation.map((v) => Math.round(v)), [0, 0, 90]);
  // reach a point in front, then one with orientation
  const target = [0.45, 0.35, 0.2];
  const ik = solveIk(arm.objects, arm.tool, { position: target }, { tip: arm.tip });
  assert.ok(ik.reached, `error ${ik.error}`);
  const p = toolPose(withValues(arm.objects, ik.values), arm.tool, arm.tip).p;
  assert.ok(p.distanceTo(new THREE.Vector3(...target)) < 1e-3);
  for (const o of arm.objects) if (o.joint) {
    const v = ik.values.get(o.id) ?? o.joint.value;
    assert.ok(v >= o.joint.min - 1e-9 && v <= o.joint.max + 1e-9, o.name);
  }
  const down = solveIk(arm.objects, arm.tool, { position: [0.4, 0.2, 0], rotation: [0, 0, 180] }, { tip: arm.tip, iterations: 400 });
  assert.ok(down.error < 2e-3, `oriented error ${down.error}`);
  // out of reach is reported, not faked
  const far = solveIk(arm.objects, arm.tool, { position: [3, 0, 0] }, { tip: arm.tip });
  assert.equal(far.reached, false);
  // a program: joint move, linear move, wait
  const box = { id: "box", name: "Part", kind: "box", visible: true, position: [0.45, 0.05, 0.2], rotation: [0, 0, 0], scale: [1, 1, 1], params: { width: 0.05, height: 0.05, depth: 0.05 } };
  const m = model([...applyJoints(arm.objects), box]);
  const j1 = arm.objects.find((o) => o.name.startsWith("J1"));
  const run = runProgram(m, {
    tool: arm.tool,
    tip: arm.tip,
    speed: 100,
    steps: [
      { kind: "movej", values: { [j1.id]: 30, [j2.id]: -40 } },
      { kind: "movel", position: [0.45, 0.3, 0.2] },
      { kind: "wait", seconds: 0.5 },
      { kind: "movej", values: { [j1.id]: 500 } },
    ],
  });
  assert.ok(run.frames.length > 30);
  assert.ok(run.issues.some((i) => i.kind === "limit"), "limit reported");
  const endOfMoveL = run.stepOf.lastIndexOf(1);
  const last = toolPose(withValues(m.objects, run.frames[endOfMoveL]), arm.tool, arm.tip).p;
  assert.ok(last.distanceTo(new THREE.Vector3(0.45, 0.3, 0.2)) < 5e-3, "linear move ends on target");
  const baked = bakeProgram(m, run);
  assert.equal(baked.objects.find((o) => o.id === j1.id).keys.length, run.frames.length);
  assert.ok(reachCloud(arm.objects, arm.tool, 200, arm.tip).every((q) => Math.hypot(...q) < 1.5));
});
