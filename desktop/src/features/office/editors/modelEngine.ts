// The 3D editor's viewport: a three.js scene kept in step with a ModelFile,
// with Blender-like navigation, a move/rotate/scale gizmo, keyframe playback,
// a rigid-body bake and GLB / STL export.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

import { mediaUrl } from "./videoEngine";
import {
  DEFAULT_MATERIAL,
  type ModelFile,
  type ObjKey,
  poseAt,
  type SceneObject,
  type Vec3,
} from "./modelFormat";

const D2R = Math.PI / 180;

export type GizmoMode = "translate" | "rotate" | "scale";
export type Shading = "solid" | "material" | "wireframe";

type Loaded = { root: THREE.Object3D; clips: THREE.AnimationClip[] };

export function geometryOf(o: SceneObject): THREE.BufferGeometry | null {
  const p = o.params ?? {};
  const seg = Math.max(3, Math.round(p.segments ?? 32));
  switch (o.kind) {
    case "box":
      return new THREE.BoxGeometry(p.width ?? 1, p.height ?? 1, p.depth ?? 1);
    case "sphere":
      return new THREE.SphereGeometry(p.radius ?? 0.5, seg, Math.max(2, Math.round(seg / 2)));
    case "icosphere":
      return new THREE.IcosahedronGeometry(p.radius ?? 0.5, Math.min(6, Math.max(0, Math.round(p.segments ?? 2))));
    case "cylinder":
      return new THREE.CylinderGeometry(p.radiusTop ?? p.radius ?? 0.5, p.radius ?? 0.5, p.height ?? 1, seg);
    case "cone":
      return new THREE.ConeGeometry(p.radius ?? 0.5, p.height ?? 1, seg);
    case "torus":
      return new THREE.TorusGeometry(p.radius ?? 0.5, p.tube ?? 0.18, Math.max(3, Math.round(seg / 2)), seg);
    case "plane": {
      const g = new THREE.PlaneGeometry(p.width ?? 2, p.depth ?? 2);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case "capsule":
      return new THREE.CapsuleGeometry(p.radius ?? 0.3, p.height ?? 1, 8, seg);
    default:
      return null;
  }
}

function materialOf(o: SceneObject, shading: Shading): THREE.Material {
  const m = o.material ?? DEFAULT_MATERIAL;
  if (shading === "solid") {
    return new THREE.MeshStandardMaterial({
      color: "#bdbdbd",
      roughness: 0.8,
      metalness: 0,
      wireframe: !!m.wireframe,
      flatShading: !!m.flat,
      side: o.kind === "plane" ? THREE.DoubleSide : THREE.FrontSide,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: m.color,
    metalness: m.metalness,
    roughness: m.roughness,
    opacity: m.opacity,
    transparent: m.opacity < 1,
    emissive: m.emissive ?? "#000000",
    emissiveIntensity: m.emissiveIntensity ?? 1,
    wireframe: shading === "wireframe" || !!m.wireframe,
    flatShading: !!m.flat,
    side: o.kind === "plane" ? THREE.DoubleSide : THREE.FrontSide,
  });
}

export class ModelScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;
  readonly gizmo: TransformControls;
  private file: ModelFile;
  private nodes = new Map<string, THREE.Object3D>();
  private sigs = new Map<string, string>();
  private loaded = new Map<string, Promise<Loaded>>();
  private mixers = new Map<string, { mixer: THREE.AnimationMixer; clips: THREE.AnimationClip[] }>();
  private grid: THREE.GridHelper;
  private ground: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private outline: THREE.BoxHelper | null = null;
  private raf = 0;
  private host: HTMLElement;
  private ro: ResizeObserver;
  shading: Shading = "material";
  selected: string | null = null;
  frame = 1;
  /** Called after the owner drags the gizmo (with the object's new pose). */
  onTransform: (id: string, pose: { position: Vec3; rotation: Vec3; scale: Vec3 }, done: boolean) => void = () => {};
  onPick: (id: string | null) => void = () => {};

  constructor(host: HTMLElement, file: ModelFile) {
    this.host = host;
    this.file = file;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 2000);
    this.camera.position.set(6, 4.5, 7);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.5, 0);
    this.orbit.enableDamping = true;
    this.orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };

    this.hemi = new THREE.HemisphereLight("#ffffff", "#444444", 0.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#ffffff", 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -15;
    this.sun.shadow.camera.right = 15;
    this.sun.shadow.camera.top = 15;
    this.sun.shadow.camera.bottom = -15;
    this.scene.add(this.sun, this.sun.target);

    this.grid = new THREE.GridHelper(40, 40, "#5c5c5c", "#474747");
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.8;
    this.scene.add(this.grid);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.25 }),
    );
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    const axes = new THREE.Group();
    const line = (to: THREE.Vector3, c: string) =>
      new THREE.Line(new THREE.BufferGeometry().setFromPoints([to.clone().multiplyScalar(-20), to.clone().multiplyScalar(20)]), new THREE.LineBasicMaterial({ color: c }));
    axes.add(line(new THREE.Vector3(1, 0, 0), "#b33c3c"), line(new THREE.Vector3(0, 0, 1), "#5b8a2c"));
    axes.position.y = 0.001;
    this.scene.add(axes);

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.orbit.enabled = !(e as unknown as { value: boolean }).value;
      if (!(e as unknown as { value: boolean }).value) this.emitTransform(true);
    });
    this.gizmo.addEventListener("objectChange", () => this.emitTransform(false));
    this.scene.add(this.gizmo.getHelper());

    // Click (not drag) picks an object.
    let down: { x: number; y: number } | null = null;
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || this.gizmo.dragging) return;
      this.onPick(this.pick(e.clientX, e.clientY));
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.sync(file);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.orbit.update();
      this.outline?.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private emitTransform(done: boolean) {
    const id = this.selected;
    const n = id ? this.nodes.get(id) : null;
    if (!id || !n) return;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    this.onTransform(
      id,
      {
        position: [r(n.position.x), r(n.position.y), r(n.position.z)],
        rotation: [r(n.rotation.x / D2R), r(n.rotation.y / D2R), r(n.rotation.z / D2R)],
        scale: [r(n.scale.x), r(n.scale.y), r(n.scale.z)],
      },
      done,
    );
  }

  pick(clientX: number, clientY: number): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const roots = [...this.nodes.values()].filter((n) => n.visible);
    const hit = ray.intersectObjects(roots, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.sceneId) o = o.parent;
    return (o?.userData.sceneId as string) ?? null;
  }

  setShading(s: Shading) {
    this.shading = s;
    this.sigs.clear();
    this.sync(this.file);
  }

  /** Bring the three.js scene in line with the file. */
  sync(file: ModelFile) {
    this.file = file;
    const w = file.world;
    this.scene.background = new THREE.Color(w.background);
    this.grid.visible = w.grid;
    this.ground.visible = true;
    const a = w.sun * D2R;
    this.sun.position.set(Math.cos(a) * 10, Math.sin(a) * 14 + 2, Math.cos(a) * 6);
    this.hemi.intensity = w.ambient;
    const live = new Set(file.objects.map((o) => o.id));
    for (const [id, n] of [...this.nodes]) {
      if (!live.has(id)) {
        n.parent?.remove(n);
        this.nodes.delete(id);
        this.sigs.delete(id);
        this.mixers.delete(id);
      }
    }
    for (const o of file.objects) {
      const sig = JSON.stringify([o.kind, o.params, o.material, o.src, o.array, this.shading]);
      if (this.sigs.get(o.id) !== sig) {
        this.nodes.get(o.id)?.parent?.remove(this.nodes.get(o.id) as THREE.Object3D);
        const node = this.build(o);
        this.nodes.set(o.id, node);
        this.sigs.set(o.id, sig);
      }
    }
    // Parenting, after every node exists.
    for (const o of file.objects) {
      const n = this.nodes.get(o.id) as THREE.Object3D;
      const parent = (o.parent && this.nodes.get(o.parent)) || this.scene;
      if (n.parent !== parent) parent.add(n);
      n.visible = o.visible;
    }
    this.setFrame(this.frame);
    this.select(this.selected && live.has(this.selected) ? this.selected : null);
  }

  private build(o: SceneObject): THREE.Object3D {
    const holder = new THREE.Group();
    holder.userData.sceneId = o.id;
    holder.name = o.name;
    const one = (): THREE.Object3D | null => {
      if (o.kind === "empty") return null;
      if (o.kind === "import") return null;
      const g = geometryOf(o);
      if (!g) return null;
      const mesh = new THREE.Mesh(g, materialOf(o, this.shading));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };
    const count = Math.max(1, o.array?.count ?? 1);
    const off = o.array?.offset ?? [0, 0, 0];
    if (o.kind === "import" && o.src) {
      void this.load(o.src).then((l) => {
        for (let i = 0; i < count; i++) {
          const c = l.root.clone(true);
          c.position.set(off[0] * i, off[1] * i, off[2] * i);
          c.traverse((x) => {
            if ((x as THREE.Mesh).isMesh) {
              const m = x as THREE.Mesh;
              m.castShadow = true;
              m.receiveShadow = true;
              if (this.shading !== "material") {
                m.material = new THREE.MeshStandardMaterial({ color: "#bdbdbd", roughness: 0.8, wireframe: this.shading === "wireframe" });
              }
            }
          });
          holder.add(c);
          if (i === 0 && l.clips.length) {
            const mixer = new THREE.AnimationMixer(c);
            for (const clip of l.clips) mixer.clipAction(clip).play();
            this.mixers.set(o.id, { mixer, clips: l.clips });
          }
        }
        this.setFrame(this.frame);
      });
    } else {
      for (let i = 0; i < count; i++) {
        const m = one();
        if (!m) break;
        m.position.set(off[0] * i, off[1] * i, off[2] * i);
        holder.add(m);
      }
    }
    if (o.kind === "empty") {
      const ax = new THREE.AxesHelper(0.4);
      ax.userData.helper = true;
      holder.add(ax);
    }
    return holder;
  }

  private load(src: string): Promise<Loaded> {
    let p = this.loaded.get(src);
    if (p) return p;
    const url = mediaUrl(src);
    const ext = src.toLowerCase().split("?")[0].split(".").pop() ?? "";
    p = new Promise<Loaded>((resolve) => {
      const fail = () => {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: "#ff3b6b", wireframe: true }));
        resolve({ root: box, clips: [] });
      };
      if (ext === "stl") {
        new STLLoader().load(url, (g) => resolve({ root: new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#c8c8c8" })), clips: [] }), undefined, fail);
      } else if (ext === "obj") {
        new OBJLoader().load(url, (g) => resolve({ root: g, clips: [] }), undefined, fail);
      } else {
        new GLTFLoader().load(url, (g) => resolve({ root: g.scene, clips: g.animations }), undefined, fail);
      }
    });
    this.loaded.set(src, p);
    return p;
  }

  setFrame(f: number) {
    this.frame = f;
    for (const o of this.file.objects) {
      const n = this.nodes.get(o.id);
      if (!n) continue;
      if (this.gizmo.dragging && o.id === this.selected) continue;
      const pose = poseAt(o, f);
      n.position.set(...pose.position);
      n.rotation.set(pose.rotation[0] * D2R, pose.rotation[1] * D2R, pose.rotation[2] * D2R);
      n.scale.set(...pose.scale);
    }
    const t = Math.max(0, (f - this.file.frameStart) / this.file.fps);
    for (const { mixer } of this.mixers.values()) mixer.setTime(t);
  }

  select(id: string | null) {
    this.selected = id;
    if (this.outline) {
      this.scene.remove(this.outline);
      this.outline.dispose();
      this.outline = null;
    }
    const n = id ? this.nodes.get(id) : undefined;
    if (n) {
      this.gizmo.attach(n);
      this.outline = new THREE.BoxHelper(n, "#ffa028");
      this.scene.add(this.outline);
    } else {
      this.gizmo.detach();
    }
  }

  setMode(m: GizmoMode) {
    this.gizmo.setMode(m);
  }

  /** Frame the camera on an object or on everything. */
  focus(id?: string | null) {
    const box = new THREE.Box3();
    const n = id ? this.nodes.get(id) : null;
    if (n) box.setFromObject(n);
    else for (const x of this.nodes.values()) if (x.visible) box.expandByObject(x);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.2, box.getSize(new THREE.Vector3()).length() / 2);
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    const dist = r / Math.sin((this.camera.fov * D2R) / 2);
    this.orbit.target.copy(c);
    this.camera.position.copy(c.clone().add(dir.multiplyScalar(dist * 1.1)));
  }

  /** Front (1), right (3), top (7) views, like Blender's numpad. */
  view(which: "front" | "right" | "top" | "back" | "left" | "bottom") {
    const t = this.orbit.target;
    const d = this.camera.position.distanceTo(t);
    const v: Record<string, [number, number, number]> = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 1, 0.0001],
      bottom: [0, -1, 0.0001],
    };
    const [x, y, z] = v[which];
    this.camera.position.set(t.x + x * d, t.y + y * d, t.z + z * d);
  }

  /** The node's world-space bounding box at the current frame. */
  boundsOf(id: string): THREE.Box3 | null {
    const n = this.nodes.get(id);
    return n ? new THREE.Box3().setFromObject(n) : null;
  }

  snapshot(max = 480): string {
    this.gizmo.getHelper().visible = false;
    const outline = this.outline;
    if (outline) outline.visible = false;
    this.renderer.render(this.scene, this.camera);
    const c = this.renderer.domElement;
    const k = Math.min(1, max / Math.max(c.width, c.height));
    const s = document.createElement("canvas");
    s.width = Math.round(c.width * k);
    s.height = Math.round(c.height * k);
    s.getContext("2d")?.drawImage(c, 0, 0, s.width, s.height);
    this.gizmo.getHelper().visible = true;
    if (outline) outline.visible = true;
    return s.toDataURL("image/jpeg", 0.85);
  }

  /** Rendered still at the viewport's size ×2. */
  renderPng(): string {
    this.gizmo.getHelper().visible = false;
    const outline = this.outline;
    if (outline) outline.visible = false;
    const gridWas = this.grid.visible;
    this.grid.visible = false;
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.grid.visible = gridWas;
    this.gizmo.getHelper().visible = true;
    if (outline) outline.visible = true;
    return url;
  }

  /** The scene (with keyframes as animation) as a binary .glb, base64. */
  async exportGlb(): Promise<string> {
    const root = new THREE.Group();
    root.name = "Scene";
    const copies = new Map<string, THREE.Object3D>();
    const prevFrame = this.frame;
    this.setFrame(this.file.frameStart);
    for (const o of this.file.objects) {
      const n = this.nodes.get(o.id);
      if (!n || !o.visible) continue;
      const c = n.clone(true);
      c.traverse((x) => {
        if (x.userData.helper) x.visible = false;
      });
      c.children = c.children.filter((x) => !x.userData.helper);
      c.name = o.name.replace(/[^\w-]+/g, "_") || o.id;
      c.userData = {};
      copies.set(o.id, c);
    }
    for (const o of this.file.objects) {
      const c = copies.get(o.id);
      if (!c) continue;
      (o.parent && copies.get(o.parent) ? copies.get(o.parent) : root)?.add(c);
    }
    this.setFrame(prevFrame);
    const clips: THREE.AnimationClip[] = [];
    const tracks: THREE.KeyframeTrack[] = [];
    for (const o of this.file.objects) {
      const c = copies.get(o.id);
      if (!c || !o.keys?.length) continue;
      tracks.push(...keyTracks(c.name, o.keys, this.file.fps, this.file.frameStart));
    }
    if (tracks.length) clips.push(new THREE.AnimationClip("Action", -1, tracks));
    for (const m of this.mixers.values()) clips.push(...m.clips);
    const out = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips });
    return toBase64(out as ArrayBuffer);
  }

  exportStl(): string {
    const root = new THREE.Group();
    for (const o of this.file.objects) {
      const n = this.nodes.get(o.id);
      if (n && o.visible && !o.parent) root.add(n.clone(true));
    }
    root.updateMatrixWorld(true);
    const data = new STLExporter().parse(root, { binary: true }) as unknown as DataView;
    return toBase64(data.buffer as ArrayBuffer);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function keyTracks(name: string, keys: ObjKey[], fps: number, start: number): THREE.KeyframeTrack[] {
  const out: THREE.KeyframeTrack[] = [];
  const pos = keys.filter((k) => k.position);
  const rot = keys.filter((k) => k.rotation);
  const scl = keys.filter((k) => k.scale);
  const t = (k: ObjKey) => Math.max(0, (k.f - start) / fps);
  if (pos.length) out.push(new THREE.VectorKeyframeTrack(`${name}.position`, pos.map(t), pos.flatMap((k) => k.position as Vec3)));
  if (scl.length) out.push(new THREE.VectorKeyframeTrack(`${name}.scale`, scl.map(t), scl.flatMap((k) => k.scale as Vec3)));
  if (rot.length) {
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    out.push(
      new THREE.QuaternionKeyframeTrack(
        `${name}.quaternion`,
        rot.map(t),
        rot.flatMap((k) => {
          const r = k.rotation as Vec3;
          q.setFromEuler(e.set(r[0] * D2R, r[1] * D2R, r[2] * D2R));
          return [q.x, q.y, q.z, q.w];
        }),
      ),
    );
  }
  return out;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Rigid-body drop (the Simulation workspace): active bodies fall under
 * gravity and bounce on the ground and on passive bodies / bodies that have
 * already landed (box-shaped contact), baked into keyframes.
 */
export function bakeRigidBodies(file: ModelFile, bounds: (id: string) => THREE.Box3 | null): ModelFile {
  const g = 9.81;
  const dt = 1 / file.fps;
  const steps = 4;
  const supports: THREE.Box3[] = [];
  for (const o of file.objects) {
    if (o.physics?.type === "passive" && o.visible) {
      const b = bounds(o.id);
      if (b) supports.push(b);
    }
  }
  const active = file.objects
    .filter((o) => o.physics?.type === "active" && o.visible && !o.parent)
    .map((o) => ({ o, box: bounds(o.id) }))
    .filter((x): x is { o: SceneObject; box: THREE.Box3 } => !!x.box)
    .sort((a, b) => a.box.min.y - b.box.min.y);
  const baked = new Map<string, ObjKey[]>();
  for (const { o, box } of active) {
    const ph = o.physics as NonNullable<SceneObject["physics"]>;
    const offset = o.position[1] - box.min.y; // pivot above the bottom
    let y = box.min.y;
    let v = 0;
    const keys: ObjKey[] = [];
    // Where it can land: the highest support under its footprint.
    const floorAt = () => {
      let floor = 0;
      for (const s of supports) {
        const overlap = s.max.x > box.min.x && s.min.x < box.max.x && s.max.z > box.min.z && s.min.z < box.max.z;
        if (overlap && s.max.y <= y + 1e-3) floor = Math.max(floor, s.max.y);
      }
      return floor;
    };
    let resting = 0;
    for (let f = file.frameStart; f <= file.frameEnd; f++) {
      for (let i = 0; i < steps; i++) {
        const h = dt / steps;
        // What's underneath, from where it is before this step (a fast
        // body can pass a surface's top within one step).
        const floor = floorAt();
        v -= g * h;
        y += v * h;
        if (y < floor) {
          y = floor;
          v = Math.abs(v) > 0.4 ? -v * ph.bounce : 0;
        }
      }
      if (v === 0) resting++;
      keys.push({ f, position: [o.position[0], Math.round((y + offset) * 1000) / 1000, o.position[2]] });
    }
    const h = box.max.y - box.min.y;
    // It now holds up whatever lands later.
    supports.push(new THREE.Box3(new THREE.Vector3(box.min.x, y, box.min.z), new THREE.Vector3(box.max.x, y + h, box.max.z)));
    // Keep only where it changes (plus the ends).
    const slim = keys.filter((k, i) => i === 0 || i === keys.length - 1 || keys[i - 1].position?.[1] !== k.position?.[1] || keys[i + 1]?.position?.[1] !== k.position?.[1]);
    baked.set(o.id, slim);
    void resting;
  }
  return {
    ...file,
    objects: file.objects.map((o) => {
      const keys = baked.get(o.id);
      if (!keys) return o;
      const others = (o.keys ?? []).map((k) => ({ ...k, position: undefined })).filter((k) => k.rotation || k.scale);
      return { ...o, keys: [...keys, ...others].sort((a, b) => a.f - b.f) };
    }),
  };
}
