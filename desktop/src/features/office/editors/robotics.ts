// Robotics for the 3D editor: joints on parented objects (a kinematic chain),
// forward and inverse kinematics, ready-made robots, and robot programs
// (move-joint / move-linear / grip / wait) simulated with reach, limit and
// collision checks, then baked into keyframes.
//
// A joint lives on the moving link (the child): it turns (revolute) or slides
// (prismatic) about an axis in the link's own frame, from its home pose.

import * as THREE from "three";

import type { ModelFile, SceneObject, Vec3 } from "./modelFormat";

export type JointType = "revolute" | "prismatic" | "fixed";
export type JointDef = {
  type: JointType;
  /** Unit axis in the link's own frame (at home). */
  axis: Vec3;
  /** Limits: degrees (revolute) or metres (prismatic). */
  min: number;
  max: number;
  /** Current value (degrees or metres). */
  value: number;
  /** The link's pose at value 0 (its own position / rotation in degrees). */
  home: { position: Vec3; rotation: Vec3 };
  /** deg/s or m/s, for programs. */
  maxVel?: number;
};

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The link's own pose with its joint at `value`. */
export function jointPose(j: JointDef, value = j.value): { position: Vec3; rotation: Vec3 } {
  const v = j.type === "fixed" ? 0 : clamp(value, j.min, j.max);
  const axis = new THREE.Vector3(...j.axis).normalize();
  const qHome = new THREE.Quaternion().setFromEuler(new THREE.Euler(j.home.rotation[0] * D2R, j.home.rotation[1] * D2R, j.home.rotation[2] * D2R));
  if (j.type === "prismatic") {
    const d = axis.clone().applyQuaternion(qHome).multiplyScalar(v);
    return { position: [j.home.position[0] + d.x, j.home.position[1] + d.y, j.home.position[2] + d.z], rotation: [...j.home.rotation] as Vec3 };
  }
  const q = qHome.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, v * D2R));
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return { position: [...j.home.position] as Vec3, rotation: [e.x * R2D, e.y * R2D, e.z * R2D].map((x) => Math.round(x * 1e6) / 1e6 || 0) as Vec3 };
}

/** Write each jointed object's pose from its joint value. */
export function applyJoints(objects: SceneObject[]): SceneObject[] {
  return objects.map((o) => (o.joint ? { ...o, ...jointPose(o.joint) } : o));
}

/** Local matrix of an object (joint applied). */
function localMatrix(o: SceneObject, values?: Map<string, number>): THREE.Matrix4 {
  const p = o.joint ? jointPose(o.joint, values?.get(o.id) ?? o.joint.value) : { position: o.position, rotation: o.rotation };
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...p.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation[0] * D2R, p.rotation[1] * D2R, p.rotation[2] * D2R)),
    new THREE.Vector3(...o.scale),
  );
}

/** The chain from the root down to `id` (root first). */
export function chainTo(objects: SceneObject[], id: string): SceneObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const out: SceneObject[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return out;
}

/** World matrix of `id`, optionally with trial joint values. */
export function worldMatrix(objects: SceneObject[], id: string, values?: Map<string, number>): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  for (const o of chainTo(objects, id)) m.multiply(localMatrix(o, values));
  return m;
}

/** The movable joints on the way to `id` (root first). */
export function jointsTo(objects: SceneObject[], id: string): SceneObject[] {
  return chainTo(objects, id).filter((o) => o.joint && o.joint.type !== "fixed");
}

export type IkTarget = { position: Vec3; /** optional orientation: euler degrees */ rotation?: Vec3 };
export type IkResult = { values: Map<string, number>; error: number; angleError: number; iterations: number; reached: boolean };

/** Where the tool point is: `tip` in the end link's frame. */
export function toolPose(objects: SceneObject[], endId: string, tip: Vec3 = [0, 0, 0], values?: Map<string, number>) {
  const m = worldMatrix(objects, endId, values);
  const p = new THREE.Vector3(...tip).applyMatrix4(m);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
  return { p, q };
}

/**
 * Inverse kinematics: damped least squares on a numeric Jacobian, joint
 * limits respected (clamped each step). Position always; orientation too
 * when the target has one (weighted so 1 rad ≈ `orientWeight` m).
 */
