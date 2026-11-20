import * as THREE from "three";
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { BooleanDef, ModelFile, SceneObject } from "./modelFormat";

/**
 * The 3D editor's modelling operations beyond primitives:
 * - rounded edges on a box (`params.bevel`, metres),
 * - smoothing any shape (`params.smooth`, 0–3 rounds of subdivide + relax),
 * - cut / join / intersect between two parts (a "boolean" object that keeps
 *   links to both, so moving the cutter re-cuts, like a surface keeps its curves).
 */

const D2R = Math.PI / 180;

/** A box with rounded edges and corners. */
export function roundedBox(w: number, h: number, d: number, bevel: number): THREE.BufferGeometry {
  const r = Math.max(0, Math.min(bevel, Math.min(w, h, d) / 2 - 1e-4));
  return new RoundedBoxGeometry(w, h, d, 4, r);
}

/** Smooth a shape: each round splits every triangle in four, then pulls each
 *  point halfway to the middle of its neighbours (rounded, still its size). */
export function smoothGeometry(src: THREE.BufferGeometry, rounds: number): THREE.BufferGeometry {
  const n = Math.max(0, Math.min(3, Math.round(rounds)));
  if (!n) return src;
  let g = src.index ? src.toNonIndexed() : src.clone();
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g, 1e-5);
  for (let r = 0; r < n; r++) {
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const index = g.getIndex();
    if (!index) break;
    const points: number[] = Array.from(pos.array as Float32Array);
    const tris = Array.from(index.array as ArrayLike<number>);
    const mid = new Map<string, number>();
    const midOf = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mid.get(key);
      if (i === undefined) {
        i = points.length / 3;
        points.push(
          (points[a * 3] + points[b * 3]) / 2,
          (points[a * 3 + 1] + points[b * 3 + 1]) / 2,
          (points[a * 3 + 2] + points[b * 3 + 2]) / 2,
        );
        mid.set(key, i);
      }
      return i;
    };
    const next: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const ab = midOf(a, b), bc = midOf(b, c), ca = midOf(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    // Relax with Taubin smoothing (a shrink step, then an inflate step, six
    // times), each point against its UNIQUE neighbours. Counting a neighbour
    // once per shared triangle weighted rim edges unevenly and creased
    // smoothed discs and cylinders into spikes; this matches the agents'
    // own evaluator (subdivide + Taubin), so the app and their renders agree.
    const count = points.length / 3;
    const nbr: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
    for (let t = 0; t < next.length; t += 3) {
      const a = next[t], b = next[t + 1], c = next[t + 2];
      nbr[a].add(b).add(c);
      nbr[b].add(a).add(c);
      nbr[c].add(a).add(b);
    }
    const lists = nbr.map((set) => [...set]);
    const step = (factor: number) => {
      const moved = points.slice();
      for (let i = 0; i < count; i++) {
        const ns = lists[i];
        if (!ns.length) continue;
        for (let j = 0; j < 3; j++) {
          let avg = 0;
          for (const q of ns) avg += points[q * 3 + j];
          avg /= ns.length;
          moved[i * 3 + j] = points[i * 3 + j] + factor * (avg - points[i * 3 + j]);
        }
      }
      for (let i = 0; i < moved.length; i++) points[i] = moved[i];
    };
    for (let it = 0; it < 6; it++) {
      step(0.5);
      step(-0.53);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    out.setIndex(next);
    g = out;
  }
  g.computeVertexNormals();
  return g;
}

function poseMatrix(o: SceneObject): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(...o.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation[0] * D2R, o.rotation[1] * D2R, o.rotation[2] * D2R)),
    new THREE.Vector3(...o.scale),
  );
  return m;
}

const OPS = { subtract: SUBTRACTION, union: ADDITION, intersect: INTERSECTION } as const;

/**
 * The shape of a cut / join / intersect, in the scene's space: part A with
 * part B taken away, added, or kept only where they overlap. Parts are drawn
 * through `shapeOf`, so a boolean can use another boolean.
 */
export function booleanGeometry(
  def: BooleanDef,
  file: ModelFile,
  shapeOf: (o: SceneObject) => THREE.BufferGeometry | null,
  depth = 0,
): THREE.BufferGeometry | null {
  if (depth > 6) return null;
  // Cut / join / intersect is heavy (seconds on a detailed part) and ran on
  // every redraw source: each new version of a file an agent writes, each
  // open view of it (editor, live stream, preview). The result only depends
  // on the operation and the two parts (and, for a part that is itself a
  // boolean, its own parts), so it is computed once per shape and copied.
  const key = booleanKey(def, file, depth);
  const hit = key ? CSG_CACHE.get(key) : undefined;
  if (hit) {
    CSG_CACHE.delete(key!);
    CSG_CACHE.set(key!, hit);
    return hit.clone();
  }
  const made = computeBoolean(def, file, shapeOf);
  if (key && made) {
    CSG_CACHE.set(key, made);
    while (CSG_CACHE.size > 48) {
      const old = CSG_CACHE.keys().next().value as string;
      CSG_CACHE.get(old)?.dispose();
      CSG_CACHE.delete(old);
    }
    return made.clone();
  }
  return made;
}

const CSG_CACHE = new Map<string, THREE.BufferGeometry>();

/** What a boolean's shape depends on: the operation and both parts, with a
 *  part that is itself a boolean described by its own parts in turn. */
function booleanKey(def: BooleanDef, file: ModelFile, depth: number): string | null {
  const byId = new Map(file.objects.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const sig = (id: string, d: number): string => {
    const o = byId.get(id);
    if (!o || d > 8 || seen.has(id)) return `?${id}`;
    seen.add(id);
    const own = JSON.stringify(o);
    const sub = o.kind === "boolean" && o.boolean ? `[${sig(o.boolean.a, d + 1)}|${sig(o.boolean.b, d + 1)}]` : "";
    seen.delete(id);
    return own + sub;
  };
  try {
    return `${depth}:${JSON.stringify(def)}:${sig(def.a, 0)}:${sig(def.b, 0)}`;
  } catch {
    return null;
  }
}

function computeBoolean(
  def: BooleanDef,
  file: ModelFile,
  shapeOf: (o: SceneObject) => THREE.BufferGeometry | null,
): THREE.BufferGeometry | null {
  const a = file.objects.find((o) => o.id === def.a);
  const b = file.objects.find((o) => o.id === def.b);
  if (!a || !b || a.id === b.id) return null;
  const ga = shapeOf(a);
  const gb = shapeOf(b);
  if (!ga || !gb) return null;
  const prep = (g: THREE.BufferGeometry) => {
    const x = g.index ? g : g.clone();
    if (!x.getAttribute("uv")) {
      const n = x.getAttribute("position").count;
      x.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (!x.getAttribute("normal")) x.computeVertexNormals();
    return x;
  };
  const ba = new Brush(prep(ga));
  ba.applyMatrix4(poseMatrix(a));
  ba.updateMatrixWorld();
  const bb = new Brush(prep(gb));
  bb.applyMatrix4(poseMatrix(b));
  bb.updateMatrixWorld();
  const result = new Evaluator().evaluate(ba, bb, OPS[def.op] ?? SUBTRACTION);
  return result.geometry;
}
