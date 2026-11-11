import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Atom,
  Box,
  ChevronLeft,
  ChevronRight,
  Circle,
  Cone,
  Cylinder,
  Diamond,
  Eye,
  EyeOff,
  Globe,
  Layers,
  Move,
  MousePointer2,
  Pause,
  Play,
  Rotate3d,
  Scaling,
  Shapes,
  SkipBack,
  SkipForward,
  Square,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";
import { makeHow } from "@/features/office/lib/studioRequests";

import { CreativeShell, isTyping, type Menu, Panel, Slider } from "./CreativeShell";
import { closeEditor, exportFile, saveToCreate } from "./editorStore";
import { toSix } from "./ImagePanels";
import { bakeRigidBodies, type GizmoMode, ModelScene, type Shading } from "./modelEngine";
import {
  DEFAULT_MATERIAL,
  defaultParams,
  type Material,
  type ModelFile,
  type ObjectKind,
  type ObjKey,
  oid,
  type Params,
  poseAt,
  type Primitive,
  type SceneObject,
  type Vec3,
} from "./modelFormat";
import { editorRequest } from "./requests";

type Workspace = "Layout" | "Animation" | "Clothing" | "Simulation";
const WORKSPACES: Workspace[] = ["Layout", "Animation", "Clothing", "Simulation"];
type PropTab = "object" | "modifiers" | "material" | "shape" | "physics" | "world";

const ADD: { kind: Primitive; label: string }[] = [
  { kind: "box", label: "Cube" },
  { kind: "sphere", label: "UV Sphere" },
  { kind: "icosphere", label: "Ico Sphere" },
  { kind: "cylinder", label: "Cylinder" },
  { kind: "cone", label: "Cone" },
  { kind: "torus", label: "Torus" },
  { kind: "plane", label: "Plane" },
  { kind: "capsule", label: "Capsule" },
];

const FABRICS: Record<string, string> = {
  "Cotton jersey": "#e9e4da",
  Linen: "#d8cbb0",
  Denim: "#3d5a80",
  Silk: "#d64161",
  Wool: "#6b5b4d",
  "Technical nylon": "#2b2f36",
};