export function solveIk(
  objects: SceneObject[],
  endId: string,
  target: IkTarget,
  opts: { tip?: Vec3; iterations?: number; tolerance?: number; damping?: number; orientWeight?: number; restarts?: number } = {},
): IkResult {
  // From the current pose first; if that stalls (a singular pose, a local
  // minimum), retry from other poses within the limits and keep the best.
  let best = solveIkFrom(objects, endId, target, opts, null);
  const restarts = opts.restarts ?? 8;
  const joints = jointsTo(objects, endId);
  let s = 12345;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let k = 0; k < restarts && !best.reached && joints.length; k++) {
    const start = new Map(joints.map((o) => {
      const j = o.joint as JointDef;
      const span = Math.min(j.max - j.min, j.type === "prismatic" ? 1 : 180);
      const mid = Math.min(j.max, Math.max(j.min, j.value));
      return [o.id, Math.min(j.max, Math.max(j.min, mid + (rnd() - 0.5) * span))];
    }));
    const r = solveIkFrom(objects, endId, target, opts, start);
    if (r.error + r.angleError * 1e-3 < best.error + best.angleError * 1e-3) best = r;
  }
  return best;
}

function solveIkFrom(
  objects: SceneObject[],
  endId: string,
  target: IkTarget,
  opts: { tip?: Vec3; iterations?: number; tolerance?: number; damping?: number; orientWeight?: number },
  start: Map<string, number> | null,
): IkResult {
  const joints = jointsTo(objects, endId);
  const values = start ?? new Map(joints.map((o) => [o.id, (o.joint as JointDef).value]));
  const tip = opts.tip ?? [0, 0, 0];
  const iters = opts.iterations ?? 200;
  const tol = opts.tolerance ?? 1e-4;
  const lambda = opts.damping ?? 0.01;
  const wO = opts.orientWeight ?? 0.3;
  const goalP = new THREE.Vector3(...target.position);
  const goalQ = target.rotation ? new THREE.Quaternion().setFromEuler(new THREE.Euler(target.rotation[0] * D2R, target.rotation[1] * D2R, target.rotation[2] * D2R)) : null;
  const rows = goalQ ? 6 : 3;
  const residual = (vals: Map<string, number>): number[] => {
    const { p, q } = toolPose(objects, endId, tip, vals);
    const e = [goalP.x - p.x, goalP.y - p.y, goalP.z - p.z];
    if (goalQ) {
      // rotation error as axis * angle (world frame)
      const dq = goalQ.clone().multiply(q.clone().invert());
      if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
      const ang = 2 * Math.acos(clamp(dq.w, -1, 1));
      const s = Math.sqrt(Math.max(1e-12, 1 - dq.w * dq.w));
      e.push((dq.x / s) * ang * wO, (dq.y / s) * ang * wO, (dq.z / s) * ang * wO);
    }
    return e;
  };
  const norm3 = (e: number[]) => Math.hypot(e[0], e[1], e[2]);
  let e = residual(values);
  let it = 0;
  for (; it < iters && joints.length; it++) {
    if (norm3(e) < tol && (!goalQ || Math.hypot(e[3], e[4], e[5]) / wO < 1e-3)) break;
    // numeric Jacobian (rows × n)
    const n = joints.length;
    const J: number[][] = Array.from({ length: rows }, () => new Array(n).fill(0));
    // Work per radian / per metre (joint values are stored in degrees).
    const unit = (j: JointDef) => (j.type === "prismatic" ? 1 : R2D);
    const h = 1e-5;
    joints.forEach((o, c) => {
      const j = o.joint as JointDef;
      const trial = new Map(values);
      trial.set(o.id, (values.get(o.id) ?? 0) + h * unit(j));
      const e2 = residual(trial);
      for (let r = 0; r < rows; r++) J[r][c] = (e[r] - e2[r]) / h; // d(pose)/dq
    });
    // dq = Jᵀ (J Jᵀ + λ² I)⁻¹ e
    const A = Array.from({ length: rows }, (_, r) => Array.from({ length: rows }, (_, c) => J[r].reduce((s, v, k) => s + v * J[c][k], 0) + (r === c ? lambda * lambda : 0)));
    const y = solveLinear(A, e);
    if (!y) break;
    joints.forEach((o, c) => {
      const j = o.joint as JointDef;
      let dq = 0;
      for (let r = 0; r < rows; r++) dq += J[r][c] * y[r];
      const step = j.type === "prismatic" ? clamp(dq, -0.05, 0.05) : clamp(dq, -0.3, 0.3) * R2D;
      values.set(o.id, clamp((values.get(o.id) ?? 0) + step, j.min, j.max));
    });
    e = residual(values);
  }
  const error = norm3(e);
  const angleError = goalQ ? (Math.hypot(e[3], e[4], e[5]) / wO) * R2D : 0;
  return { values, error, angleError, iterations: it, reached: error < 1e-3 && angleError < 0.5 };
}

