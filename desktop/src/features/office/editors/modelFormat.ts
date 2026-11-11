import type { CurveDef, SurfaceDef } from "./cad";
import type { JointDef, RobotProgram } from "./robotics";
import type { FrameStudy } from "./frameFea";
import type { PrintSettings } from "./slicer";

// The 3D editor's scene file (.model.json): objects (primitives and imported
// models) with transforms, materials, keyframes and physics, like a small
// Blender scene. Imported models stay files; the scene points at them.

export const PRIMITIVES = ["box", "sphere", "cylinder", "cone", "torus", "plane", "capsule", "icosphere"] as const;
export type Primitive = (typeof PRIMITIVES)[number];
export type ObjectKind = Primitive | "import" | "empty" | "hull" | "curve" | "surface";

/** A parametric hull (the Marine workspace). */
export type HullShape = {
  type: "planing" | "round";
  length: number;
  beam: number;
  depth: number;
  deadriseAft: number;
  deadriseFwd: number;
  transom: number;
  entry: number;
  keelRise: number;
  sheerRise: number;
  flare: number;
  bilge: number;
};

export type Vec3 = [number, number, number];

export type Material = {
  color: string;
  metalness: number; // 0–1
  roughness: number; // 0–1
  opacity: number; // 0–1
  emissive?: string;
  emissiveIntensity?: number;
  wireframe?: boolean;
  flat?: boolean;
};

/** Shape settings per primitive (metres; segments). */
export type Params = {
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  radiusTop?: number;
  tube?: number;
  segments?: number;
};

export type ObjKey = { f: number; position?: Vec3; rotation?: Vec3; scale?: Vec3 };

export type SceneObject = {
  id: string;
  name: string;
  kind: ObjectKind;
  parent?: string;
  visible: boolean;
  position: Vec3;
  /** degrees */
  rotation: Vec3;
  scale: Vec3;
  params?: Params;
  material?: Material;
  /** kind "import": a .glb/.gltf/.obj/.stl file (absolute path in the
   *  office's shared artifacts/_media folder, or https). */
  src?: string;
  /** Array modifier. */
  array?: { count: number; offset: Vec3 };
  /** Rigid body for the Simulation workspace. */
  physics?: { type: "active" | "passive"; mass: number; bounce: number; friction: number };
  /** Keyframes (frames). */
  keys?: ObjKey[];
  /** kind "hull": its shape. */
  hull?: HullShape;
  /** kind "curve" / "surface" (Rhino-style modeling, with history). */
  curve?: CurveDef;
  surface?: SurfaceDef;
  /** Its mass (kg) for weights & hydrostatics, and its centre of gravity
   *  (defaults to the middle of the object). */
  mass?: number;
  cg?: Vec3;
  /** A joint on this link (robots and mechanisms): it turns or slides about
   *  an axis in its own frame, relative to its parent. */
  joint?: JointDef;
};

export type ModelFile = {
  type: "model";
  version: 1;
  fps: number;
  frameStart: number;
  frameEnd: number;
  world: { background: string; sun: number; ambient: number; ground: boolean; grid: boolean };
  objects: SceneObject[];
  /** What the Clothing / Simulation workspaces were set to (so a request
   *  and its result stay together). */
  studies?: {
    clothing?: Record<string, string | number>;
    simulation?: Record<string, string | number>;
    /** The Robotics workspace's program. */
    robot?: RobotProgram;
    /** The Structure workspace's frame analysis setup. */
    structure?: FrameStudy;
    /** The Print workspace's slicer settings. */
    print?: Partial<PrintSettings>;
  };
  preview?: string;
};

export function oid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const DEFAULT_MATERIAL: Material = { color: "#c8c8c8", metalness: 0, roughness: 0.55, opacity: 1 };

export function defaultParams(kind: ObjectKind): Params {
  switch (kind) {
    case "box":
      return { width: 1, height: 1, depth: 1 };
    case "sphere":
      return { radius: 0.5, segments: 32 };
    case "icosphere":
      return { radius: 0.5, segments: 2 };
    case "cylinder":
      return { radius: 0.5, radiusTop: 0.5, height: 1, segments: 32 };
    case "cone":
      return { radius: 0.5, height: 1, segments: 32 };
    case "torus":
      return { radius: 0.5, tube: 0.18, segments: 32 };
    case "plane":
      return { width: 2, depth: 2 };
    case "capsule":
      return { radius: 0.3, height: 1, segments: 16 };
    default:
      return {};
  }
}

