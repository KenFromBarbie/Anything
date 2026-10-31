import * as React from "react";
import { Box, Grid3x3, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

/** The 3D formats the viewer reads, by file extension. */
export const MODEL_RE = /\.(glb|gltf|obj|stl)$/i;

type Loaded = { object: THREE.Object3D; clips: THREE.AnimationClip[] };

const PLAIN = () =>
  new THREE.MeshStandardMaterial({
    color: 0xb8bcc6,
    metalness: 0.1,
    roughness: 0.6,
  });

/** A model file (by its path's extension) loaded from the app's asset URL. */
async function loadModel(src: string, path: string): Promise<Loaded> {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "glb" || ext === "gltf") {
    const gltf = await new GLTFLoader().loadAsync(src);
    return { object: gltf.scene, clips: gltf.animations };
  }
  if (ext === "obj") {
    const group = await new OBJLoader().loadAsync(src);
    // OBJ without its .mtl: give it a plain material that takes the light.
    group.traverse((node) => {
      if (node instanceof THREE.Mesh) node.material = PLAIN();
    });
    return { object: group, clips: [] };
  }
  if (ext === "stl") {
    const geometry = await new STLLoader().loadAsync(src);
    geometry.computeVertexNormals();
    return { object: new THREE.Mesh(geometry, PLAIN()), clips: [] };
  }
  throw new Error(`the app can't show .${ext} models`);
}

/** Centre the model at the origin and put the camera where all of it shows. */
function frame(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls?: OrbitControls,
) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const radius = Math.max(size.length() / 2, 1e-3);
  const distance =
    radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) + radius * 0.1;
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.position.copy(
    new THREE.Vector3(1, 0.65, 1.15).normalize().multiplyScalar(distance),
  );
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  if (controls) {
    controls.target.set(0, 0, 0);
    controls.minDistance = radius * 0.2;
    controls.maxDistance = distance * 10;
    controls.update();
  }
}

function triangles(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const geometry = node.geometry as THREE.BufferGeometry;
      count +=
        (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3;
    }
  });
  return Math.round(count);
}

function dispose(object: THREE.Object3D) {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      for (const material of [node.material].flat()) material.dispose();
    }
  });
}

function lightScene(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  // The room light does most of it; a soft key light gives the shape.
  scene.environmentIntensity = 0.8;
  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(3, 5, 4);
  scene.add(key);
}

function setWireframe(object: THREE.Object3D, on: boolean) {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      for (const material of [node.material].flat()) {
        if ("wireframe" in material) material.wireframe = on;
      }
    }
  });
}

/**
 * A 3D model, live: drag to turn it, scroll or pinch to zoom, right-drag to
 * move. It turns slowly on its own until touched, and plays the model's own
 * animations.
 */
