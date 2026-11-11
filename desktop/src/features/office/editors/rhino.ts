// The 3D editor's Rhino-style command line: type a command (or click its
// button), then give points by clicking in a view or typing x,y,z / @dx,dy,dz,
// and options by typing a value. Enter finishes, Esc cancels, Enter on an
// empty line repeats the last command.

import * as THREE from "three";

import { type CurveDef, curveLength, parsePoint, type SurfaceDef } from "./cad";
import { meshVolume, type Tris } from "./marine";
import type { ModelFile, ObjectKind, Primitive, SceneObject, Vec3 } from "./modelFormat";
import { defaultParams } from "./modelFormat";

export type CmdCtx = {
  model: () => ModelFile;
  selected: () => SceneObject | undefined;
  add: (kind: ObjectKind, label: string, extra?: Partial<SceneObject>) => SceneObject;
  update: (id: string, patch: Partial<SceneObject>, label?: string) => void;
  remove: () => void;
  duplicate: () => void;
  select: (id: string | null) => void;
  tris: (id: string) => Tris | null;
  area: (id: string) => number;
  undo: () => void;
  redo: () => void;
  zoomAll: () => void;
  setLayout: (four: boolean) => void;
  setSnap: (step: number) => void;
  snap: () => number;
  print: (line: string) => void;
};

export type Command = {
  name: string;
  prompt: string;
  /** Points picked so far (for the rubber band). */
  points: Vec3[];
  onPoint?: (p: Vec3, plane: "x" | "y" | "z") => void;
  /** A typed value that isn't a point. Return false if it wasn't understood. */
  onText?: (t: string) => boolean;
  onEnter?: () => void;
  done: boolean;
  /** Clicks pick objects instead of points (Loft). */
  picks?: boolean;
  onPick?: (id: string) => void;
};

export const COMMANDS = [
  "Line", "Polyline", "Curve", "Circle", "Rectangle",
  "Extrude", "Revolve", "Loft", "Pipe",
  "Box", "Sphere", "Cylinder", "Cone", "Torus", "Plane",
  "Move", "Copy", "Rotate", "Scale", "Mirror", "Array",
  "Delete", "Hide", "Show", "Undo", "Redo",
  "Distance", "Length", "Area", "Volume", "BoundingBox",
  "Zoom", "4View", "1View", "Snap",
] as const;

const f3 = (p: Vec3) => p.map((v) => +v.toFixed(4)).join(", ");