/** Gaussian elimination with partial pivoting (small dense systems). */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Points the tool can reach (random joint values within limits). */
export function reachCloud(objects: SceneObject[], endId: string, n = 1500, tip: Vec3 = [0, 0, 0], seed = 7): Vec3[] {
  const joints = jointsTo(objects, endId);
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const vals = new Map(joints.map((o) => {
      const j = o.joint as JointDef;
      return [o.id, j.min + rnd() * (j.max - j.min)];
    }));
    const { p } = toolPose(objects, endId, tip, vals);
    out.push([p.x, p.y, p.z]);
  }
  return out;
}

// ─── robot programs ─────────────────────────────────────────────────────────

export type ProgramStep =
  | { kind: "movej"; label?: string; values: Record<string, number>; speed?: number }
  | { kind: "movel"; label?: string; position: Vec3; rotation?: Vec3; speed?: number }
  | { kind: "grip"; label?: string; object: string }
  | { kind: "release"; label?: string }
  | { kind: "wait"; label?: string; seconds: number };

export type RobotProgram = {
  /** The tool link and the tool point in its frame. */
  tool: string;
  tip: Vec3;
  steps: ProgramStep[];
  /** % of each joint's max speed */
  speed: number;
};

export type ProgramIssue = { step: number; kind: "unreachable" | "limit" | "collision" | "singular"; text: string };
export type ProgramRun = {
  /** joint values per frame (by object id) */
  frames: Map<string, number>[];
  /** gripped object world matrix per frame (when holding) */
  held: ({ id: string; matrix: THREE.Matrix4 } | null)[];
  issues: ProgramIssue[];
  seconds: number;
  /** tool path (world) */
  path: Vec3[];
  /** which program step each frame belongs to */
  stepOf: number[];
  cycleTime: number;
};

/** Simulate a program at `fps`: joint moves are synchronized (all joints
 *  finish together), linear moves follow a straight line by IK each frame. */