export function ModelViewer({
  src,
  path,
  className,
  toolbar = true,
}: {
  src: string;
  /** The file's path, for its format. */
  path: string;
  className?: string;
  /** Turn, wireframe and reset buttons over a corner. */
  toolbar?: boolean;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<{
    reset: () => void;
    setTurning: (on: boolean) => void;
    setWire: (on: boolean) => void;
  } | null>(null);
  const [state, setState] = React.useState<
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "ready"; triangles: number }
  >({ status: "loading" });
  const [turning, setTurning] = React.useState(true);
  const [wire, setWire] = React.useState(false);

  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stopped = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.style.display = "block";
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    lightScene(scene, renderer);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      setTurning(false);
    });
    let model: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const clock = new THREE.Clock();

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    // Draw only while it's on screen.
    let visible = true;
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    seen.observe(el);
    renderer.setAnimationLoop(() => {
      if (!visible) return;
      mixer?.update(clock.getDelta());
      controls.update();
      renderer.render(scene, camera);
    });

    loadModel(src, path)
      .then(({ object, clips }) => {
        if (stopped) return dispose(object);
        model = object;
        scene.add(object);
        frame(object, camera, controls);
        if (clips.length) {
          mixer = new THREE.AnimationMixer(object);
          for (const clip of clips) mixer.clipAction(clip).play();
        }
        setState({ status: "ready", triangles: triangles(object) });
      })
      .catch((error: unknown) => {
        if (!stopped)
          setState({
            status: "error",
            error: String((error as Error)?.message ?? error),
          });
      });

    view.current = {
      reset: () => {
        if (!model) return;
        model.position.set(0, 0, 0);
        frame(model, camera, controls);
      },
      setTurning: (on) => {
        controls.autoRotate = on;
      },
      setWire: (on) => {
        if (model) setWireframe(model, on);
      },
    };

    return () => {
      stopped = true;
      view.current = null;
      observer.disconnect();
      seen.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      if (model) dispose(model);
      scene.environment?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [src, path]);

  return (
    <div
      className={cn(
        "relative h-full min-h-64 w-full touch-none select-none",
        className,
      )}
      data-testid="model-viewer"
    >
      <div className="absolute inset-0" ref={host} />
      {state.status === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : state.status === "error" ? (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-sm text-destructive">
          Couldn't show this model: {state.error}
        </p>
      ) : toolbar ? (
        <div className="absolute bottom-2 left-2 flex items-center gap-1">
          <Button
            aria-label={turning ? "Stop turning" : "Turn"}
            className="h-7 w-7 bg-background/90 shadow-sm"
            onClick={() => {
              view.current?.setTurning(!turning);
              setTurning(!turning);
            }}
            size="icon"
            title={turning ? "Stop turning" : "Turn"}
            variant="outline"
          >
            {turning ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            aria-label="Wireframe"
            aria-pressed={wire}
            className={cn(
              "h-7 w-7 bg-background/90 shadow-sm",
              wire && "bg-muted",
            )}
            onClick={() => {
              view.current?.setWire(!wire);
              setWire(!wire);
            }}
            size="icon"
            title="Wireframe"
            variant="outline"
          >
            <Grid3x3 className="h-3.5 w-3.5" />
          </Button>
          <Button
            aria-label="Reset the view"
            className="h-7 w-7 bg-background/90 shadow-sm"
            onClick={() => view.current?.reset()}
            size="icon"
            title="Reset the view"
            variant="outline"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <span className="rounded-md bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
            {state.triangles.toLocaleString()} triangles
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ─── Gallery snapshots ──────────────────────────────────────────────────────
// Browsers allow only so many WebGL views at once, so gallery cards don't
// each get a live one: a single offscreen renderer draws each model once and
// the card shows that picture.

const SNAPSHOT = { width: 640, height: 400 };
const snapshots = new Map<string, Promise<string>>();
let snapshotRenderer: THREE.WebGLRenderer | null = null;
let queue: Promise<unknown> = Promise.resolve();

function snapshot(src: string, path: string): Promise<string> {
  const cached = snapshots.get(src);
  if (cached) return cached;
  // One at a time, on the one renderer.
  const made = queue
    .catch(() => {})
    .then(async () => {
      snapshotRenderer ??= new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
      });
      const renderer = snapshotRenderer;
      renderer.setSize(SNAPSHOT.width, SNAPSHOT.height, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      lightScene(scene, renderer);
      const camera = new THREE.PerspectiveCamera(
        40,
        SNAPSHOT.width / SNAPSHOT.height,
      );
      const { object } = await loadModel(src, path);
      scene.add(object);
      frame(object, camera);
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL("image/png");
      dispose(object);
      scene.environment?.dispose();
      return url;
    });
  queue = made;
  snapshots.set(src, made);
  made.catch(() => snapshots.delete(src));
  return made;
}

/** A gallery card's picture of a model. */
export function ModelThumb({ src, path }: { src: string; path: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    snapshot(src, path)
      .then((made) => live && setUrl(made))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [src, path]);
  if (url) {
    return (
      <img
        alt=""
        className="h-full w-full object-contain"
        draggable={false}
        src={url}
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-amber-400/50 to-orange-600/50 text-white/90">
      {failed ? (
        <Box className="h-8 w-8" />
      ) : (
        <Loader2 className="h-6 w-6 animate-spin" />
      )}
    </div>
  );
}