/** Start a command by name (case-insensitive). */
export function startCommand(name: string, ctx: CmdCtx): Command | null {
  const n = COMMANDS.find((c) => c.toLowerCase() === name.trim().toLowerCase().split(/\s+/)[0]);
  if (!n) {
    ctx.print(`Unknown command: ${name}`);
    return null;
  }
  const arg = name.trim().split(/\s+/).slice(1).join(" ");
  const cmd: Command = { name: n, prompt: "", points: [], done: false };
  const finish = () => {
    cmd.done = true;
  };
  const sel = ctx.selected();
  const needSel = (what = "an object") => {
    if (!sel) {
      ctx.print(`${n}: select ${what} first.`);
      cmd.done = true;
      return false;
    }
    return true;
  };

  // ── curves ──────────────────────────────────────────────────────────
  if (n === "Line" || n === "Polyline" || n === "Curve") {
    let plane: "x" | "y" | "z" = "y";
    cmd.prompt = n === "Line" ? "Start of line" : "First point";
    const make = (closed: boolean) => {
      const min = n === "Curve" ? 3 : 2;
      if (cmd.points.length < min) {
        ctx.print(`${n}: needs at least ${min} points.`);
        return finish();
      }
      const c: CurveDef = { type: n === "Curve" ? "interp" : "polyline", points: cmd.points, plane, ...(closed ? { closed: true } : {}) };
      const o = ctx.add("curve", n, { curve: c, params: undefined, position: [0, 0, 0] });
      ctx.print(`${n} added (${cmd.points.length} points, ${curveLength(c).toFixed(3)} m).`);
      ctx.select(o.id);
      finish();
    };
    cmd.onPoint = (p, pl) => {
      if (!cmd.points.length) plane = pl;
      cmd.points.push(p);
      if (n === "Line" && cmd.points.length === 2) return make(false);
      cmd.prompt = n === "Line" ? "End of line" : "Next point (Enter to finish, type C to close)";
    };
    cmd.onText = (t) => {
      if (/^c(lose)?$/i.test(t) && n !== "Line") {
        make(true);
        return true;
      }
      return false;
    };
    cmd.onEnter = () => make(false);
    return cmd;
  }
  if (n === "Circle") {
    let plane: "x" | "y" | "z" = "y";
    cmd.prompt = "Centre of circle";
    const make = (r: number) => {
      const c = cmd.points[0];
      const edge: Vec3 = plane === "y" ? [c[0] + r, c[1], c[2]] : plane === "z" ? [c[0] + r, c[1], c[2]] : [c[0], c[1], c[2] + r];
      const o = ctx.add("curve", "Circle", { curve: { type: "circle", points: [c, edge], plane }, params: undefined, position: [0, 0, 0] });
      ctx.print(`Circle added (radius ${r.toFixed(4)} m).`);
      ctx.select(o.id);
      finish();
    };
    cmd.onPoint = (p, pl) => {
      if (!cmd.points.length) {
        plane = pl;
        cmd.points.push(p);
        cmd.prompt = "Radius (click or type a number)";
        return;
      }
      const c = cmd.points[0];
      make(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
    };
    cmd.onText = (t) => {
      const r = Number(t);
      if (cmd.points.length && r > 0) {
        make(r);
        return true;
      }
      return false;
    };
    return cmd;
  }
  if (n === "Rectangle") {
    let plane: "x" | "y" | "z" = "y";
    cmd.prompt = "First corner";
    cmd.onPoint = (p, pl) => {
      if (!cmd.points.length) {
        plane = pl;
        cmd.points.push(p);
        cmd.prompt = "Other corner (or @width,depth)";
        return;
      }
      const o = ctx.add("curve", "Rectangle", { curve: { type: "rect", points: [cmd.points[0], p], plane }, params: undefined, position: [0, 0, 0] });
      ctx.select(o.id);
      ctx.print("Rectangle added.");
      finish();
    };
    return cmd;
  }

  // ── surfaces from curves (with history) ─────────────────────────────
  const surface = (def: SurfaceDef, label: string) => {
    const o = ctx.add("surface", label, { surface: def, params: undefined, position: [0, 0, 0] });
    ctx.select(o.id);
    ctx.print(`${label} made from ${def.curves.length} curve${def.curves.length > 1 ? "s" : ""}: it updates when you change the curve.`);
    finish();
  };
  if (n === "Extrude") {
    if (!needSel("a curve") || sel?.kind !== "curve") {
      if (!cmd.done) ctx.print("Extrude: select a curve first.");
      cmd.done = true;
      return cmd;
    }
    const pl = sel.curve?.plane ?? "y";
    const dirOf = (d: number): Vec3 => (pl === "y" ? [0, d, 0] : pl === "z" ? [0, 0, d] : [d, 0, 0]);
    cmd.prompt = "Extrusion distance <1> (or a direction dx,dy,dz)";
    cmd.onText = (t) => {
      const parts = t.split(/[ ,]+/).map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) surface({ op: "extrude", curves: [sel.id], direction: parts as Vec3, cap: true }, "Extrusion");
      else if (Number.isFinite(parts[0])) surface({ op: "extrude", curves: [sel.id], direction: dirOf(parts[0]), cap: true }, "Extrusion");
      else return false;
      return true;
    };
    cmd.onEnter = () => surface({ op: "extrude", curves: [sel.id], direction: dirOf(1), cap: true }, "Extrusion");
    return cmd;
  }
  if (n === "Revolve") {
    if (sel?.kind !== "curve") {
      ctx.print("Revolve: select a profile curve first.");
      cmd.done = true;
      return cmd;
    }
    let axis: Vec3 = [0, 1, 0];
    cmd.prompt = "Axis X / Y / Z through the origin <Y>, then the angle <360>";
    let gotAxis = false;
    cmd.onText = (t) => {
      if (!gotAxis && /^[xyz]$/i.test(t)) {
        axis = t.toLowerCase() === "x" ? [1, 0, 0] : t.toLowerCase() === "z" ? [0, 0, 1] : [0, 1, 0];
        gotAxis = true;
        cmd.prompt = "Revolution angle <360>";
        return true;
      }
      const a = Number(t);
      if (Number.isFinite(a) && a !== 0) {
        surface({ op: "revolve", curves: [sel.id], axis, axisPoint: [0, 0, 0], angle: a }, "Revolve");
        return true;
      }
      return false;
    };
    cmd.onPoint = (p) => {
      // a point on the axis (vertical through it)
      surface({ op: "revolve", curves: [sel.id], axis, axisPoint: p, angle: 360 }, "Revolve");
    };
    cmd.onEnter = () => surface({ op: "revolve", curves: [sel.id], axis, axisPoint: [0, 0, 0], angle: 360 }, "Revolve");
    return cmd;
  }
  if (n === "Loft") {
    const picked: string[] = [];
    cmd.picks = true;
    cmd.prompt = "Click (or type the names of) the curves to loft through, in order; Enter when done";
    cmd.onPick = (id) => {
      const o = ctx.model().objects.find((x) => x.id === id);
      if (o?.kind !== "curve" || picked.includes(id)) return;
      picked.push(id);
      cmd.prompt = `${picked.length} curve${picked.length > 1 ? "s" : ""}: click the next (Enter to loft)`;
    };
    // or type a curve's name
    cmd.onText = (t) => {
      const o = ctx.model().objects.find((x) => x.kind === "curve" && x.name.toLowerCase() === t.toLowerCase());
      if (!o) return false;
      cmd.onPick?.(o.id);
      return true;
    };
    cmd.onEnter = () => {
      if (picked.length < 2) {
        ctx.print("Loft: pick at least two curves.");
        return finish();
      }
      surface({ op: "loft", curves: picked, cap: false }, "Loft");
    };
    return cmd;
  }
  if (n === "Pipe") {
    if (sel?.kind !== "curve") {
      ctx.print("Pipe: select a curve first.");
      cmd.done = true;
      return cmd;
    }
    cmd.prompt = "Pipe radius <0.05>";
    cmd.onText = (t) => {
      const r = Number(t);
      if (!(r > 0)) return false;
      surface({ op: "pipe", curves: [sel.id], radius: r, cap: true }, "Pipe");
      return true;
    };
    cmd.onEnter = () => surface({ op: "pipe", curves: [sel.id], radius: 0.05, cap: true }, "Pipe");
    return cmd;
  }

  // ── solids ──────────────────────────────────────────────────────────
  const solids: Record<string, Primitive> = { Box: "box", Sphere: "sphere", Cylinder: "cylinder", Cone: "cone", Torus: "torus", Plane: "plane" };
  if (solids[n]) {
    const kind = solids[n];
    cmd.prompt = kind === "box" ? "Base point (then width,height,depth)" : "Centre point";
    let at: Vec3 | null = null;
    const make = (size?: number[]) => {
      const params = { ...defaultParams(kind) };
      if (size?.length) {
        if (kind === "box") Object.assign(params, { width: size[0], height: size[1] ?? size[0], depth: size[2] ?? size[0] });
        else if (kind === "plane") Object.assign(params, { width: size[0], depth: size[1] ?? size[0] });
        else if (kind === "torus") Object.assign(params, { radius: size[0], tube: size[1] ?? size[0] / 4 });
        else Object.assign(params, { radius: size[0], ...(size[1] ? { height: size[1] } : {}) });
      }
      const h = kind === "box" ? (params.height ?? 1) : kind === "sphere" ? (params.radius ?? 0.5) * 2 : kind === "plane" || kind === "torus" ? 0 : (params.height ?? 1);
      const base = at ?? [0, 0, 0];
      const o = ctx.add(kind, n, { params, position: [base[0], base[1] + h / 2, base[2]] });
      ctx.select(o.id);
      finish();
    };
    if (arg) {
      const nums = arg.split(/[ ,]+/).map(Number).filter(Number.isFinite);
      make(nums);
      return cmd;
    }
    cmd.onPoint = (p) => {
      at = p;
      cmd.prompt = kind === "box" ? "Size: width,height,depth <1,1,1>" : kind === "plane" ? "Size: width,depth" : kind === "torus" ? "Radius,tube" : kind === "sphere" ? "Radius <0.5>" : "Radius,height";
    };
    cmd.onText = (t) => {
      const nums = t.split(/[ ,]+/).map(Number);
      if (!nums.length || nums.some((x) => !(x > 0))) return false;
      make(nums);
      return true;
    };
    cmd.onEnter = () => make();
    return cmd;
  }

  // ── transforms ──────────────────────────────────────────────────────
  if (n === "Move" || n === "Copy") {
    if (!needSel()) return cmd;
    cmd.prompt = "Point to move from";
    cmd.onPoint = (p) => {
      cmd.points.push(p);
      if (cmd.points.length === 1) {
        cmd.prompt = "Point to move to (or @dx,dy,dz)";
        return;
      }
      const [a, b] = cmd.points;
      const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      if (n === "Copy") ctx.duplicate();
      const target = ctx.selected();
      if (target) ctx.update(target.id, { position: [target.position[0] + d[0], target.position[1] + d[1], target.position[2] + d[2]] }, n);
      ctx.print(`${n}d by ${f3(d)} m.`);
      finish();
    };
    return cmd;
  }
  if (n === "Rotate") {
    if (!needSel()) return cmd;
    cmd.prompt = "Angle about the vertical axis (°), or X/Y/Z then angle";
    let axis = 1;
    cmd.onText = (t) => {
      if (/^[xyz]$/i.test(t)) {
        axis = "xyz".indexOf(t.toLowerCase());
        cmd.prompt = `Angle about ${t.toUpperCase()} (°)`;
        return true;
      }
      const a = Number(t);
      if (!Number.isFinite(a)) return false;
      const r = [...(sel as SceneObject).rotation] as Vec3;
      r[axis] += a;
      ctx.update((sel as SceneObject).id, { rotation: r }, "Rotate");
      finish();
      return true;
    };
    return cmd;
  }
  if (n === "Scale") {
    if (!needSel()) return cmd;
    cmd.prompt = "Scale factor (or sx,sy,sz)";
    cmd.onText = (t) => {
      const nums = t.split(/[ ,]+/).map(Number);
      if (!nums.length || nums.some((x) => !Number.isFinite(x) || x === 0)) return false;
      const k = nums.length === 3 ? nums : [nums[0], nums[0], nums[0]];
      ctx.update((sel as SceneObject).id, { scale: [(sel as SceneObject).scale[0] * k[0], (sel as SceneObject).scale[1] * k[1], (sel as SceneObject).scale[2] * k[2]] }, "Scale");
      finish();
      return true;
    };
    return cmd;
  }
  if (n === "Mirror") {
    if (!needSel()) return cmd;
    cmd.prompt = "Mirror across the X, Y or Z plane through the origin <X> (a copy)";
    const go = (axis: number) => {
      ctx.duplicate();
      const c = ctx.selected();
      if (!c) return finish();
      const s = [...c.scale] as Vec3;
      s[axis] = -s[axis];
      const p = [...c.position] as Vec3;
      p[axis] = -p[axis];
      ctx.update(c.id, { scale: s, position: p }, "Mirror");
      finish();
    };
    cmd.onText = (t) => {
      if (!/^[xyz]$/i.test(t)) return false;
      go("xyz".indexOf(t.toLowerCase()));
      return true;
    };
    cmd.onEnter = () => go(0);
    return cmd;
  }
  if (n === "Array") {
    if (!needSel()) return cmd;
    cmd.prompt = "Count and spacing: n, dx,dy,dz <3, 1,0,0>";
    const go = (nums: number[]) => {
      const count = Math.max(1, Math.round(nums[0] ?? 3));
      const off: Vec3 = [nums[1] ?? 1, nums[2] ?? 0, nums[3] ?? 0];
      ctx.update((sel as SceneObject).id, { array: { count, offset: off } }, "Array");
      finish();
    };
    cmd.onText = (t) => {
      const nums = t.split(/[ ,]+/).map(Number);
      if (nums.some((x) => !Number.isFinite(x))) return false;
      go(nums);
      return true;
    };
    cmd.onEnter = () => go([]);
    return cmd;
  }

  // ── edit / view ─────────────────────────────────────────────────────
  if (n === "Delete") {
    if (needSel()) ctx.remove();
    return { ...cmd, done: true };
  }
  if (n === "Hide") {
    if (needSel()) ctx.update((sel as SceneObject).id, { visible: false }, "Hide");
    return { ...cmd, done: true };
  }
  if (n === "Show") {
    for (const o of ctx.model().objects) if (!o.visible) ctx.update(o.id, { visible: true });
    ctx.print("Everything is shown.");
    return { ...cmd, done: true };
  }
  if (n === "Undo") return (ctx.undo(), { ...cmd, done: true });
  if (n === "Redo") return (ctx.redo(), { ...cmd, done: true });
  if (n === "Zoom") return (ctx.zoomAll(), { ...cmd, done: true });
  if (n === "4View") return (ctx.setLayout(true), { ...cmd, done: true });
  if (n === "1View") return (ctx.setLayout(false), { ...cmd, done: true });
  if (n === "Snap") {
    cmd.prompt = `Grid snap step in m (0 = off) <${ctx.snap()}>`;
    cmd.onText = (t) => {
      const v = Number(t);
      if (!(v >= 0)) return false;
      ctx.setSnap(v);
      ctx.print(v ? `Snapping to ${v} m.` : "Snap off.");
      finish();
      return true;
    };
    if (arg) cmd.onText(arg);
    return cmd;
  }

  // ── analysis ────────────────────────────────────────────────────────
  if (n === "Distance") {
    cmd.prompt = "First point";
    cmd.onPoint = (p) => {
      cmd.points.push(p);
      if (cmd.points.length < 2) {
        cmd.prompt = "Second point";
        return;
      }
      const [a, b] = cmd.points;
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      ctx.print(`Distance ${Math.hypot(d[0], d[1], d[2]).toFixed(4)} m (Δx ${d[0].toFixed(4)}, Δy ${d[1].toFixed(4)}, Δz ${d[2].toFixed(4)}).`);
      finish();
    };
    return cmd;
  }
  if (n === "Length") {
    if (sel?.kind === "curve" && sel.curve) ctx.print(`Length of ${sel.name}: ${(curveLength(sel.curve) * Math.abs(sel.scale[0])).toFixed(4)} m.`);
    else ctx.print("Length: select a curve.");
    return { ...cmd, done: true };
  }
  if (n === "Area") {
    if (needSel()) ctx.print(`Surface area of ${sel?.name}: ${ctx.area(sel?.id ?? "").toFixed(4)} m².`);
    return { ...cmd, done: true };
  }
  if (n === "Volume") {
    if (needSel()) {
      const t = ctx.tris(sel?.id ?? "");
      const v = t ? meshVolume(t) : 0;
      ctx.print(`Volume of ${sel?.name}: ${Math.abs(v).toFixed(5)} m³${Math.abs(v) < 1e-9 ? " (open surface: no volume)" : ""}.`);
    }
    return { ...cmd, done: true };
  }
  if (n === "BoundingBox") {
    if (needSel()) {
      const t = ctx.tris(sel?.id ?? "");
      if (t?.length) {
        const b = new THREE.Box3();
        for (let k = 0; k < t.length; k += 3) b.expandByPoint(new THREE.Vector3(t[k], t[k + 1], t[k + 2]));
        const s = b.getSize(new THREE.Vector3());
        ctx.print(`${sel?.name}: ${s.x.toFixed(4)} × ${s.y.toFixed(4)} × ${s.z.toFixed(4)} m (x × y × z), from ${f3([b.min.x, b.min.y, b.min.z])}.`);
      }
    }
    return { ...cmd, done: true };
  }
  return null;
}

/** Feed typed text to a running command: a point, an option or a value. */
export function feed(cmd: Command, text: string, plane: "x" | "y" | "z"): boolean {
  const t = text.trim();
  if (!t) return false;
  if (cmd.onText?.(t)) return true;
  if (cmd.onPoint) {
    const p = parsePoint(t, cmd.points.at(-1) ?? null, plane);
    if (p) {
      cmd.onPoint(p, plane);
      return true;
    }
  }
  return false;
}