export function runProgram(model: ModelFile, prog: RobotProgram, fps = 30, obstacles: string[] = []): ProgramRun {
  const objects = model.objects;
  const joints = jointsTo(objects, prog.tool);
  let cur = new Map(joints.map((o) => [o.id, (o.joint as JointDef).value]));
  const frames: Map<string, number>[] = [new Map(cur)];
  const held: ProgramRun["held"] = [null];
  const issues: ProgramIssue[] = [];
  const path: Vec3[] = [];
  const stepOf: number[] = [0];
  let curStep = 0;
  let holding: { id: string; offset: THREE.Matrix4 } | null = null;
  const speedK = clamp(prog.speed, 1, 100) / 100;
  const push = (vals: Map<string, number>) => {
    frames.push(new Map(vals));
    stepOf.push(curStep);
    const { p } = toolPose(objects, prog.tool, prog.tip, vals);
    path.push([p.x, p.y, p.z]);
    if (holding) {
      const toolM = worldMatrix(objects, prog.tool, vals);
      held.push({ id: holding.id, matrix: toolM.clone().multiply(holding.offset) });
    } else held.push(null);
  };
  prog.steps.forEach((st, si) => {
    curStep = si;
    if (st.kind === "wait") {
      for (let f = 0; f < Math.round(st.seconds * fps); f++) push(cur);
      return;
    }
    if (st.kind === "grip") {
      const obj = objects.find((o) => o.id === st.object || o.name === st.object);
      if (!obj) {
        issues.push({ step: si, kind: "unreachable", text: `Nothing called "${st.object}" to grip` });
        return;
      }
      const toolM = worldMatrix(objects, prog.tool, cur);
      const objM = worldMatrix(objects, obj.id);
      const { p } = toolPose(objects, prog.tool, prog.tip, cur);
      const dist = p.distanceTo(new THREE.Vector3().setFromMatrixPosition(objM));
      if (dist > 0.25) issues.push({ step: si, kind: "unreachable", text: `Gripper is ${(dist * 100).toFixed(0)} cm from ${obj.name}` });
      holding = { id: obj.id, offset: toolM.clone().invert().multiply(objM) };
      push(cur);
      return;
    }
    if (st.kind === "release") {
      holding = null;
      push(cur);
      return;
    }
    const pct = (st.speed ?? 100) / 100;
    if (st.kind === "movej") {
      const goal = new Map(cur);
      for (const o of joints) {
        const j = o.joint as JointDef;
        const want = st.values[o.id] ?? st.values[o.name];
        if (want == null) continue;
        if (want < j.min || want > j.max) issues.push({ step: si, kind: "limit", text: `${o.name}: ${want.toFixed(1)} is outside ${j.min}…${j.max}` });
        goal.set(o.id, clamp(want, j.min, j.max));
      }
      // synchronized: time = slowest joint
      let t = 0;
      for (const o of joints) {
        const j = o.joint as JointDef;
        const v = (j.maxVel ?? (j.type === "prismatic" ? 0.5 : 120)) * speedK * pct;
        t = Math.max(t, Math.abs((goal.get(o.id) ?? 0) - (cur.get(o.id) ?? 0)) / Math.max(1e-6, v));
      }
      const n = Math.max(1, Math.round(t * fps));
      const from = new Map(cur);
      for (let f = 1; f <= n; f++) {
        const s = smooth(f / n);
        const vals = new Map(joints.map((o) => [o.id, (from.get(o.id) ?? 0) + ((goal.get(o.id) ?? 0) - (from.get(o.id) ?? 0)) * s]));
        push(vals);
      }
      cur = goal;
      return;
    }
    // movel: straight line in space, IK every frame
    const start = toolPose(objects, prog.tool, prog.tip, cur).p;
    const end = new THREE.Vector3(...st.position);
    const dist = start.distanceTo(end);
    const v = 0.25 * speedK * pct; // m/s
    const n = Math.max(1, Math.round((dist / Math.max(1e-6, v)) * fps));
    let model2 = withValues(objects, cur);
    for (let f = 1; f <= n; f++) {
      const pt = start.clone().lerp(end, smooth(f / n));
      const r = solveIk(model2, prog.tool, { position: [pt.x, pt.y, pt.z], rotation: st.rotation }, { tip: prog.tip, iterations: 60 });
      if (!r.reached && f === n) issues.push({ step: si, kind: "unreachable", text: `Can't reach ${st.position.map((x) => x.toFixed(2)).join(", ")} (off by ${(r.error * 1000).toFixed(0)} mm)` });
      cur = r.values;
      model2 = withValues(objects, cur);
      push(cur);
    }
  });
  // collisions: links vs obstacles (bounding spheres of each link's box)
  if (obstacles.length) {
    const linkIds = new Set<string>();
    for (const o of joints) for (const c of descendants(objects, o.id)) linkIds.add(c);
    const obs = obstacles.map((id) => objects.find((o) => o.id === id)).filter((o): o is SceneObject => !!o && !linkIds.has(o.id));
    frames.forEach((vals, fi) => {
      if (fi % 3) return;
      for (const lid of linkIds) {
        const l = objects.find((o) => o.id === lid);
        if (!l || l.kind === "empty") continue;
        const lc = new THREE.Vector3().setFromMatrixPosition(worldMatrix(objects, lid, vals));
        const lr = radiusOf(l);
        for (const ob of obs) {
          if (holding && ob.id === holding.id) continue;
          const oc = new THREE.Vector3().setFromMatrixPosition(worldMatrix(objects, ob.id));
          if (lc.distanceTo(oc) < lr + radiusOf(ob) - 0.01) {
            const step = stepOf[fi] ?? -1;
            if (!issues.some((x) => x.kind === "collision" && x.step === step && x.text.includes(ob.name))) issues.push({ step, kind: "collision", text: `${l.name} hits ${ob.name} (${(fi / fps).toFixed(1)} s)` });
          }
        }
      }
    });
  }
  return { frames, held, issues, seconds: frames.length / fps, path, stepOf, cycleTime: (frames.length - 1) / fps };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function descendants(objects: SceneObject[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const o of objects) if (o.parent === out[i]) out.push(o.id);
  return out;
}

/** A rough bounding radius from the primitive's size. */
export function radiusOf(o: SceneObject): number {
  const p = (o.params ?? {}) as Record<string, number>;
  const s = Math.max(...o.scale.map(Math.abs));
  const dims = [p.width, p.height, p.depth, p.radius ? p.radius * 2 : undefined, p.radiusTop ? p.radiusTop * 2 : undefined].filter((x): x is number => typeof x === "number");
  const big = dims.length ? Math.hypot(...dims) / 2 : 0.5;
  return big * s;
}

/** The objects with the given joint values written in. */
export function withValues(objects: SceneObject[], values: Map<string, number>): SceneObject[] {
  return objects.map((o) => (o.joint && values.has(o.id) ? { ...o, joint: { ...o.joint, value: values.get(o.id) as number } } : o));
}

/** Bake a program run into keyframes (joint links + the held object). */
export function bakeProgram(model: ModelFile, run: ProgramRun, startFrame = 1): ModelFile {
  const ids = new Set<string>();
  for (const f of run.frames) for (const id of f.keys()) ids.add(id);
  const heldIds = new Set(run.held.filter(Boolean).map((h) => (h as { id: string }).id));
  const objects = model.objects.map((o) => {
    if (ids.has(o.id) && o.joint) {
      const keys = run.frames.map((vals, i) => {
        const p = jointPose(o.joint as JointDef, vals.get(o.id));
        return { f: startFrame + i, position: p.position, rotation: p.rotation };
      });
      return { ...o, keys };
    }
    if (heldIds.has(o.id)) {
      // world pose while held; parentless objects only (keys are local)
      let last: { position: Vec3; rotation: Vec3 } = { position: o.position, rotation: o.rotation };
      const keys = run.held.map((h, i) => {
        if (h && h.id === o.id) {
          const pos = new THREE.Vector3();
          const q = new THREE.Quaternion();
          h.matrix.decompose(pos, q, new THREE.Vector3());
          const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
          last = { position: [pos.x, pos.y, pos.z], rotation: [e.x * R2D, e.y * R2D, e.z * R2D] };
        }
        return { f: startFrame + i, ...last };
      });
      return { ...o, keys };
    }
    return o;
  });
  return { ...model, objects, frameStart: startFrame, frameEnd: Math.max(model.frameEnd, startFrame + run.frames.length - 1) };
}

// ─── ready-made robots ──────────────────────────────────────────────────────

type Part = Omit<SceneObject, "visible" | "scale"> & { scale?: Vec3 };
const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;

function link(id: string, name: string, parent: string | undefined, position: Vec3, joint: Omit<JointDef, "home" | "value"> | null, body: Partial<SceneObject> = {}): SceneObject {
  const o: SceneObject = { id, name, kind: "empty", parent, visible: true, position, rotation: [0, 0, 0], scale: [1, 1, 1], ...body };
  if (joint) o.joint = { ...joint, value: 0, home: { position: [...position] as Vec3, rotation: [0, 0, 0] } };
  return o;
}

const ORANGE = { color: "#e8873a", metalness: 0.2, roughness: 0.45, opacity: 1 };
const GREY = { color: "#3a3d42", metalness: 0.4, roughness: 0.5, opacity: 1 };
const STEEL = { color: "#b8bcc2", metalness: 0.8, roughness: 0.3, opacity: 1 };

function body(parent: string, name: string, kind: SceneObject["kind"], position: Vec3, params: Record<string, number>, material = ORANGE, rotation: Vec3 = [0, 0, 0]): SceneObject {
  return { id: uid("b"), name, kind, parent, visible: true, position, rotation, scale: [1, 1, 1], params, material } as SceneObject;
}

/** A 6-axis industrial arm (about 0.85 m reach). Returns the objects and the tool link id. */
export function sixAxisArm(at: Vec3 = [0, 0, 0]): { objects: SceneObject[]; tool: string; tip: Vec3 } {
  const ids = ["base", "j1", "j2", "j3", "j4", "j5", "j6"].map((k) => uid(`${k}-`));
  const [base, s, u, f, w1, w2, w3] = ids;
  const R = (axis: Vec3, min: number, max: number, maxVel = 180): Omit<JointDef, "home" | "value"> => ({ type: "revolute", axis, min, max, maxVel });
  const objs: SceneObject[] = [
    link(base, "Robot base", undefined, at, null),
    body(base, "Base", "cylinder", [0, 0.05, 0], { radiusTop: 0.12, radius: 0.14, height: 0.1 }, GREY),
    link(s, "J1 Shoulder pan", base, [0, 0.1, 0], R([0, 1, 0], -180, 180, 150)),
    body(s, "Shoulder", "cylinder", [0, 0.08, 0], { radiusTop: 0.09, radius: 0.1, height: 0.16 }),
    link(u, "J2 Shoulder lift", s, [0, 0.16, 0], R([0, 0, 1], -110, 110, 150)),
    body(u, "Upper arm", "box", [0, 0.2, 0], { width: 0.1, height: 0.4, depth: 0.1 }),
    link(f, "J3 Elbow", u, [0, 0.4, 0], R([0, 0, 1], -150, 150, 180)),
    body(f, "Forearm", "box", [0, 0.17, 0], { width: 0.08, height: 0.34, depth: 0.08 }),
    link(w1, "J4 Wrist roll", f, [0, 0.34, 0], R([0, 1, 0], -270, 270, 300)),
    body(w1, "Wrist 1", "cylinder", [0, 0.04, 0], { radiusTop: 0.045, radius: 0.045, height: 0.08 }, GREY),
    link(w2, "J5 Wrist bend", w1, [0, 0.08, 0], R([0, 0, 1], -120, 120, 300)),
    body(w2, "Wrist 2", "cylinder", [0, 0.04, 0], { radiusTop: 0.04, radius: 0.04, height: 0.08 }, GREY),
    link(w3, "J6 Tool flange", w2, [0, 0.08, 0], R([0, 1, 0], -360, 360, 360)),
    body(w3, "Flange", "cylinder", [0, 0.01, 0], { radiusTop: 0.035, radius: 0.035, height: 0.02 }, STEEL),
  ];
  return { objects: objs, tool: w3, tip: [0, 0.06, 0] };
}

/** A SCARA arm (pick-and-place, 0.6 m reach). */
export function scaraArm(at: Vec3 = [0, 0, 0]): { objects: SceneObject[]; tool: string; tip: Vec3 } {
  const [base, a, b, z, r] = ["base", "j1", "j2", "z", "r"].map((k) => uid(`${k}-`));
  const objs: SceneObject[] = [
    link(base, "SCARA base", undefined, at, null),
    body(base, "Column", "cylinder", [0, 0.2, 0], { radiusTop: 0.08, radius: 0.1, height: 0.4 }, GREY),
    link(a, "J1", base, [0, 0.4, 0], { type: "revolute", axis: [0, 1, 0], min: -130, max: 130, maxVel: 300 }),
    body(a, "Arm 1", "box", [0.16, 0.03, 0], { width: 0.36, height: 0.06, depth: 0.1 }),
    link(b, "J2", a, [0.32, 0, 0], { type: "revolute", axis: [0, 1, 0], min: -145, max: 145, maxVel: 400 }),
    body(b, "Arm 2", "box", [0.14, 0.03, 0], { width: 0.32, height: 0.06, depth: 0.08 }),
    link(z, "Z quill", b, [0.28, -0.05, 0], { type: "prismatic", axis: [0, -1, 0], min: 0, max: 0.2, maxVel: 1 }),
    body(z, "Quill", "cylinder", [0, 0, 0], { radiusTop: 0.015, radius: 0.015, height: 0.25 }, STEEL),
    link(r, "J4 Roll", z, [0, -0.13, 0], { type: "revolute", axis: [0, 1, 0], min: -360, max: 360, maxVel: 600 }),
    body(r, "Tool", "cylinder", [0, -0.015, 0], { radiusTop: 0.03, radius: 0.03, height: 0.03 }, GREY),
  ];
  return { objects: objs, tool: r, tip: [0, -0.04, 0] };
}

/** A two-finger gripper to put on a tool flange. */
export function gripper(parent: string, at: Vec3 = [0, 0.02, 0]): SceneObject[] {
  const [g, l, rr] = ["grip", "fl", "fr"].map((k) => uid(`${k}-`));
  return [
    link(g, "Gripper", parent, at, null),
    body(g, "Gripper body", "box", [0, 0.025, 0], { width: 0.1, height: 0.05, depth: 0.04 }, GREY),
    link(l, "Finger L", g, [-0.03, 0.05, 0], { type: "prismatic", axis: [1, 0, 0], min: -0.02, max: 0.02, maxVel: 0.1 }),
    body(l, "Finger L body", "box", [0, 0.03, 0], { width: 0.012, height: 0.06, depth: 0.03 }, STEEL),
    link(rr, "Finger R", g, [0.03, 0.05, 0], { type: "prismatic", axis: [-1, 0, 0], min: -0.02, max: 0.02, maxVel: 0.1 }),
    body(rr, "Finger R body", "box", [0, 0.03, 0], { width: 0.012, height: 0.06, depth: 0.03 }, STEEL),
  ];
}

export type { Part };
