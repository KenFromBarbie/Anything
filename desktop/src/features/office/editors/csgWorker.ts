/// <reference lib="webworker" />
// Computes deep chains of booleans off the page (see csgClient.ts).
import type { ModelFile } from "./modelFormat";
import { shapeOf } from "./modelEngine";
import { setBooleanDepthLimit } from "./modelOps";

setBooleanDepthLimit(80);

self.onmessage = (e: MessageEvent<{ id: number; objId: string; file: ModelFile }>) => {
  const { id, objId, file } = e.data;
  try {
    const o = file.objects.find((x) => x.id === objId);
    const g0 = o ? shapeOf({ ...o, params: { ...(o.params ?? {}), smooth: 0 } }, file) : null;
    if (!g0) return (self as unknown as Worker).postMessage({ id, position: null, normal: null });
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const position = new Float32Array(g.getAttribute("position").array as ArrayLike<number>);
    const normal = new Float32Array(g.getAttribute("normal").array as ArrayLike<number>);
    (self as unknown as Worker).postMessage({ id, position, normal }, [position.buffer, normal.buffer]);
  } catch {
    (self as unknown as Worker).postMessage({ id, position: null, normal: null });
  }
};