export function blankModel(): ModelFile {
  return {
    type: "model",
    version: 1,
    fps: 24,
    frameStart: 1,
    frameEnd: 120,
    world: { background: "#3a3a3a", sun: 45, ambient: 0.6, ground: false, grid: true },
    objects: [
      {
        id: oid(),
        name: "Cube",
        kind: "box",
        visible: true,
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        params: defaultParams("box"),
        material: { ...DEFAULT_MATERIAL },
      },
    ],
  };
}

const num = (v: unknown, d: number, lo = -1e6, hi = 1e6) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const vec = (v: unknown, d: Vec3): Vec3 =>
  Array.isArray(v) && v.length === 3 ? [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])] : [...d];
const color = (v: unknown, d: string) =>
  typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : d;

/** Read a saved (or agent-written) scene, filling in what's missing. */
export function parseModel(value: unknown): ModelFile {
  const v = (value ?? {}) as Record<string, unknown>;
  const base = blankModel();
  const w = (v.world ?? {}) as Record<string, unknown>;
  const objects: SceneObject[] = [];
  const kinds = [...PRIMITIVES, "import", "empty", "hull", "curve", "surface"] as string[];
  for (const raw of Array.isArray(v.objects) ? v.objects : []) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const kind = (kinds.includes(String(o.kind)) ? o.kind : "box") as ObjectKind;
    if (kind === "import" && (typeof o.src !== "string" || !o.src || /^(javascript|file):/i.test(o.src))) continue;
    const m = (o.material ?? {}) as Record<string, unknown>;
    const p = (o.params ?? {}) as Record<string, unknown>;
    const params: Params = {};
    for (const [k, d] of Object.entries(defaultParams(kind))) {
      (params as Record<string, number>)[k] = num(p[k], d as number, 0, 10000);
    }
    const ph = o.physics as Record<string, unknown> | undefined;
    const arr = o.array as Record<string, unknown> | undefined;
    objects.push({
      id: typeof o.id === "string" && o.id ? o.id : oid(),
      name: typeof o.name === "string" ? o.name.slice(0, 80) : kind,
      kind,
      ...(typeof o.parent === "string" ? { parent: o.parent } : {}),
      visible: o.visible !== false,
      position: vec(o.position, [0, 0, 0]),
      rotation: vec(o.rotation, [0, 0, 0]),
      scale: vec(o.scale, [1, 1, 1]),
      ...(Object.keys(params).length ? { params } : {}),
      material: {
        color: color(m.color, DEFAULT_MATERIAL.color),
        metalness: num(m.metalness, 0, 0, 1),
        roughness: num(m.roughness, 0.55, 0, 1),
        opacity: num(m.opacity, 1, 0, 1),
        ...(m.emissive ? { emissive: color(m.emissive, "#000000"), emissiveIntensity: num(m.emissiveIntensity, 1, 0, 50) } : {}),
        ...(m.wireframe === true ? { wireframe: true } : {}),
        ...(m.flat === true ? { flat: true } : {}),
      },
      ...(kind === "import" ? { src: String(o.src) } : {}),
      ...(kind === "hull" ? { hull: parseHull(o.hull) } : {}),
      ...(o.joint && typeof o.joint === "object" ? { joint: parseJoint(o.joint) } : {}),
      ...(kind === "curve" ? { curve: parseCurve(o.curve) } : {}),
      ...(kind === "surface" ? { surface: parseSurface(o.surface) } : {}),
      ...(o.mass != null && num(o.mass, 0, 0, 1e9) > 0 ? { mass: num(o.mass, 0, 0, 1e9) } : {}),
      ...(o.cg != null ? { cg: vec(o.cg, [0, 0, 0]) } : {}),
      ...(arr ? { array: { count: Math.round(num(arr.count, 1, 1, 200)), offset: vec(arr.offset, [1.2, 0, 0]) } } : {}),
      ...(ph
        ? {
            physics: {
              type: ph.type === "passive" ? "passive" : "active",
              mass: num(ph.mass, 1, 0.001, 1e6),
              bounce: num(ph.bounce, 0.3, 0, 1),
              friction: num(ph.friction, 0.5, 0, 1),
            },
          }
        : {}),
      ...(Array.isArray(o.keys)
        ? {
            keys: (o.keys as Record<string, unknown>[])
              .map((k) => ({
                f: Math.round(num(k?.f, 1, 0, 100000)),
                ...(k?.position ? { position: vec(k.position, [0, 0, 0]) } : {}),
                ...(k?.rotation ? { rotation: vec(k.rotation, [0, 0, 0]) } : {}),
                ...(k?.scale ? { scale: vec(k.scale, [1, 1, 1]) } : {}),
              }))
              .sort((a, b) => a.f - b.f),
          }
        : {}),
    });
  }
  return {
    type: "model",
    version: 1,
    fps: Math.round(num(v.fps, 24, 1, 120)),
    frameStart: Math.round(num(v.frameStart, 1, 0, 100000)),
    frameEnd: Math.round(num(v.frameEnd, 120, 1, 100000)),
    world: {
      background: color(w.background, base.world.background),
      sun: num(w.sun, 45, 0, 90),
      ambient: num(w.ambient, 0.6, 0, 5),
      ground: w.ground === true,
      grid: w.grid !== false,
    },
    objects: objects.length || Array.isArray(v.objects) ? objects : base.objects,
    ...(v.studies && typeof v.studies === "object" ? { studies: v.studies as ModelFile["studies"] } : {}),
    preview: typeof v.preview === "string" && v.preview.startsWith("data:image/") ? v.preview : undefined,
  };
}