export function ModelEditor({
  title: initialTitle,
  file,
  series: initialSeries,
  path,
  artifactId,
}: {
  title: string;
  file: ModelFile;
  series?: string;
  path?: string;
  artifactId?: string;
}) {
  const [title, setTitle] = React.useState(initialTitle);
  const [series, setSeries] = React.useState(initialSeries);
  const [saved, setSaved] = React.useState<{ id: string; path?: string } | null>(artifactId ? { id: artifactId, path } : null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [model, setModelState] = React.useState<ModelFile>(file);
  const modelRef = React.useRef(model);
  const setModel = React.useCallback((m: ModelFile) => {
    modelRef.current = m;
    setModelState(m);
  }, []);
  const [sel, setSelState] = React.useState<string | null>(file.objects[0]?.id ?? null);
  const selRef = React.useRef(sel);
  const setSel = (id: string | null) => {
    selRef.current = id;
    setSelState(id);
  };
  const [workspace, setWorkspace] = React.useState<Workspace>("Layout");
  const [tab, setTab] = React.useState<PropTab>("object");
  const [mode, setMode] = React.useState<GizmoMode>("translate");
  const [shading, setShading] = React.useState<Shading>("material");
  const [frame, setFrameState] = React.useState(file.frameStart);
  const frameRef = React.useRef(frame);
  const setFrame = (f: number) => {
    frameRef.current = f;
    setFrameState(f);
  };
  const [playing, setPlaying] = React.useState(false);
  const host = React.useRef<HTMLDivElement>(null);
  const engine = React.useRef<ModelScene | null>(null);

  // ---- history ---------------------------------------------------------
  const hist = React.useRef<{ label: string; m: ModelFile }[]>([{ label: "Open", m: file }]);
  const hi = React.useRef(0);
  const [, setHv] = React.useState(0);
  const commit = React.useCallback((label: string) => {
    hist.current = hist.current.slice(0, hi.current + 1);
    hist.current.push({ label, m: modelRef.current });
    if (hist.current.length > 100) hist.current.shift();
    hi.current = hist.current.length - 1;
    setHv((v) => v + 1);
    setDirty(true);
  }, []);
  const restore = (i: number) => {
    const h = hist.current[i];
    if (!h) return;
    hi.current = i;
    setModel(h.m);
    setDirty(true);
    setHv((v) => v + 1);
  };
  const change = (m: ModelFile, label?: string) => {
    setModel(m);
    if (label) commit(label);
  };
  const updateObj = (id: string, patch: Partial<SceneObject>, label?: string) =>
    change({ ...modelRef.current, objects: modelRef.current.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }, label);

  // ---- viewport --------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: create once
  React.useEffect(() => {
    if (!host.current) return;
    const e = new ModelScene(host.current, modelRef.current);
    e.onPick = (id) => setSel(id);
    e.onTransform = (id, pose, done) => {
      const o = modelRef.current.objects.find((x) => x.id === id);
      if (!o) return;
      // With keyframes, moving it keys the current frame (auto-keying).
      const next: Partial<SceneObject> = o.keys?.length ? { keys: setKey(o.keys, frameRef.current, pose) } : pose;
      const m = e.gizmo.mode;
      updateObj(id, next, done ? (m === "rotate" ? "Rotate" : m === "scale" ? "Scale" : "Move") : undefined);
    };
    engine.current = e;
    e.select(selRef.current);
    requestAnimationFrame(() => e.focus());
    return () => e.dispose();
  }, []);
  React.useEffect(() => {
    engine.current?.sync(model);
  }, [model]);
  React.useEffect(() => {
    engine.current?.select(sel);
  }, [sel]);
  React.useEffect(() => {
    engine.current?.setMode(mode);
  }, [mode]);
  React.useEffect(() => {
    engine.current?.setShading(shading);
  }, [shading]);
  React.useEffect(() => {
    engine.current?.setFrame(frame);
  }, [frame]);

  // playback
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      acc += (now - last) / 1000;
      last = now;
      const m = modelRef.current;
      const step = 1 / m.fps;
      if (acc >= step) {
        const n = Math.floor(acc / step);
        acc -= n * step;
        let f = frameRef.current + n;
        if (f > m.frameEnd) f = m.frameStart;
        setFrame(f);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const obj = model.objects.find((o) => o.id === sel);

  // ---- objects ---------------------------------------------------------
  const nameFor = (base: string) => {
    const names = new Set(modelRef.current.objects.map((o) => o.name));
    if (!names.has(base)) return base;
    for (let i = 1; ; i++) {
      const n = `${base}.${String(i).padStart(3, "0")}`;
      if (!names.has(n)) return n;
    }
  };
  const add = (kind: ObjectKind, label: string, extra: Partial<SceneObject> = {}) => {
    const o: SceneObject = {
      id: oid(),
      name: nameFor(label),
      kind,
      visible: true,
      position: [0, kind === "plane" ? 0 : 0.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      params: defaultParams(kind),
      material: { ...DEFAULT_MATERIAL },
      ...extra,
    };
    change({ ...modelRef.current, objects: [...modelRef.current.objects, o] }, `Add ${label}`);
    setSel(o.id);
    return o;
  };
  const childrenOf = (id: string): string[] => {
    const out: string[] = [];
    const walk = (p: string) => {
      for (const o of modelRef.current.objects) if (o.parent === p) {
        out.push(o.id);
        walk(o.id);
      }
    };
    walk(id);
    return out;
  };
  const remove = () => {
    const id = selRef.current;
    if (!id) return;
    const gone = new Set([id, ...childrenOf(id)]);
    change({ ...modelRef.current, objects: modelRef.current.objects.filter((o) => !gone.has(o.id)) }, "Delete");
    setSel(null);
  };
  const duplicate = () => {
    const o = modelRef.current.objects.find((x) => x.id === selRef.current);
    if (!o) return;
    const map = new Map<string, string>();
    const ids = [o.id, ...childrenOf(o.id)];
    for (const id of ids) map.set(id, oid());
    const copies = modelRef.current.objects
      .filter((x) => map.has(x.id))
      .map((x) => ({
        ...structuredClone(x),
        id: map.get(x.id) as string,
        name: nameFor(x.name.replace(/\.\d{3}$/, "")),
        parent: x.id === o.id ? x.parent : map.get(x.parent ?? "") ?? x.parent,
        position: x.id === o.id ? ([x.position[0] + 0.5, x.position[1], x.position[2] + 0.5] as Vec3) : x.position,
      }));
    change({ ...modelRef.current, objects: [...modelRef.current.objects, ...copies] }, "Duplicate");
    setSel(map.get(o.id) as string);
  };

  // ---- keyframes -------------------------------------------------------
  const insertKey = () => {
    const o = modelRef.current.objects.find((x) => x.id === selRef.current);
    if (!o) return toast.message("Select an object first");
    const pose = poseAt(o, frameRef.current);
    updateObj(o.id, { keys: setKey(o.keys ?? [], frameRef.current, pose) }, "Insert keyframe");
  };
  const deleteKey = () => {
    const o = modelRef.current.objects.find((x) => x.id === selRef.current);
    if (!o?.keys?.length) return;
    const pose = poseAt(o, frameRef.current);
    const keys = o.keys.filter((k) => k.f !== frameRef.current);
    updateObj(o.id, { keys: keys.length ? keys : undefined, ...(keys.length ? {} : pose) }, "Delete keyframe");
  };
  const keyFrames = (o?: SceneObject) => [...new Set((o?.keys ?? []).map((k) => k.f))].sort((a, b) => a - b);
  const jumpKey = (dir: 1 | -1) => {
    const all = [...new Set(modelRef.current.objects.flatMap((o) => (o.keys ?? []).map((k) => k.f)))].sort((a, b) => a - b);
    const f = dir > 0 ? all.find((x) => x > frameRef.current) : [...all].reverse().find((x) => x < frameRef.current);
    if (f != null) setFrame(f);
  };

  // ---- import / save / export ------------------------------------------
  const importModel = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: true, filters: [{ name: "3D models", extensions: ["glb", "gltf", "obj", "stl"] }] });
    const picked = Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
    for (const p of picked) {
      try {
        const res = await invoke<{ path: string; name: string }>("office_media_import", { path: p });
        add("import", res.name.replace(/\.[a-z0-9]+$/i, ""), { src: res.path, position: [0, 0, 0], params: undefined });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(/not found|unknown command|office_media_import/i.test(msg) ? "Importing needs the app to restart once (it was just added)." : msg);
      }
    }
  };

  const save = async (): Promise<{ id: string; path?: string } | null> => {
    setSaving(true);
    try {
      const preview = engine.current?.snapshot();
      const r = await saveToCreate("model", title, { ...modelRef.current, ...(preview ? { preview } : {}) }, series);
      setSeries(r.series);
      setSaved({ id: r.id, path: r.path });
      setDirty(false);
      return { id: r.id, path: r.path };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const doExport = async (what: "glb" | "stl" | "png") => {
    const e = engine.current;
    if (!e) return;
    try {
      const name = title.trim() || "Untitled";
      const data = what === "glb" ? await e.exportGlb() : what === "stl" ? e.exportStl() : e.renderPng();
      const label = what === "glb" ? "glTF binary" : what === "stl" ? "STL (3D printing)" : "PNG image";
      const ok = await exportFile(`${name}.${what}`, data, what, label, true);
      if (ok) toast.success("Exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  // ---- the Office (Clothing / Simulation) -------------------------------
  const askOffice = async (kind: "clothing" | "simulation", brief: string, study: Record<string, string | number>) => {
    change({ ...modelRef.current, studies: { ...modelRef.current.studies, [kind]: study } }, kind === "clothing" ? "Clothing study" : "Simulation study");
    const s = await save();
    if (!s) return;
    const text = [
      brief,
      `How: ${makeHow(kind)}`,
      "Then put the result into this scene: copy the .glb into the shared workspace's artifacts/_media folder and add it as an import object (keep the owner's objects), and publish the HTML report separately.",
    ].join("\n");
    const request = editorRequest("model", title, text, s);
    const { callOffice, getOfficeAgents } = await import("@/features/office/lib/officeLink");
    try {
      const ceo = getOfficeAgents().agents.find((a) => a.isGod);
      await callOffice("agent.message", { id: ceo?.id ?? "god", text: request });
      toast.success("Sent to the Office: the result comes back here as a new version");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- keyboard --------------------------------------------------------
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === "z") return (e.preventDefault(), e.shiftKey ? restore(hi.current + 1) : restore(hi.current - 1));
      if (mod && k === "y") return (e.preventDefault(), restore(hi.current + 1));
      if (mod) return;
      if (e.code === "Numpad1") return engine.current?.view(e.ctrlKey ? "back" : "front");
      if (e.code === "Numpad3") return engine.current?.view("right");
      if (e.code === "Numpad7") return engine.current?.view("top");
      if (e.code === "NumpadDecimal") return engine.current?.focus(selRef.current);
      if (e.key === "Home") return engine.current?.focus();
      if (e.key === " ") return (e.preventDefault(), setPlaying((p) => !p));
      if (e.shiftKey && k === "d") return duplicate();
      if (e.altKey && k === "h") return change({ ...modelRef.current, objects: modelRef.current.objects.map((o) => ({ ...o, visible: true })) }, "Show all");
      if (k === "h" && selRef.current) return updateObj(selRef.current, { visible: false }, "Hide");
      if (k === "x" || e.key === "Delete") return remove();
      if (k === "g") return setMode("translate");
      if (k === "r") return setMode("rotate");
      if (k === "s") return setMode("scale");
      if (k === "i") return insertKey();
      if (e.key === "ArrowLeft") return setFrame(Math.max(modelRef.current.frameStart, frameRef.current - 1));
      if (e.key === "ArrowRight") return setFrame(Math.min(modelRef.current.frameEnd, frameRef.current + 1));
      if (e.key === "ArrowUp") return jumpKey(1);
      if (e.key === "ArrowDown") return jumpKey(-1);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  });

  // ---- menus -----------------------------------------------------------
  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "Save to Create", run: () => void save(), shortcut: "Ctrl+S" },
        { label: "Import Model (.glb, .obj, .stl)…", run: () => void importModel() },
        "-",
        { label: "Export glTF Binary (.glb)…", run: () => void doExport("glb") },
        { label: "Export STL (3D print)…", run: () => void doExport("stl") },
        { label: "Render Image (.png)…", run: () => void doExport("png") },
        "-",
        { label: "Close", run: () => closeEditor() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: `Undo ${hist.current[hi.current]?.label ?? ""}`.trim(), run: () => restore(hi.current - 1), shortcut: "Ctrl+Z", disabled: hi.current <= 0 },
        { label: "Redo", run: () => restore(hi.current + 1), shortcut: "Ctrl+Shift+Z", disabled: hi.current >= hist.current.length - 1 },
      ],
    },
    {
      label: "Add",
      items: [
        ...ADD.map((a) => ({ label: a.label, run: () => add(a.kind, a.label) })),
        "-",
        { label: "Empty", run: () => add("empty", "Empty", { params: undefined }) },
        { label: "Water Surface", run: () => add("plane", "Water", { params: { width: 20, depth: 20 }, position: [0, 0, 0], material: { color: "#2b6cb0", metalness: 0.1, roughness: 0.15, opacity: 0.75 } }) },
        { label: "Mannequin (from measurements)…", run: () => setWorkspace("Clothing") },
        { label: "Import Model…", run: () => void importModel() },
      ],
    },
    {
      label: "Object",
      items: [
        { label: "Duplicate", run: duplicate, shortcut: "Shift+D", disabled: !obj },
        { label: "Delete", run: remove, shortcut: "X", disabled: !obj },
        { label: "Hide", run: () => obj && updateObj(obj.id, { visible: false }, "Hide"), shortcut: "H", disabled: !obj },
        { label: "Show All", run: () => change({ ...modelRef.current, objects: modelRef.current.objects.map((o) => ({ ...o, visible: true })) }, "Show all"), shortcut: "Alt+H" },
        "-",
        { label: "Insert Keyframe", run: insertKey, shortcut: "I", disabled: !obj },
        { label: "Clear Keyframes", run: () => obj && updateObj(obj.id, { keys: undefined }, "Clear keyframes"), disabled: !obj?.keys?.length },
        { label: "Reset Transform", run: () => obj && updateObj(obj.id, { position: [0, obj.position[1], 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, "Reset transform"), disabled: !obj },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Frame All", run: () => engine.current?.focus(), shortcut: "Home" },
        { label: "Frame Selected", run: () => engine.current?.focus(sel), shortcut: "Numpad ." },
        "-",
        { label: "Front", run: () => engine.current?.view("front"), shortcut: "Numpad 1" },
        { label: "Right", run: () => engine.current?.view("right"), shortcut: "Numpad 3" },
        { label: "Top", run: () => engine.current?.view("top"), shortcut: "Numpad 7" },
        { label: "Back", run: () => engine.current?.view("back") },
        "-",
        { label: "Solid Shading", run: () => setShading("solid"), checked: shading === "solid" },
        { label: "Material Preview", run: () => setShading("material"), checked: shading === "material" },
        { label: "Wireframe", run: () => setShading("wireframe"), checked: shading === "wireframe" },
      ],
    },
  ];

  const options = (
    <>
      {WORKSPACES.map((w) => (
        <button
          className={cn("h-7 shrink-0 rounded px-3 text-[12px]", workspace === w ? "bg-[#4a4a4a] text-white" : "text-[#bdbdbd] hover:bg-[#3a3a3a]")}
          key={w}
          onClick={() => setWorkspace(w)}
          type="button"
        >
          {w}
        </button>
      ))}
      <span className="flex-1" />
      <span className="text-[11px] text-[#8a8a8a]">Drag: orbit · Right-drag: pan · Wheel: zoom · Click: select · G/R/S · I key · Shift+D · X</span>
    </>
  );

  const tools: { id: GizmoMode | "select"; icon: typeof Move; label: string }[] = [
    { id: "translate", icon: Move, label: "Move (G)" },
    { id: "rotate", icon: Rotate3d, label: "Rotate (R)" },
    { id: "scale", icon: Scaling, label: "Scale (S)" },
  ];

  const timelineTall = workspace === "Animation";

  return (
    <CreativeShell
      ask={{
        placeholder: "e.g. Model a desk lamp with a jointed arm, or make the boat hull longer and run it in 50 cm waves",
        build: async (text) => {
          const s = dirty || !saved ? await save() : saved;
          return editorRequest("model", title, text, s);
        },
      }}
      badge="3D"
      dirty={dirty}
      isNew={!saved}
      kind="model"
      menus={menus}
      onClose={() => closeEditor()}
      onSave={() => void save()}
      onTitle={(t) => {
        setTitle(t);
        setDirty(true);
      }}
      options={options}
      saving={saving}
      status={
        <>
          <span>{workspace}</span>
          <span>{model.objects.length} objects</span>
          <span>
            Frame {frame} / {model.frameEnd} · {model.fps} fps
          </span>
          <span className="ml-auto">{obj ? `${obj.name} · ${obj.position.map((v) => v.toFixed(2)).join(", ")} m` : ""}</span>
        </>
      }
      title={title}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {workspace === "Clothing" ? (
            <ClothingPanel onAsk={askOffice} onBuild={(objs, label) => replaceGroup(objs, label)} study={model.studies?.clothing} />
          ) : workspace === "Simulation" ? (
            <SimulationPanel
              obj={obj}
              onAsk={askOffice}
              onBake={() => {
                const e = engine.current;
                if (!e) return;
                setPlaying(false);
                setFrame(modelRef.current.frameStart);
                e.setFrame(modelRef.current.frameStart);
                // Bake from the rest pose (without earlier baked drops).
                const rest = { ...modelRef.current, objects: modelRef.current.objects.map((o) => (o.physics?.type === "active" ? { ...o, keys: o.keys?.filter((k) => k.rotation || k.scale) } : o)) };
                e.sync(rest);
                const next = bakeRigidBodies(rest, (id) => e.boundsOf(id));
                change(next, "Bake rigid bodies");
                setPlaying(true);
              }}
              onClear={() => change({ ...modelRef.current, objects: modelRef.current.objects.map((o) => (o.physics ? { ...o, keys: undefined } : o)) }, "Clear bake")}
              onPhysics={(p) => obj && updateObj(obj.id, { physics: p }, "Physics")}
              onWater={() => add("plane", "Water", { params: { width: 20, depth: 20 }, position: [0, 0, 0], material: { color: "#2b6cb0", metalness: 0.1, roughness: 0.15, opacity: 0.75 } })}
              study={model.studies?.simulation}
            />
          ) : (
            <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-black/60 bg-[#2b2b2b] py-2">
              <button aria-label="Select" className="flex h-8 w-8 items-center justify-center rounded text-[#c8c8c8] hover:bg-[#3a3a3a]" onClick={() => setSel(null)} title="Deselect" type="button">
                <MousePointer2 className="h-[18px] w-[18px]" />
              </button>
              {tools.map((t) => (
                <button
                  aria-label={t.label}
                  aria-pressed={mode === t.id}
                  className={cn("flex h-8 w-8 items-center justify-center rounded", mode === t.id ? "bg-[#4772b3] text-white" : "text-[#c8c8c8] hover:bg-[#3a3a3a]")}
                  key={t.id}
                  onClick={() => setMode(t.id as GizmoMode)}
                  title={t.label}
                  type="button"
                >
                  <t.icon className="h-[18px] w-[18px]" />
                </button>
              ))}
              <span className="my-1 h-px w-6 bg-white/10" />
              {[
                { k: "box" as Primitive, icon: Box, l: "Cube" },
                { k: "sphere" as Primitive, icon: Circle, l: "UV Sphere" },
                { k: "cylinder" as Primitive, icon: Cylinder, l: "Cylinder" },
                { k: "cone" as Primitive, icon: Cone, l: "Cone" },
                { k: "plane" as Primitive, icon: Square, l: "Plane" },
              ].map((a) => (
                <button aria-label={`Add ${a.l}`} className="flex h-8 w-8 items-center justify-center rounded text-[#c8c8c8] hover:bg-[#3a3a3a]" key={a.k} onClick={() => add(a.k, a.l)} title={`Add ${a.l}`} type="button">
                  <a.icon className="h-[18px] w-[18px]" />
                </button>
              ))}
            </div>
          )}

          {/* 3D viewport */}
          <div className="relative min-w-0 flex-1 bg-[#3a3a3a]">
            <div className="absolute inset-0" ref={host} />
            <div className="pointer-events-none absolute left-3 top-2 text-[11px] text-[#d0d0d0] drop-shadow">
              <div>User Perspective</div>
              <div className="text-[#a8a8a8]">{obj ? `(${frame}) ${obj.name}` : `(${frame})`}</div>
            </div>
            <div className="absolute right-2 top-2 flex gap-0.5 rounded bg-[#2b2b2b]/90 p-0.5">
              {(["solid", "material", "wireframe"] as Shading[]).map((s) => (
                <button
                  className={cn("rounded px-2 py-0.5 text-[11px] capitalize", shading === s ? "bg-[#4772b3] text-white" : "text-[#c8c8c8] hover:bg-[#3a3a3a]")}
                  key={s}
                  onClick={() => setShading(s)}
                  type="button"
                >
                  {s === "material" ? "Material" : s}
                </button>
              ))}
            </div>
            <div className="absolute bottom-2 right-2 flex gap-0.5 rounded bg-[#2b2b2b]/90 p-0.5 text-[11px]">
              {(["front", "right", "top"] as const).map((v) => (
                <button className="rounded px-2 py-0.5 capitalize text-[#c8c8c8] hover:bg-[#3a3a3a]" key={v} onClick={() => engine.current?.view(v)} type="button">
                  {v}
                </button>
              ))}
              <button className="rounded px-2 py-0.5 text-[#c8c8c8] hover:bg-[#3a3a3a]" onClick={() => engine.current?.focus()} type="button">
                Frame all
              </button>
            </div>
          </div>

          {/* Outliner + Properties */}
          <div className="flex w-72 shrink-0 flex-col border-l border-black/60 bg-[#2b2b2b]">
            <Panel className="h-56 shrink-0" title="Outliner">
              <Outliner
                objects={model.objects}
                onRename={(id, name) => updateObj(id, { name }, "Rename")}
                onSelect={setSel}
                onToggle={(id, visible) => updateObj(id, { visible }, visible ? "Show" : "Hide")}
                selected={sel}
              />
            </Panel>
            <div className="flex min-h-0 flex-1">
              <div className="flex w-8 shrink-0 flex-col items-center gap-0.5 border-r border-black/60 bg-[#262626] py-1">
                {(
                  [
                    ["object", Shapes, "Object"],
                    ["modifiers", Wrench, "Modifiers"],
                    ["material", Circle, "Material"],
                    ["shape", Box, "Shape"],
                    ["physics", Atom, "Physics"],
                    ["world", Globe, "World"],
                  ] as const
                ).map(([id, Icon, label]) => (
                  <button
                    aria-label={label}
                    className={cn("flex h-7 w-7 items-center justify-center rounded", tab === id ? "bg-[#4772b3] text-white" : "text-[#bdbdbd] hover:bg-[#3a3a3a]")}
                    key={id}
                    onClick={() => setTab(id)}
                    title={label}
                    type="button"
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
              <div className="min-w-0 flex-1 overflow-y-auto pb-4 text-[11px]">
                <PropsPanel
                  commit={commit}
                  frame={frame}
                  model={model}
                  obj={obj}
                  onModel={(m, l) => change(m, l)}
                  onObj={(patch, l) => obj && updateObj(obj.id, patch, l)}
                  tab={tab}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className={cn("flex shrink-0 flex-col border-t border-black/60 bg-[#2b2b2b]", timelineTall ? "h-56" : "h-[5.5rem]")}>
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-black/50 px-2 text-[11px]">
            <span className="mr-1 font-semibold text-[#cfcfcf]">Timeline</span>
            <TB label="Jump to start" onClick={() => setFrame(model.frameStart)}><SkipBack className="h-3.5 w-3.5" /></TB>
            <TB label="Previous keyframe (↓)" onClick={() => jumpKey(-1)}><ChevronLeft className="h-3.5 w-3.5" /></TB>
            <TB label={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </TB>
            <TB label="Next keyframe (↑)" onClick={() => jumpKey(1)}><ChevronRight className="h-3.5 w-3.5" /></TB>
            <TB label="Jump to end" onClick={() => setFrame(model.frameEnd)}><SkipForward className="h-3.5 w-3.5" /></TB>
            <input className="ml-1 w-14 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-right" onChange={(e) => setFrame(Math.round(Number(e.target.value) || model.frameStart))} type="number" value={frame} />
            <button className="ml-2 flex items-center gap-1 rounded bg-[#3a3a3a] px-2 py-0.5 hover:bg-[#454545] disabled:opacity-40" disabled={!obj} onClick={insertKey} title="Insert keyframe (I)" type="button">
              <Diamond className="h-3 w-3 text-[#ffd75e]" /> Insert key
            </button>
            <button className="rounded bg-[#3a3a3a] px-2 py-0.5 hover:bg-[#454545] disabled:opacity-40" disabled={!obj?.keys?.some((k) => k.f === frame)} onClick={deleteKey} type="button">
              Delete key
            </button>
            <span className="flex-1" />
            <label className="flex items-center gap-1">Start<input className="w-12 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-right" onChange={(e) => change({ ...model, frameStart: Math.max(0, Math.round(Number(e.target.value))) }, "Frame range")} type="number" value={model.frameStart} /></label>
            <label className="flex items-center gap-1">End<input className="w-14 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-right" onChange={(e) => change({ ...model, frameEnd: Math.max(model.frameStart + 1, Math.round(Number(e.target.value))) }, "Frame range")} type="number" value={model.frameEnd} /></label>
            <label className="flex items-center gap-1">FPS
              <select className="rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5" onChange={(e) => change({ ...model, fps: Number(e.target.value) }, "Frame rate")} value={model.fps}>
                {[12, 24, 25, 30, 60].map((f) => <option key={f}>{f}</option>)}
              </select>
            </label>
          </div>
          <FrameTrack
            frame={frame}
            model={model}
            onFrame={setFrame}
            rows={timelineTall ? model.objects.filter((o) => o.keys?.length) : obj ? [obj] : []}
            selected={sel}
            summaryKeys={keyFrames(obj)}
          />
        </div>
      </div>
    </CreativeShell>
  );

  /** Replace a generated group (the mannequin, the garment preview). */
  function replaceGroup(objs: SceneObject[], label: string) {
    const groupName = objs[0]?.name;
    const old = modelRef.current.objects.find((o) => o.name === groupName && !o.parent);
    const gone = new Set(old ? [old.id, ...childrenOf(old.id)] : []);
    change({ ...modelRef.current, objects: [...modelRef.current.objects.filter((o) => !gone.has(o.id)), ...objs] }, label);
    setSel(objs[0]?.id ?? null);
    requestAnimationFrame(() => engine.current?.focus());
  }
}

function setKey(keys: ObjKey[], f: number, pose: { position: Vec3; rotation: Vec3; scale: Vec3 }): ObjKey[] {
  return [...keys.filter((k) => k.f !== f), { f, ...pose }].sort((a, b) => a.f - b.f);
}

function TB({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} className="flex h-6 w-6 items-center justify-center rounded text-[#cfcfcf] hover:bg-[#3a3a3a]" onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}

function FrameTrack({
  model,
  frame,
  onFrame,
  rows,
  selected,
  summaryKeys,
}: {
  model: ModelFile;
  frame: number;
  onFrame: (f: number) => void;
  rows: SceneObject[];
  selected: string | null;
  summaryKeys: number[];
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const span = Math.max(1, model.frameEnd - model.frameStart);
  const x = (f: number) => `${((f - model.frameStart) / span) * 100}%`;
  const at = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return frame;
    return Math.round(model.frameStart + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span);
  };
  const step = [1, 5, 10, 20, 50, 100, 200, 500].find((s) => (s / span) * 800 >= 36) ?? 1000;
  const ticks: number[] = [];
  for (let f = Math.ceil(model.frameStart / step) * step; f <= model.frameEnd; f += step) ticks.push(f);
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-3">
      <div
        className="relative h-full min-h-10 cursor-pointer"
        onPointerDown={(e) => {
          onFrame(at(e.clientX));
          const move = (ev: PointerEvent) => onFrame(at(ev.clientX));
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        ref={ref}
      >
        {ticks.map((f) => (
          <div className="absolute bottom-0 top-0 border-l border-white/10" key={f} style={{ left: x(f) }}>
            <span className="absolute left-1 top-0.5 text-[10px] text-[#8a8a8a]">{f}</span>
          </div>
        ))}
        <div className="absolute inset-x-0 top-5">
          {rows.length === 0 ? (
            <div className="relative h-5">
              {summaryKeys.map((f) => (
                <span className="absolute top-1 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-black/60 bg-[#ffd75e]" key={f} style={{ left: x(f) }} />
              ))}
            </div>
          ) : (
            rows.map((o) => (
              <div className={cn("relative h-5 border-b border-white/5", o.id === selected && "bg-white/5")} key={o.id}>
                <span className="absolute -left-0.5 top-0.5 z-10 max-w-28 truncate text-[10px] text-[#9a9a9a]">{rows.length > 1 ? o.name : ""}</span>
                {[...new Set((o.keys ?? []).map((k) => k.f))].map((f) => (
                  <span
                    className={cn("absolute top-1 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-black/60", o.id === selected ? "bg-[#ffd75e]" : "bg-[#d8d8d8]")}
                    key={f}
                    style={{ left: x(f) }}
                  />
                ))}
              </div>
            ))
          )}
        </div>
        <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-[#4772b3]" style={{ left: x(frame) }}>
          <span className="absolute -top-0 left-1/2 -translate-x-1/2 rounded bg-[#4772b3] px-1 text-[10px] text-white">{frame}</span>
        </div>
      </div>
    </div>
  );
}

function Outliner({
  objects,
  selected,
  onSelect,
  onToggle,
  onRename,
}: {
  objects: SceneObject[];
  selected: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, visible: boolean) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const rows: { o: SceneObject; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const o of objects) {
      if ((o.parent ?? undefined) !== parent) continue;
      rows.push({ o, depth });
      walk(o.id, depth + 1);
    }
  };
  walk(undefined, 0);
  // Orphans whose parent is gone.
  for (const o of objects) if (o.parent && !objects.some((p) => p.id === o.parent) && !rows.some((r) => r.o.id === o.id)) rows.push({ o, depth: 0 });
  return (
    <ul className="py-0.5 text-[12px]">
      <li className="flex items-center gap-1.5 px-2 py-0.5 text-[#9a9a9a]">
        <Layers className="h-3.5 w-3.5" /> Scene Collection
      </li>
      {rows.map(({ o, depth }) => (
        <li key={o.id}>
          <div
            aria-selected={o.id === selected}
            className={cn("flex h-6 cursor-default items-center gap-1.5 pr-2", o.id === selected ? "bg-[#4772b3]/60 text-white" : "hover:bg-[#333]")}
            onClick={() => onSelect(o.id)}
            onKeyDown={() => {}}
            role="option"
            style={{ paddingLeft: 14 + depth * 14 }}
            tabIndex={-1}
          >
            <KindIcon kind={o.kind} />
            {renaming === o.id ? (
              <input
                autoFocus
                className="min-w-0 flex-1 rounded border border-[#4772b3] bg-[#1e1e1e] px-1"
                defaultValue={o.name}
                onBlur={(e) => {
                  setRenaming(null);
                  if (e.target.value.trim() && e.target.value !== o.name) onRename(o.id, e.target.value.trim());
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <span className={cn("min-w-0 flex-1 truncate", !o.visible && "opacity-50")} onDoubleClick={() => setRenaming(o.id)} title="Double-click to rename">
                {o.name}
              </span>
            )}
            {o.keys?.length ? <Diamond className="h-2.5 w-2.5 text-[#ffd75e]" /> : null}
            <button
              aria-label={o.visible ? "Hide" : "Show"}
              className="text-[#b5b5b5] hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(o.id, !o.visible);
              }}
              type="button"
            >
              {o.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 opacity-50" />}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function KindIcon({ kind }: { kind: ObjectKind }) {
  const Icon = kind === "sphere" || kind === "icosphere" ? Circle : kind === "cylinder" || kind === "capsule" ? Cylinder : kind === "cone" ? Cone : kind === "plane" ? Square : kind === "empty" ? Move : kind === "import" ? Shapes : Box;
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", kind === "empty" ? "text-[#9a9a9a]" : "text-[#e3a35b]")} />;
}

function Head({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 border-b border-black/50 bg-[#262626] px-3 py-1 font-semibold text-[#cfcfcf] first:mt-0">{children}</div>;
}

function VecRow({ label, value, step = 0.1, onChange, onCommit }: { label: string; value: Vec3; step?: number; onChange: (v: Vec3) => void; onCommit: () => void }) {
  return (
    <div className="px-3 py-1">
      <div className="mb-0.5 text-[#a8a8a8]">{label}</div>
      <div className="grid grid-cols-3 gap-1">
        {(["X", "Y", "Z"] as const).map((axis, i) => (
          <label className="flex items-center overflow-hidden rounded border border-black/50 bg-[#1e1e1e]" key={axis}>
            <span className={cn("w-4 shrink-0 text-center text-[10px] font-bold", i === 0 ? "text-[#e05555]" : i === 1 ? "text-[#7bc043]" : "text-[#4a90e2]")}>{axis}</span>
            <input
              className="w-full min-w-0 bg-transparent px-1 py-0.5 text-right outline-none"
              onBlur={onCommit}
              onChange={(e) => {
                const v = [...value] as Vec3;
                v[i] = Number(e.target.value);
                onChange(v);
              }}
              step={step}
              type="number"
              value={Math.round(value[i] * 1000) / 1000}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function PropsPanel({
  tab,
  obj,
  model,
  frame,
  onObj,
  onModel,
  commit,
}: {
  tab: PropTab;
  obj?: SceneObject;
  model: ModelFile;
  frame: number;
  onObj: (patch: Partial<SceneObject>, label?: string) => void;
  onModel: (m: ModelFile, label?: string) => void;
  commit: (label: string) => void;
}) {
  if (tab === "world") {
    const w = model.world;
    const setW = (patch: Partial<ModelFile["world"]>, label?: string) => onModel({ ...model, world: { ...w, ...patch } }, label);
    return (
      <>
        <Head>World</Head>
        <label className="flex items-center gap-2 px-3 py-1">
          <span className="w-20 text-[#a8a8a8]">Background</span>
          <input className="h-5 w-8 cursor-pointer rounded border border-black/50 bg-transparent" onBlur={() => commit("Background")} onChange={(e) => setW({ background: e.target.value })} type="color" value={toSix(w.background)} />
        </label>
        <Slider label="Sun height" max={90} min={0} onChange={(sun) => setW({ sun })} onCommit={() => commit("Sun")} unit="°" value={w.sun} />
        <Slider label="Ambient" max={3} min={0} onChange={(ambient) => setW({ ambient })} onCommit={() => commit("Ambient")} step={0.05} value={w.ambient} />
        <label className="flex items-center gap-2 px-3 py-1">
          <input checked={w.grid} onChange={(e) => setW({ grid: e.target.checked }, "Grid")} type="checkbox" /> Show floor grid
        </label>
      </>
    );
  }
  if (!obj) return <p className="p-3 text-[#8a8a8a]">Select an object in the viewport or the Outliner.</p>;
  const pose = poseAt(obj, frame);
  const keyed = !!obj.keys?.length;
  const setPose = (prop: "position" | "rotation" | "scale", v: Vec3) => {
    if (keyed) onObj({ keys: setKey(obj.keys ?? [], frame, { ...pose, [prop]: v }) });
    else onObj({ [prop]: v });
  };
  if (tab === "object") {
    return (
      <>
        <Head>{obj.name}</Head>
        <VecRow label={`Location (m)${keyed ? " · keyed" : ""}`} onChange={(v) => setPose("position", v)} onCommit={() => commit("Location")} value={pose.position} />
        <VecRow label="Rotation (°)" onChange={(v) => setPose("rotation", v)} onCommit={() => commit("Rotation")} step={5} value={pose.rotation} />
        <VecRow label="Scale" onChange={(v) => setPose("scale", v)} onCommit={() => commit("Scale")} value={pose.scale} />
        <label className="flex items-center gap-2 px-3 py-1">
          <span className="w-12 text-[#a8a8a8]">Parent</span>
          <select
            className="min-w-0 flex-1 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5"
            onChange={(e) => onObj({ parent: e.target.value || undefined }, "Parent")}
            value={obj.parent ?? ""}
          >
            <option value="">(none)</option>
            {model.objects
              .filter((o) => o.id !== obj.id)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        </label>
      </>
    );
  }
  if (tab === "modifiers") {
    const a = obj.array;
    return (
      <>
        <Head>Modifiers</Head>
        <label className="flex items-center gap-2 px-3 py-1">
          <input checked={!!a} onChange={(e) => onObj({ array: e.target.checked ? { count: 3, offset: [1.2, 0, 0] } : undefined }, "Array modifier")} type="checkbox" />
          Array
        </label>
        {a ? (
          <>
            <Slider label="Count" max={50} min={1} onChange={(count) => onObj({ array: { ...a, count: Math.round(count) } })} onCommit={() => commit("Array count")} value={a.count} />
            <VecRow label="Offset (m)" onChange={(offset) => onObj({ array: { ...a, offset } })} onCommit={() => commit("Array offset")} value={a.offset} />
          </>
        ) : (
          <p className="px-3 text-[#8a8a8a]">Repeat the object in a row, a stack or a grid of copies.</p>
        )}
      </>
    );
  }
  if (tab === "material") {
    if (obj.kind === "empty") return <p className="p-3 text-[#8a8a8a]">An empty has no material.</p>;
    const m: Material = obj.material ?? DEFAULT_MATERIAL;
    const setM = (patch: Partial<Material>, label?: string) => onObj({ material: { ...m, ...patch } }, label);
    return (
      <>
        <Head>Material · Principled</Head>
        {obj.kind === "import" ? <p className="px-3 py-1 text-[#8a8a8a]">An imported model keeps its own materials.</p> : null}
        <label className="flex items-center gap-2 px-3 py-1">
          <span className="w-20 text-[#a8a8a8]">Base Color</span>
          <input className="h-5 w-8 cursor-pointer rounded border border-black/50 bg-transparent" onBlur={() => commit("Base colour")} onChange={(e) => setM({ color: e.target.value })} type="color" value={toSix(m.color)} />
        </label>
        <Slider label="Metallic" max={1} min={0} onChange={(metalness) => setM({ metalness })} onCommit={() => commit("Metallic")} step={0.01} value={m.metalness} />
        <Slider label="Roughness" max={1} min={0} onChange={(roughness) => setM({ roughness })} onCommit={() => commit("Roughness")} step={0.01} value={m.roughness} />
        <Slider label="Alpha" max={1} min={0} onChange={(opacity) => setM({ opacity })} onCommit={() => commit("Alpha")} step={0.01} value={m.opacity} />
        <label className="flex items-center gap-2 px-3 py-1">
          <span className="w-20 text-[#a8a8a8]">Emission</span>
          <input className="h-5 w-8 cursor-pointer rounded border border-black/50 bg-transparent" onBlur={() => commit("Emission")} onChange={(e) => setM({ emissive: e.target.value, emissiveIntensity: m.emissiveIntensity ?? 1 })} type="color" value={toSix(m.emissive ?? "#000000")} />
        </label>
        <label className="flex items-center gap-2 px-3 py-1">
          <input checked={!!m.flat} onChange={(e) => setM({ flat: e.target.checked }, "Shade flat")} type="checkbox" /> Shade flat
          <input checked={!!m.wireframe} className="ml-3" onChange={(e) => setM({ wireframe: e.target.checked }, "Wireframe")} type="checkbox" /> Wireframe
        </label>
      </>
    );
  }
  if (tab === "shape") {
    const p = obj.params ?? {};
    const fields: { key: keyof Params; label: string; max: number; step: number }[] = [];
    const d = defaultParams(obj.kind);
    const LABEL: Record<keyof Params, string> = { width: "Width", height: "Height", depth: "Depth", radius: "Radius", radiusTop: "Top radius", tube: "Tube", segments: obj.kind === "icosphere" ? "Subdivisions" : "Segments" };
    for (const k of Object.keys(d) as (keyof Params)[]) {
      fields.push({ key: k, label: LABEL[k], max: k === "segments" ? (obj.kind === "icosphere" ? 6 : 128) : 20, step: k === "segments" ? 1 : 0.01 });
    }
    if (!fields.length) return <p className="p-3 text-[#8a8a8a]">{obj.kind === "import" ? "An imported model's shape comes from its file." : "No shape settings."}</p>;
    return (
      <>
        <Head>Shape · {obj.kind}</Head>
        {fields.map((f) => (
          <Slider
            key={f.key}
            label={f.label}
            max={f.max}
            min={f.key === "segments" ? (obj.kind === "icosphere" ? 0 : 3) : 0.01}
            onChange={(v) => onObj({ params: { ...p, [f.key]: f.key === "segments" ? Math.round(v) : v } })}
            onCommit={() => commit(f.label)}
            step={f.step}
            unit={f.key === "segments" ? "" : "m"}
            value={(p[f.key] ?? d[f.key]) as number}
          />
        ))}
      </>
    );
  }
  // physics
  const ph = obj.physics;
  return (
    <>
      <Head>Rigid Body</Head>
      <div className="flex gap-1 px-3 py-1">
        {(["none", "active", "passive"] as const).map((t) => (
          <button
            className={cn("flex-1 rounded px-2 py-0.5 capitalize", (ph?.type ?? "none") === t ? "bg-[#4772b3] text-white" : "bg-[#3a3a3a] hover:bg-[#454545]")}
            key={t}
            onClick={() => onObj({ physics: t === "none" ? undefined : { type: t, mass: ph?.mass ?? 1, bounce: ph?.bounce ?? 0.3, friction: ph?.friction ?? 0.5 } }, "Rigid body")}
            type="button"
          >
            {t}
          </button>
        ))}
      </div>
      {ph ? (
        <>
          <Slider label="Mass (kg)" max={1000} min={0.01} onChange={(mass) => onObj({ physics: { ...ph, mass } })} onCommit={() => commit("Mass")} step={0.1} value={ph.mass} />
          <Slider label="Bounciness" max={1} min={0} onChange={(bounce) => onObj({ physics: { ...ph, bounce } })} onCommit={() => commit("Bounciness")} step={0.01} value={ph.bounce} />
          <p className="px-3 pt-1 text-[#8a8a8a]">Active bodies fall and bounce; passive ones hold them up. Bake it in the Simulation workspace.</p>
        </>
      ) : null}
    </>
  );
}

function Field({ label, value, onChange, unit, type = "number" }: { label: string; value: string | number; onChange: (v: string) => void; unit?: string; type?: string }) {
  return (
    <label className="flex items-center gap-2 px-3 py-1 text-[11px]">
      <span className="w-28 shrink-0 text-[#a8a8a8]">{label}</span>
      <input className="min-w-0 flex-1 rounded border border-black/50 bg-[#1e1e1e] px-1.5 py-0.5 text-right" onChange={(e) => onChange(e.target.value)} type={type} value={value} />
      {unit ? <span className="w-6 text-[#8a8a8a]">{unit}</span> : null}
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 px-3 py-1 text-[11px]">
      <span className="w-28 shrink-0 text-[#a8a8a8]">{label}</span>
      <select className="min-w-0 flex-1 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5" onChange={(e) => onChange(e.target.value)} value={value}>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function ClothingPanel({
  study,
  onBuild,
  onAsk,
}: {
  study?: Record<string, string | number>;
  onBuild: (objs: SceneObject[], label: string) => void;
  onAsk: (kind: "clothing", brief: string, study: Record<string, string | number>) => Promise<void>;
}) {
  const [s, setS] = React.useState<Record<string, string | number>>({
    body: "Man",
    height: 175,
    chest: 100,
    waist: 84,
    hips: 100,
    garment: "T-shirt",
    fit: "Regular",
    fabric: "Cotton jersey",
    sizes: "M",
    notes: "",
    ...(study ?? {}),
  });
  const set = (k: string) => (v: string) => setS((x) => ({ ...x, [k]: Number.isNaN(Number(v)) || v === "" || typeof x[k] === "string" ? v : Number(v) }));
  const [busy, setBusy] = React.useState(false);
  const n = (k: string) => Number(s[k]) || 0;
  return (
    <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-black/60 bg-[#2b2b2b] pb-4">
      <Head>Body</Head>
      <Select label="Body" onChange={set("body")} options={["Man", "Woman", "Neutral"]} value={String(s.body)} />
      <Field label="Height" onChange={set("height")} unit="cm" value={s.height} />
      <Field label="Chest / bust" onChange={set("chest")} unit="cm" value={s.chest} />
      <Field label="Waist" onChange={set("waist")} unit="cm" value={s.waist} />
      <Field label="Hips" onChange={set("hips")} unit="cm" value={s.hips} />
      <div className="px-3 pt-1">
        <button className="w-full rounded bg-[#3a3a3a] py-1 hover:bg-[#454545]" onClick={() => onBuild(mannequin(n("height"), n("chest"), n("waist"), n("hips")), "Build mannequin")} type="button">
          Build mannequin
        </button>
      </div>
      <Head>Garment</Head>
      <Select label="Garment" onChange={set("garment")} options={["T-shirt", "Shirt", "Hoodie", "Dress", "Skirt", "Trousers", "Jacket"]} value={String(s.garment)} />
      <Select label="Fit" onChange={set("fit")} options={["Slim", "Regular", "Relaxed", "Oversized"]} value={String(s.fit)} />
      <Select label="Fabric" onChange={set("fabric")} options={Object.keys(FABRICS)} value={String(s.fabric)} />
      <Field label="Sizes" onChange={set("sizes")} type="text" value={s.sizes} />
      <label className="block px-3 py-1 text-[11px]">
        <span className="text-[#a8a8a8]">Details</span>
        <textarea className="mt-0.5 h-16 w-full resize-none rounded border border-black/50 bg-[#1e1e1e] p-1.5" onChange={(e) => setS((x) => ({ ...x, notes: e.target.value }))} placeholder="Boxy cut, dropped shoulder, chest pocket…" value={String(s.notes)} />
      </label>
      <div className="space-y-1 px-3 pt-1">
        <button className="w-full rounded bg-[#3a3a3a] py-1 hover:bg-[#454545]" onClick={() => onBuild(garmentPreview(s), "Garment preview")} type="button">
          Preview the shape
        </button>
        <button
          className="w-full rounded bg-[#4772b3] py-1.5 font-medium text-white hover:bg-[#5582c4] disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onAsk(
              "clothing",
              `Make a ${String(s.fit).toLowerCase()} ${String(s.garment).toLowerCase()} in ${String(s.fabric).toLowerCase()}, size(s) ${s.sizes}, for a ${String(s.body).toLowerCase()} body: height ${s.height} cm, chest ${s.chest} cm, waist ${s.waist} cm, hips ${s.hips} cm.${s.notes ? ` Details: ${s.notes}` : ""} Make the sewing pattern and drape it on that body.`,
              s,
            ).finally(() => setBusy(false));
          }}
          type="button"
        >
          Pattern &amp; drape it (the Office)
        </button>
        <p className="text-[10px] leading-relaxed text-[#8a8a8a]">
          The Office runs the cloth simulation (simkit): a printable 1:1 pattern, and the drape on this body coloured by fit, which comes back into this scene as a new version.
        </p>
      </div>
    </div>
  );
}

function SimulationPanel({
  obj,
  study,
  onPhysics,
  onBake,
  onClear,
  onWater,
  onAsk,
}: {
  obj?: SceneObject;
  study?: Record<string, string | number>;
  onPhysics: (p: SceneObject["physics"]) => void;
  onBake: () => void;
  onClear: () => void;
  onWater: () => void;
  onAsk: (kind: "simulation", brief: string, study: Record<string, string | number>) => Promise<void>;
}) {
  const [s, setS] = React.useState<Record<string, string | number>>({
    type: "Boat on water",
    length: 2.6,
    beam: 1.05,
    mass: 120,
    waves: 0.3,
    speed: 15,
    span: 1.2,
    chord: 0.25,
    question: "",
    ...(study ?? {}),
  });
  const set = (k: string) => (v: string) => setS((x) => ({ ...x, [k]: typeof x[k] === "number" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v }));
  const [busy, setBusy] = React.useState(false);
  const ph = obj?.physics;
  const brief = () => {
    const q = String(s.question).trim();
    if (s.type === "Boat on water")
      return `Boat on water: hull ${s.length} m long, ${s.beam} m beam, ${s.mass} kg loaded, in ${s.waves} m waves. ${q || "Will it float level and stay upright? Show draft, freeboard, stability (GM, GZ curve) and its motion in the waves."}`;
    if (s.type === "Aircraft / wing")
      return `Aircraft or wing: span ${s.span} m, chord ${s.chord} m, ${s.mass} kg, flying at ${s.speed} m/s. ${q || "Lift, drag, stall speed, glide and stability, with the airflow shown."}`;
    return `Wind tunnel: the model in this scene in a ${s.speed} m/s wind. ${q || "Show the airflow and the forces on it."}`;
  };
  return (
    <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-black/60 bg-[#2b2b2b] pb-4 text-[11px]">
      <Head>Rigid body (here)</Head>
      <p className="px-3 py-1 text-[#8a8a8a]">{obj ? `Selected: ${obj.name}` : "Select an object to give it physics."}</p>
      <div className="flex gap-1 px-3 py-1">
        {(["none", "active", "passive"] as const).map((t) => (
          <button
            className={cn("flex-1 rounded px-2 py-0.5 capitalize disabled:opacity-40", (ph?.type ?? "none") === t ? "bg-[#4772b3] text-white" : "bg-[#3a3a3a] hover:bg-[#454545]")}
            disabled={!obj}
            key={t}
            onClick={() => onPhysics(t === "none" ? undefined : { type: t, mass: ph?.mass ?? 1, bounce: ph?.bounce ?? 0.3, friction: ph?.friction ?? 0.5 })}
            type="button"
          >
            {t}
          </button>
        ))}
      </div>
      {ph ? <Slider label="Bounciness" max={1} min={0} onChange={(bounce) => onPhysics({ ...ph, bounce })} step={0.01} value={ph.bounce} /> : null}
      <div className="flex gap-1 px-3 py-1">
        <button className="flex-1 rounded bg-[#4772b3] py-1 font-medium text-white hover:bg-[#5582c4]" onClick={onBake} type="button">
          Bake &amp; play
        </button>
        <button className="rounded bg-[#3a3a3a] px-2 py-1 hover:bg-[#454545]" onClick={onClear} type="button">
          Clear bake
        </button>
      </div>
      <p className="px-3 text-[#8a8a8a]">Active bodies drop under gravity onto the floor and onto passive bodies, baked into keyframes you can export.</p>

      <Head>Engineering study (the Office)</Head>
      <Select label="Study" onChange={set("type")} options={["Boat on water", "Aircraft / wing", "Wind tunnel"]} value={String(s.type)} />
      {s.type === "Boat on water" ? (
        <>
          <Field label="Hull length" onChange={set("length")} unit="m" value={s.length} />
          <Field label="Beam" onChange={set("beam")} unit="m" value={s.beam} />
          <Field label="Loaded mass" onChange={set("mass")} unit="kg" value={s.mass} />
          <Field label="Wave height" onChange={set("waves")} unit="m" value={s.waves} />
          <div className="px-3 py-1">
            <button className="w-full rounded bg-[#3a3a3a] py-1 hover:bg-[#454545]" onClick={onWater} type="button">
              Add a water surface
            </button>
          </div>
        </>
      ) : s.type === "Aircraft / wing" ? (
        <>
          <Field label="Span" onChange={set("span")} unit="m" value={s.span} />
          <Field label="Chord" onChange={set("chord")} unit="m" value={s.chord} />
          <Field label="Mass" onChange={set("mass")} unit="kg" value={s.mass} />
          <Field label="Speed" onChange={set("speed")} unit="m/s" value={s.speed} />
        </>
      ) : (
        <Field label="Wind speed" onChange={set("speed")} unit="m/s" value={s.speed} />
      )}
      <label className="block px-3 py-1">
        <span className="text-[#a8a8a8]">Question</span>
        <textarea className="mt-0.5 h-16 w-full resize-none rounded border border-black/50 bg-[#1e1e1e] p-1.5" onChange={(e) => setS((x) => ({ ...x, question: e.target.value }))} placeholder="Will it stay upright with an 85 kg rider?" value={String(s.question)} />
      </label>
      <div className="px-3 pt-1">
        <button
          className="w-full rounded bg-[#4772b3] py-1.5 font-medium text-white hover:bg-[#5582c4] disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onAsk("simulation", `${brief()} Use the objects in this scene as the shape where they fit.`, s).finally(() => setBusy(false));
          }}
          type="button"
        >
          Run it (the Office)
        </button>
        <p className="mt-1 text-[10px] leading-relaxed text-[#8a8a8a]">
          The Office runs it with simkit (hydrostatics, waves, lift and drag) and sends back an animated result into this scene plus a report with the numbers.
        </p>
      </div>
    </div>
  );
}

/** A dress-form mannequin from four measurements (cm), in metres. */
export function mannequin(heightCm: number, chestCm: number, waistCm: number, hipsCm: number): SceneObject[] {
  const H = Math.max(0.5, heightCm / 100);
  const r = (c: number) => Math.max(0.05, c / 100 / (2 * Math.PI));
  const rc = r(chestCm);
  const rw = r(waistCm);
  const rh = r(hipsCm);
  const skin: Material = { color: "#d9cbbd", metalness: 0, roughness: 0.7, opacity: 1 };
  const root: SceneObject = { id: oid(), name: "Mannequin", kind: "empty", visible: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const oval: Vec3 = [1.18, 1, 0.78];
  const part = (name: string, kind: ObjectKind, params: Params, pos: Vec3, rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]): SceneObject => ({
    id: oid(),
    name,
    kind,
    parent: root.id,
    visible: true,
    position: pos,
    rotation: rot,
    scale,
    params: { ...defaultParams(kind), ...params },
    material: skin,
  });
  const legR = rh * 0.42;
  return [
    root,
    part("Hips", "cylinder", { radius: rh * 0.95, radiusTop: rh, height: H * 0.1 }, [0, H * 0.5, 0], [0, 0, 0], oval),
    part("Waist", "cylinder", { radius: rh, radiusTop: rw, height: H * 0.08 }, [0, H * 0.59, 0], [0, 0, 0], oval),
    part("Chest", "cylinder", { radius: rw, radiusTop: rc, height: H * 0.13 }, [0, H * 0.695, 0], [0, 0, 0], oval),
    part("Shoulders", "capsule", { radius: rc * 0.55, height: rc * 1.5 }, [0, H * 0.78, 0], [0, 0, 90], [1, 1, 0.75]),
    part("Neck", "cylinder", { radius: H * 0.032, radiusTop: H * 0.03, height: H * 0.06 }, [0, H * 0.83, 0]),
    part("Head", "sphere", { radius: H * 0.064 }, [0, H * 0.915, 0], [0, 0, 0], [0.86, 1.05, 0.95]),
    part("Leg.L", "capsule", { radius: legR, height: H * 0.4 }, [rh * 0.5, H * 0.26, 0], [0, 0, 1.5]),
    part("Leg.R", "capsule", { radius: legR, height: H * 0.4 }, [-rh * 0.5, H * 0.26, 0], [0, 0, -1.5]),
    part("Arm.L", "capsule", { radius: H * 0.026, height: H * 0.3 }, [rc * 1.25 + 0.04, H * 0.6, 0], [0, 0, 7]),
    part("Arm.R", "capsule", { radius: H * 0.026, height: H * 0.3 }, [-(rc * 1.25 + 0.04), H * 0.6, 0], [0, 0, -7]),
  ];
}

/** A rough shell of the garment over the mannequin (the real drape comes
 *  from the Office). */
function garmentPreview(s: Record<string, string | number>): SceneObject[] {
  const H = Math.max(0.5, Number(s.height) / 100);
  const r = (c: number) => Math.max(0.05, c / 100 / (2 * Math.PI));
  const ease = { Slim: 1.03, Regular: 1.08, Relaxed: 1.14, Oversized: 1.24 }[String(s.fit)] ?? 1.08;
  const rc = r(Number(s.chest)) * ease;
  const rh = r(Number(s.hips)) * ease;
  const rw = r(Number(s.waist)) * ease;
  const color = FABRICS[String(s.fabric)] ?? "#cccccc";
  const mat: Material = { color, metalness: 0, roughness: 0.9, opacity: 0.92 };
  const root: SceneObject = { id: oid(), name: "Garment preview", kind: "empty", visible: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const oval: Vec3 = [1.18, 1, 0.8];
  const piece = (name: string, kind: ObjectKind, params: Params, pos: Vec3, rot: Vec3 = [0, 0, 0], scale: Vec3 = oval): SceneObject => ({
    id: oid(), name, kind, parent: root.id, visible: true, position: pos, rotation: rot, scale, params: { ...defaultParams(kind), ...params }, material: mat,
  });
  const g = String(s.garment);
  const out: SceneObject[] = [root];
  const top = g === "T-shirt" || g === "Shirt" || g === "Hoodie" || g === "Jacket" || g === "Dress";
  if (top) {
    const hem = g === "Dress" ? H * 0.3 : g === "Jacket" || g === "Hoodie" ? H * 0.47 : H * 0.5;
    const len = H * 0.79 - hem;
    out.push(piece("Body", "cylinder", { radius: g === "Dress" ? rh * 1.25 : Math.max(rh, rc) * 1.02, radiusTop: rc * 1.02, height: len, segments: 40 }, [0, hem + len / 2, 0]));
    const sleeve = g === "T-shirt" ? H * 0.12 : H * 0.3;
    for (const side of [1, -1]) {
      out.push(piece(`Sleeve.${side > 0 ? "L" : "R"}`, "cylinder", { radius: H * 0.038 * ease, radiusTop: H * 0.05 * ease, height: sleeve, segments: 24 }, [side * (rc * 1.25 + 0.04), H * 0.765 - sleeve / 2, 0], [0, 0, side * 7], [1, 1, 1]));
    }
    if (g === "Hoodie") out.push(piece("Hood", "sphere", { radius: H * 0.08 }, [0, H * 0.86, -H * 0.03], [0, 0, 0], [1, 1.05, 1]));
  }
  if (g === "Skirt") out.push(piece("Skirt", "cylinder", { radius: rh * 1.35, radiusTop: rw, height: H * 0.28, segments: 40 }, [0, H * 0.45, 0]));
  if (g === "Trousers") {
    out.push(piece("Seat", "cylinder", { radius: rh, radiusTop: rw, height: H * 0.1, segments: 32 }, [0, H * 0.52, 0]));
    for (const side of [1, -1]) {
      out.push(piece(`Leg.${side > 0 ? "L" : "R"}`, "cylinder", { radius: rh * 0.42 * ease, radiusTop: rh * 0.55, height: H * 0.44, segments: 24 }, [side * rh * 0.5, H * 0.25, 0], [0, 0, side * 1.5], [1, 1, 1]));
    }
  }
  return out;
}
