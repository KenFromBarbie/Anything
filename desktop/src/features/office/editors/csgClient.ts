import * as THREE from "three";

import type { ModelFile, SceneObject } from "./modelFormat";

/**
 * Deep chains of cuts (a hull with dozens of cut-outs, each on the one before)
 * take far too long to compute on the page without freezing it. They go to a
 * background worker; the shape is added to the scene when it's ready. Results
 * are kept per shape, so reopening the file is instant.
 */
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (g: THREE.BufferGeometry | null) => void>();
const done = new Map<string, Promise<THREE.BufferGeometry | null>>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./csgWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; position: Float32Array | null; normal: Float32Array | null }>) => {
    const { id, position, normal } = e.data;
    const resolve = waiting.get(id);
    waiting.delete(id);
    if (!resolve) return;
    if (!position) return resolve(null);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(position, 3));
    if (normal) g.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    else g.computeVertexNormals();
    resolve(g);
  };
  return worker;
}

export function booleanInBackground(o: SceneObject, file: ModelFile): Promise<THREE.BufferGeometry | null> {
  let key: string;
  try {
    key = JSON.stringify([o.id, o.boolean, file.objects]);
  } catch {
    return Promise.resolve(null);
  }
  const hit = done.get(key);
  if (hit) return hit.then((g) => g?.clone() ?? null);
  const p = new Promise<THREE.BufferGeometry | null>((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    try {
      getWorker().postMessage({ id, objId: o.id, file });
    } catch {
      waiting.delete(id);
      resolve(null);
    }
  });
  done.set(key, p);
  while (done.size > 24) done.delete(done.keys().next().value as string);
  return p.then((g) => g?.clone() ?? null);
}