export const DEFAULT_HULL_SHAPE: HullShape = {
  type: "planing",
  length: 6,
  beam: 2.2,
  depth: 1.1,
  deadriseAft: 16,
  deadriseFwd: 40,
  transom: 0.9,
  entry: 1.8,
  keelRise: 0.55,
  sheerRise: 0.25,
  flare: 12,
  bilge: 2.5,
};

function parseCurve(v: unknown): CurveDef {
  const c = (v ?? {}) as Record<string, unknown>;
  const type = (["polyline", "interp", "circle", "rect"].includes(String(c.type)) ? c.type : "polyline") as CurveDef["type"];
  const points = (Array.isArray(c.points) ? c.points : []).slice(0, 2000).map((p) => vec(p, [0, 0, 0]));
  return {
    type,
    points: points.length ? points : [[0, 0, 0], [1, 0, 0]],
    ...(c.closed === true ? { closed: true } : {}),
    ...(c.plane === "x" || c.plane === "z" || c.plane === "y" ? { plane: c.plane } : {}),
  };
}

function parseSurface(v: unknown): SurfaceDef {
  const s = (v ?? {}) as Record<string, unknown>;
  const op = (["extrude", "revolve", "loft", "pipe"].includes(String(s.op)) ? s.op : "extrude") as SurfaceDef["op"];
  return {
    op,
    curves: Array.isArray(s.curves) ? s.curves.map(String).slice(0, 200) : [],
    ...(s.direction != null ? { direction: vec(s.direction, [0, 1, 0]) } : {}),
    ...(s.angle != null ? { angle: num(s.angle, 360, -360, 360) } : {}),
    ...(s.axis != null ? { axis: vec(s.axis, [0, 1, 0]) } : {}),
    ...(s.axisPoint != null ? { axisPoint: vec(s.axisPoint, [0, 0, 0]) } : {}),
    ...(s.radius != null ? { radius: num(s.radius, 0.05, 0.0001, 1000) } : {}),
    ...(s.cap != null ? { cap: s.cap !== false } : {}),
  };
}

function parseJoint(v: unknown): JointDef {
  const j = (v ?? {}) as Record<string, unknown>;
  const type = (["revolute", "prismatic", "fixed"].includes(String(j.type)) ? j.type : "revolute") as JointDef["type"];
  const h = (j.home ?? {}) as Record<string, unknown>;
  const lim = type === "prismatic" ? 100 : 3600;
  const min = num(j.min, type === "prismatic" ? 0 : -180, -lim, lim);
  const max = num(j.max, type === "prismatic" ? 0.5 : 180, -lim, lim);
  return {
    type,
    axis: vec(j.axis, [0, 1, 0]),
    min: Math.min(min, max),
    max: Math.max(min, max),
    value: num(j.value, 0, -lim, lim),
    home: { position: vec(h.position, [0, 0, 0]), rotation: vec(h.rotation, [0, 0, 0]) },
    ...(j.maxVel != null ? { maxVel: num(j.maxVel, 90, 0.001, 10000) } : {}),
  };
}

function parseHull(v: unknown): HullShape {
  const h = (v ?? {}) as Record<string, unknown>;
  const d = DEFAULT_HULL_SHAPE;
  return {
    type: h.type === "round" ? "round" : "planing",
    length: num(h.length, d.length, 0.5, 500),
    beam: num(h.beam, d.beam, 0.1, 100),
    depth: num(h.depth, d.depth, 0.1, 60),
    deadriseAft: num(h.deadriseAft, d.deadriseAft, 0, 45),
    deadriseFwd: num(h.deadriseFwd, d.deadriseFwd, 0, 70),
    transom: num(h.transom, d.transom, 0.05, 1),
    entry: num(h.entry, d.entry, 1.05, 5),
    keelRise: num(h.keelRise, d.keelRise, 0, 1),
    sheerRise: num(h.sheerRise, d.sheerRise, 0, 20),
    flare: num(h.flare, d.flare, 0, 40),
    bilge: num(h.bilge, d.bilge, 2, 10),
  };
}

/** An object's transform at frame `f` (keyframes, linear). */
export function poseAt(o: SceneObject, f: number): { position: Vec3; rotation: Vec3; scale: Vec3 } {
  const out = { position: o.position, rotation: o.rotation, scale: o.scale };
  if (!o.keys?.length) return out;
  for (const prop of ["position", "rotation", "scale"] as const) {
    const ks = o.keys.filter((k) => k[prop]);
    if (!ks.length) continue;
    if (f <= ks[0].f) out[prop] = ks[0][prop] as Vec3;
    else if (f >= ks[ks.length - 1].f) out[prop] = ks[ks.length - 1][prop] as Vec3;
    else {
      for (let i = 1; i < ks.length; i++) {
        if (f <= ks[i].f) {
          const a = ks[i - 1];
          const b = ks[i];
          const t = (f - a.f) / Math.max(1e-6, b.f - a.f);
          const av = a[prop] as Vec3;
          const bv = b[prop] as Vec3;
          out[prop] = [0, 1, 2].map((j) => av[j] + (bv[j] - av[j]) * t) as Vec3;
          break;
        }
      }
    }
  }
  return out;
}

export const MODEL_SPEC =
  'JSON: {"type":"model","version":1,"fps":24,"frameStart":1,"frameEnd":120,"world":{"background":"#3a3a3a","sun":45,"ambient":0.6,"ground":false,"grid":true},"objects":[…]}. Units are metres, Y is up. An object: {"id","name","kind":"box|sphere|icosphere|cylinder|cone|torus|plane|capsule|import|empty","parent":"<id> (optional)","visible":true,"position":[x,y,z],"rotation":[deg,deg,deg],"scale":[1,1,1],"params":{"width","height","depth","radius","radiusTop","tube","segments"},"material":{"color":"#hex","metalness":0–1,"roughness":0–1,"opacity":0–1,"emissive":"#hex"},"array":{"count":4,"offset":[1.2,0,0]} (optional),"keys":[{"f":1,"position":[…],"rotation":[…],"scale":[…]}] (optional keyframes)}. For anything made elsewhere (simkit results, Blender, three.js), copy the .glb into the shared workspace\'s artifacts/_media folder and add {"kind":"import","src":"<its absolute path>"}; its own animation plays. A boat hull can be {"kind":"hull","hull":{"type":"planing|round","length","beam","depth","deadriseAft","deadriseFwd","transom":0–1,"entry":1–4,"keelRise":0–1,"sheerRise","flare","bilge"}} (transom at x=0, bow at +x, z to starboard), and any object can carry "mass" (kg) and "cg":[x,y,z] for the Marine workspace: weights, hydrostatics, stability and resistance. Curves: {"kind":"curve","curve":{"type":"polyline|interp|circle|rect","points":[[x,y,z],…],"closed":false,"plane":"y"}} (circle: [centre, a point on it]; rect: two corners). Surfaces built from curves keep their history: {"kind":"surface","surface":{"op":"extrude|revolve|loft|pipe","curves":["<curve id>",…],"direction":[0,1,0],"angle":360,"axis":[0,1,0],"axisPoint":[0,0,0],"radius":0.05,"cap":true}}. Keep separate parts as separate objects so the owner can keep editing them.';
