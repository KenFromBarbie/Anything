import * as React from "react";
import * as THREE from "three";
import { ArrowDown, ArrowUp, Crosshair, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";

import { curveWorld } from "./cad";
import { exportFile } from "./editorStore";
import { type FrameResult, type FrameStudy, MATERIALS, type MaterialId, type Section, sectionProps, solveFrame } from "./frameFea";
import type { Tris } from "./marine";
import { DENSITIES, type MassProps, massProps } from "./massProps";
import type { ModelFile, SceneObject, Vec3 } from "./modelFormat";
import {
  applyJoints,
  bakeProgram,
  gripper,
  type JointDef,
  jointsTo,
  type ProgramRun,
  type ProgramStep,
  reachCloud,
  type RobotProgram,
  runProgram,
  scaraArm,
  sixAxisArm,
  solveIk,
  toolPose,
} from "./robotics";

export type CadApi = {
  tris: (id: string) => Tris | null;
  overlay: (key: string, obj: THREE.Object3D | null) => void;
  section: (cut: { axis: "x" | "y" | "z"; at: number; flip?: boolean } | null) => void;
  /** The next click in the view gives a point. */
  pick: (cb: (p: Vec3) => void) => void;
};

type Common = {
  model: ModelFile;
  selected?: SceneObject;
  api: CadApi;
  /** live change (no undo step) / with a label: an undo step */
  change: (m: ModelFile, label?: string) => void;
  onPlay?: () => void;
};

const head = "mt-2 border-b border-black/50 bg-[#262626] px-3 py-1 font-semibold text-[#cfcfcf]";
const inp = "rounded border border-black/50 bg-[#1e1e1e] px-1.5 py-0.5 text-right";
const btn = "rounded bg-[#3a3a3a] px-2 py-1 hover:bg-[#454545] disabled:opacity-40";
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

function Shell({ tabs, tab, onTab, children }: { tabs: string[]; tab: string; onTab: (t: string) => void; children: React.ReactNode }) {
  return (
    <div className="flex w-[23rem] shrink-0 flex-col border-r border-black/60 bg-[#2b2b2b] text-[11px]">
      <div className="flex flex-wrap gap-0.5 border-b border-black/60 bg-[#262626] p-1">
        {tabs.map((t) => (
          <button className={cn("rounded px-2 py-1", tab === t ? "bg-[#4772b3] text-white" : "text-[#bdbdbd] hover:bg-[#3a3a3a]")} key={t} onClick={() => onTab(t)} type="button">
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">{children}</div>
    </div>
  );
}

function Num({ value, onChange, step = 0.01, w = "w-16", onBlur }: { value: number; onChange: (v: number) => void; step?: number; w?: string; onBlur?: () => void }) {
  return <input className={cn(inp, w)} onBlur={onBlur} onChange={(e) => onChange(Number(e.target.value))} step={step} type="number" value={Math.round(value * 10000) / 10000} />;
}

// ─── Joints on your own parts ──────────────────────────────────────────────

/** Give the selected part a joint (it turns or slides relative to its parent). */
function JointEditor({ model, selected, change }: { model: ModelFile; selected?: SceneObject; change: Common["change"] }) {
  if (!selected) return <p className="px-3 py-1 text-[#8a8a8a]">Select a part to give it a joint.</p>;
  const j = selected.joint;
  const set = (patch: Partial<JointDef> | null, label: string) => {
    const objects = model.objects.map((o) => {
      if (o.id !== selected.id) return o;
      if (!patch) {
        const home = o.joint?.home;
        const { joint: _drop, ...rest } = o;
        return home ? { ...rest, position: home.position, rotation: home.rotation } : rest;
      }
      const base: JointDef = o.joint ?? { type: "revolute", axis: [0, 1, 0], min: -180, max: 180, value: 0, home: { position: [...o.position] as Vec3, rotation: [...o.rotation] as Vec3 } };
      return { ...o, joint: { ...base, ...patch } };
    });
    change({ ...model, objects: applyJoints(objects) }, label);
  };
  const axisName = (a: Vec3) => (a[0] ? "X" : a[2] ? "Z" : "Y") + ((a[0] || a[1] || a[2]) < 0 ? "−" : "");
  if (!j) {
    return (
      <div className="flex flex-wrap items-center gap-1 px-3 py-1">
        <span className="text-[#bdbdbd]">{selected.name}:</span>
        <button className={btn} onClick={() => set({ type: "revolute", min: -180, max: 180 }, "Add revolute joint")} type="button">Turning joint</button>
        <button className={btn} onClick={() => set({ type: "prismatic", min: 0, max: 0.3 }, "Add sliding joint")} type="button">Sliding joint</button>
        {!selected.parent ? <span className="w-full text-[10px] text-[#d9a441]">Parent it to the link it moves on first (Outliner → drag onto its parent).</span> : null}
      </div>
    );
  }
  return (
    <div className="space-y-1 px-3 py-1">
      <div className="flex items-center gap-1">
        <span className="w-24 truncate text-[#bdbdbd]">{selected.name}</span>
        <select className={inp} onChange={(e) => set({ type: e.target.value as JointDef["type"], ...(e.target.value === "prismatic" ? { min: 0, max: 0.3, value: 0 } : { min: -180, max: 180, value: 0 }) }, "Joint type")} value={j.type}>
          <option value="revolute">Turning</option>
          <option value="prismatic">Sliding</option>
          <option value="fixed">Fixed</option>
        </select>
        <span className="text-[#bdbdbd]">axis</span>
        <select
          className={inp}
          onChange={(e) => {
            const m: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1], "X−": [-1, 0, 0], "Y−": [0, -1, 0], "Z−": [0, 0, -1] };
            set({ axis: m[e.target.value] }, "Joint axis");
          }}
          value={axisName(j.axis)}
        >
          {["X", "Y", "Z", "X−", "Y−", "Z−"].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-24 text-[#bdbdbd]">Limits ({j.type === "prismatic" ? "m" : "°"})</span>
        <Num onChange={(v) => set({ min: Math.min(v, j.max) }, "Joint limits")} step={j.type === "prismatic" ? 0.01 : 5} value={j.min} w="w-14" />
        <span>…</span>
        <Num onChange={(v) => set({ max: Math.max(v, j.min) }, "Joint limits")} step={j.type === "prismatic" ? 0.01 : 5} value={j.max} w="w-14" />
        <span className="text-[#bdbdbd]">speed</span>
        <Num onChange={(v) => set({ maxVel: Math.max(0.001, v) }, "Joint speed")} step={j.type === "prismatic" ? 0.05 : 10} value={j.maxVel ?? (j.type === "prismatic" ? 0.5 : 120)} w="w-14" />
      </div>
      <div className="flex gap-1">
        <button className={btn} onClick={() => set({ home: { position: [...selected.position] as Vec3, rotation: [...selected.rotation] as Vec3 }, value: 0 }, "Set joint home")} title="Make the current pose this joint's zero" type="button">Set home here</button>
        <button className={btn} onClick={() => set(null, "Remove joint")} type="button">Remove joint</button>
      </div>
    </div>
  );
}

// ─── Robotics ───────────────────────────────────────────────────────────────

/** Robots: joints, inverse kinematics, programs with checks, reach. */
export function RoboticsPanel({ model, api, change, onPlay, selected }: Common) {
  const [tab, setTab] = React.useState("Joints");
  const prog = model.studies?.robot;
  const setProg = (p: RobotProgram, label?: string) => change({ ...model, studies: { ...model.studies, robot: p } }, label);
  const tool = prog?.tool && model.objects.some((o) => o.id === prog.tool) ? prog.tool : null;
  const tip = prog?.tip ?? [0, 0, 0];
  const joints = tool ? jointsTo(model.objects, tool) : [];
  const pose = tool ? toolPose(model.objects, tool, tip) : null;
  const [target, setTarget] = React.useState<Vec3>([0.45, 0.35, 0.2]);
  const [orient, setOrient] = React.useState<Vec3 | null>(null);
  const [ik, setIk] = React.useState<{ error: number; reached: boolean } | null>(null);
  const [jog, setJog] = React.useState(0.01);
  const [run, setRun] = React.useState<ProgramRun | null>(null);
  const [reach, setReach] = React.useState<number | null>(null);

  // overlays: IK target, program path
  React.useEffect(() => {
    if (tab !== "IK") return api.overlay("ik-target", null);
    const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.015, 16, 12), new THREE.MeshBasicMaterial({ color: ik?.reached === false ? "#ff5252" : "#ffd75e", depthTest: false }));
    s.renderOrder = 10;
    g.add(s, new THREE.AxesHelper(0.08));
    g.position.set(...target);
    if (orient) g.rotation.set((orient[0] * Math.PI) / 180, (orient[1] * Math.PI) / 180, (orient[2] * Math.PI) / 180);
    api.overlay("ik-target", g);
    return () => api.overlay("ik-target", null);
  }, [tab, target, orient, ik?.reached, api]);
  React.useEffect(() => {
    if (!run?.path.length) return api.overlay("robot-path", null);
    const g = new THREE.BufferGeometry().setFromPoints(run.path.map((p) => new THREE.Vector3(...p)));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: run.issues.length ? "#ff9f43" : "#5ad1e6", depthTest: false }));
    line.renderOrder = 9;
    api.overlay("robot-path", line);
    return () => api.overlay("robot-path", null);
  }, [run, api]);
  React.useEffect(() => () => api.overlay("robot-reach", null), [api]);

  const addRobot = (kind: "arm" | "scara") => {
    const r = kind === "arm" ? sixAxisArm() : scaraArm();
    const next: ModelFile = { ...model, objects: [...model.objects, ...applyJoints(r.objects)], studies: { ...model.studies, robot: { tool: r.tool, tip: r.tip, steps: [], speed: 50 } } };
    change(next, kind === "arm" ? "Add 6-axis robot" : "Add SCARA robot");
    toast.success(kind === "arm" ? "6-axis arm added: move it from Joints or IK" : "SCARA added");
  };
  const addGripper = () => {
    if (!tool) return;
    const parts = gripper(tool, [tip[0], tip[1] - 0.04, tip[2]]);
    change({ ...model, objects: [...model.objects, ...applyJoints(parts)], studies: { ...model.studies, robot: { ...(prog as RobotProgram), tip: [tip[0], tip[1] + 0.07, tip[2]] } } }, "Add gripper");
  };

  const setValues = (vals: Map<string, number>, label?: string) => {
    const objects = applyJoints(model.objects.map((o) => (o.joint && vals.has(o.id) ? { ...o, joint: { ...o.joint, value: vals.get(o.id) as number } } : o)));
    change({ ...model, objects }, label);
  };
  const solve = (t: Vec3, o: Vec3 | null, label?: string) => {
    if (!tool) return;
    const r = solveIk(model.objects, tool, { position: t, rotation: o ?? undefined }, { tip });
    setIk({ error: r.error, reached: r.reached });
    setValues(r.values, label);
  };

  if (!tool) {
    return (
      <Shell onTab={() => {}} tab="Robot" tabs={["Robot"]}>
        <div className={head}>Add a robot</div>
        <p className="px-3 py-1 text-[#8a8a8a]">Start from a ready-made robot, or build your own: parent links in a chain and give each moving link a joint (Properties → Joint), then pick its last link as the tool.</p>
        <div className={head}>Build your own</div>
        <JointEditor change={change} model={model} selected={selected} />
        <div className={head}>Ready-made</div>
        <div className="flex flex-wrap gap-1 px-3 py-1">
          <button className={btn} onClick={() => addRobot("arm")} type="button">6-axis arm</button>
          <button className={btn} onClick={() => addRobot("scara")} type="button">SCARA</button>
          {selected && jointsTo(model.objects, selected.id).length ? (
            <button className={btn} onClick={() => setProg({ tool: selected.id, tip: [0, 0, 0], steps: [], speed: 50 }, "Robot tool")} type="button">
              Use "{selected.name}" as the tool
            </button>
          ) : null}
        </div>
      </Shell>
    );
  }

  return (
    <Shell onTab={setTab} tab={tab} tabs={["Joints", "IK", "Program", "Reach"]}>
      <div className="flex items-center gap-2 border-b border-black/50 px-3 py-1.5 text-[#bdbdbd]">
        Tool point
        <span className="font-mono text-[#e6e6e6]">{pose ? `${fmt(pose.p.x, 3)}, ${fmt(pose.p.y, 3)}, ${fmt(pose.p.z, 3)}` : ""}</span>
        <span className="flex-1" />
        <button className={btn} onClick={addGripper} title="Put a two-finger gripper on the tool" type="button">+ Gripper</button>
      </div>

      {tab === "Joints" ? (
        <>
          <div className={head}>Joints (forward kinematics)</div>
          {joints.map((o) => {
            const j = o.joint as JointDef;
            const unit = j.type === "prismatic" ? "m" : "°";
            return (
              <label className="flex items-center gap-2 px-3 py-1" key={o.id}>
                <span className="w-28 truncate text-[#bdbdbd]" title={o.name}>{o.name}</span>
                <input
                  className="h-1 min-w-0 flex-1 accent-[#4772b3]"
                  max={j.max}
                  min={j.min}
                  onChange={(e) => setValues(new Map([[o.id, Number(e.target.value)]]))}
                  onPointerUp={() => change(model, `Move ${o.name}`)}
                  step={j.type === "prismatic" ? 0.001 : 0.5}
                  type="range"
                  value={j.value}
                />
                <Num onBlur={() => change(model, `Move ${o.name}`)} onChange={(v) => setValues(new Map([[o.id, v]]))} step={j.type === "prismatic" ? 0.001 : 1} value={j.value} w="w-14" />
                <span className="w-3 text-[#8a8a8a]">{unit}</span>
              </label>
            );
          })}
          <div className="flex gap-1 px-3 py-2">
            <button className={btn} onClick={() => setValues(new Map(joints.map((o) => [o.id, 0])), "Home")} type="button">Home</button>
          </div>
          <div className={head}>Joint on the selected part</div>
          <JointEditor change={change} model={model} selected={selected} />
        </>
      ) : null}

      {tab === "IK" ? (
        <>
          <div className={head}>Inverse kinematics</div>
          <p className="px-3 py-1 text-[#8a8a8a]">Set where the tool point should go; the joints follow (within their limits). Damped least squares, with restarts when a pose is singular.</p>
          <div className="flex items-center gap-1 px-3 py-1">
            <span className="w-14 text-[#bdbdbd]">Target</span>
            {[0, 1, 2].map((i) => (
              <Num key={i} onChange={(v) => setTarget((t) => t.map((x, k) => (k === i ? v : x)) as Vec3)} value={target[i]} />
            ))}
            <button className={btn} onClick={() => api.pick((p) => setTarget(p))} title="Click a point in the view" type="button">
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          </div>
          <label className="flex items-center gap-1 px-3 py-1">
            <input checked={!!orient} onChange={(e) => setOrient(e.target.checked ? [0, 0, 180] : null)} type="checkbox" />
            <span className="w-14 text-[#bdbdbd]">Orient</span>
            {orient ? [0, 1, 2].map((i) => <Num key={i} onChange={(v) => setOrient((t) => (t ? (t.map((x, k) => (k === i ? v : x)) as Vec3) : t))} step={1} value={orient[i]} />) : <span className="text-[#8a8a8a]">any (position only)</span>}
          </label>
          <div className="flex flex-wrap items-center gap-1 px-3 py-1">
            <span className="w-14 text-[#bdbdbd]">Jog</span>
            {(["x", "y", "z"] as const).map((ax, i) =>
              [-1, 1].map((s) => (
                <button
                  className={btn}
                  key={`${ax}${s}`}
                  onClick={() => {
                    const t = target.map((x, k) => (k === i ? x + s * jog : x)) as Vec3;
                    setTarget(t);
                    solve(t, orient, "Jog");
                  }}
                  type="button"
                >
                  {s > 0 ? "+" : "−"}
                  {ax.toUpperCase()}
                </button>
              )),
            )}
            <select className={inp} onChange={(e) => setJog(Number(e.target.value))} value={jog}>
              <option value={0.001}>1 mm</option>
              <option value={0.01}>10 mm</option>
              <option value={0.05}>50 mm</option>
            </select>
          </div>
          <div className="flex items-center gap-2 px-3 py-2">
            <button className={cn(btn, "bg-[#4772b3] text-white hover:bg-[#5582c4]")} onClick={() => solve(target, orient, "Solve IK")} type="button">Solve</button>
            <button className={btn} onClick={() => pose && setTarget([pose.p.x, pose.p.y, pose.p.z])} type="button">Target = tool</button>
            {ik ? <span className={ik.reached ? "text-[#5bd18b]" : "text-[#ff8a80]"}>{ik.reached ? "Reached" : `Out of reach: off by ${fmt(ik.error * 1000, 0)} mm`}</span> : null}
          </div>
        </>
      ) : null}

      {tab === "Program" && prog ? (
        <ProgramTab api={api} model={model} onPlay={onPlay} prog={prog} run={run} setProg={setProg} setRun={setRun} change={change} pose={pose ? [pose.p.x, pose.p.y, pose.p.z] : null} />
      ) : null}

      {tab === "Reach" ? (
        <>
          <div className={head}>Reach envelope</div>
          <p className="px-3 py-1 text-[#8a8a8a]">Where the tool point can get to, sampled over every joint's range.</p>
          <div className="flex items-center gap-2 px-3 py-1">
            <button
              className={btn}
              onClick={() => {
                const pts = reachCloud(model.objects, tool, 3000, tip);
                const base = toolPose(model.objects, jointsTo(model.objects, tool)[0]?.id ?? tool).p;
                setReach(Math.max(...pts.map((p) => Math.hypot(p[0] - base.x, p[1] - base.y, p[2] - base.z))));
                const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
                api.overlay("robot-reach", new THREE.Points(g, new THREE.PointsMaterial({ color: "#5ad1e6", size: 0.008, transparent: true, opacity: 0.55 })));
              }}
              type="button"
            >
              Show reach
            </button>
            <button className={btn} onClick={() => (api.overlay("robot-reach", null), setReach(null))} type="button">Hide</button>
            {reach != null ? <span className="text-[#e6e6e6]">Max reach {fmt(reach * 1000, 0)} mm</span> : null}
          </div>
        </>
      ) : null}
    </Shell>
  );
}

function ProgramTab({
  model,
  prog,
  setProg,
  run,
  setRun,
  change,
  onPlay,
  pose,
}: {
  model: ModelFile;
  prog: RobotProgram;
  setProg: (p: RobotProgram, label?: string) => void;
  run: ProgramRun | null;
  setRun: (r: ProgramRun | null) => void;
  change: (m: ModelFile, label?: string) => void;
  onPlay?: () => void;
  pose: Vec3 | null;
  api: CadApi;
}) {
  const joints = jointsTo(model.objects, prog.tool);
  const robotIds = new Set<string>();
  {
    const root = joints[0]?.parent;
    const all = [root ?? joints[0]?.id].filter(Boolean) as string[];
    for (let i = 0; i < all.length; i++) for (const o of model.objects) if (o.parent === all[i]) all.push(o.id);
    for (const id of all) robotIds.add(id);
  }
  const parts = model.objects.filter((o) => !robotIds.has(o.id) && o.kind !== "empty" && o.kind !== "curve" && o.visible && o.kind !== "plane");
  const steps = prog.steps;
  const put = (next: ProgramStep[], label: string) => {
    setRun(null);
    setProg({ ...prog, steps: next }, label);
  };
  const teachJ = () => put([...steps, { kind: "movej", label: `P${steps.length + 1}`, values: Object.fromEntries(joints.map((o) => [o.id, Math.round((o.joint as JointDef).value * 100) / 100])) }], "Teach MoveJ");
  const teachL = () => pose && put([...steps, { kind: "movel", label: `L${steps.length + 1}`, position: pose.map((v) => Math.round(v * 10000) / 10000) as Vec3 }], "Teach MoveL");
  const describe = (s: ProgramStep) =>
    s.kind === "movej"
      ? `MoveJ ${s.label ?? ""}`
      : s.kind === "movel"
        ? `MoveL → ${s.position.map((v) => v.toFixed(3)).join(", ")}`
        : s.kind === "grip"
          ? `Grip ${model.objects.find((o) => o.id === s.object)?.name ?? s.object}`
          : s.kind === "release"
            ? "Release"
            : `Wait ${s.seconds} s`;
  const simulate = () => {
    const r = runProgram(model, prog, model.fps, parts.map((p) => p.id));
    setRun(r);
    if (!r.issues.length) toast.success(`Program OK · cycle time ${r.cycleTime.toFixed(2)} s`);
  };
  return (
    <>
      <div className={head}>Program (teach pendant)</div>
      <p className="px-3 py-1 text-[#8a8a8a]">Pose the robot (Joints or IK), then teach steps. Simulate checks reach, joint limits and collisions with the other parts, then bake it onto the timeline.</p>
      <div className="flex flex-wrap gap-1 px-3 py-1">
        <button className={btn} onClick={teachJ} type="button">+ MoveJ here</button>
        <button className={btn} onClick={teachL} type="button">+ MoveL here</button>
        <select
          className={inp}
          onChange={(e) => {
            if (e.target.value) put([...steps, { kind: "grip", object: e.target.value }], "Teach grip");
            e.target.value = "";
          }}
          value=""
        >
          <option value="">+ Grip…</option>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className={btn} onClick={() => put([...steps, { kind: "release" }], "Teach release")} type="button">+ Release</button>
        <button className={btn} onClick={() => put([...steps, { kind: "wait", seconds: 0.5 }], "Teach wait")} type="button">+ Wait</button>
      </div>
      <ol className="mx-2 mt-1 space-y-0.5">
        {steps.map((s, i) => {
          const bad = run?.issues.filter((x) => x.step === i) ?? [];
          return (
            <li className={cn("flex items-center gap-1 rounded px-2 py-1", bad.length ? "bg-[#5a2a2a]" : "bg-[#333]")} key={i} title={bad.map((b) => b.text).join("\n")}>
              <span className="w-5 text-[#8a8a8a]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[#e6e6e6]">{describe(s)}</span>
              {s.kind === "wait" ? <Num onChange={(v) => put(steps.map((x, k) => (k === i ? { ...s, seconds: Math.max(0, v) } : x)), "Wait time")} step={0.1} value={s.seconds} w="w-12" /> : null}
              {s.kind === "movej" || s.kind === "movel" ? (
                <Num onChange={(v) => put(steps.map((x, k) => (k === i ? { ...s, speed: Math.min(100, Math.max(1, v)) } : x)), "Step speed")} step={5} value={s.speed ?? 100} w="w-12" />
              ) : null}
              <button aria-label="Up" className="opacity-60 hover:opacity-100 disabled:opacity-20" disabled={!i} onClick={() => put(steps.map((x, k) => (k === i - 1 ? steps[i] : k === i ? steps[i - 1] : x)), "Reorder")} type="button">
                <ArrowUp className="h-3 w-3" />
              </button>
              <button aria-label="Down" className="opacity-60 hover:opacity-100 disabled:opacity-20" disabled={i === steps.length - 1} onClick={() => put(steps.map((x, k) => (k === i + 1 ? steps[i] : k === i ? steps[i + 1] : x)), "Reorder")} type="button">
                <ArrowDown className="h-3 w-3" />
              </button>
              <button aria-label="Delete step" className="opacity-60 hover:opacity-100" onClick={() => put(steps.filter((_, k) => k !== i), "Delete step")} type="button">
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          );
        })}
        {!steps.length ? <li className="px-2 py-1 text-[#8a8a8a]">No steps yet.</li> : null}
      </ol>
      <label className="flex items-center gap-2 px-3 py-2">
        <span className="text-[#bdbdbd]">Speed</span>
        <input className="h-1 flex-1 accent-[#4772b3]" max={100} min={1} onChange={(e) => setProg({ ...prog, speed: Number(e.target.value) })} type="range" value={prog.speed} />
        <span className="w-8 text-right">{prog.speed}%</span>
      </label>
      <div className="flex gap-1 px-3">
        <button className={cn(btn, "bg-[#4772b3] text-white hover:bg-[#5582c4]")} disabled={!steps.length} onClick={simulate} type="button">Simulate</button>
        <button
          className={btn}
          disabled={!run}
          onClick={() => {
            if (!run) return;
            change(bakeProgram(model, run, model.frameStart), "Bake robot program");
            onPlay?.();
          }}
          type="button"
        >
          <Play className="mr-1 inline h-3 w-3" />
          Bake &amp; play
        </button>
      </div>
      {run ? (
        <div className="mx-3 mt-2 space-y-1 rounded bg-[#232323] p-2">
          <div>
            Cycle time <b className="text-white">{run.cycleTime.toFixed(2)} s</b> · {run.frames.length} frames · path {(pathLength(run.path) * 1000).toFixed(0)} mm
          </div>
          {run.issues.length ? (
            run.issues.map((x, i) => (
              <div className="text-[#ff8a80]" key={i}>
                {x.step >= 0 ? `Step ${x.step + 1}: ` : ""}
                {x.text}
              </div>
            ))
          ) : (
            <div className="text-[#5bd18b]">Reachable, within limits, no collisions.</div>
          )}
        </div>
      ) : null}
    </>
  );
}

const pathLength = (p: Vec3[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1], q[2] - p[i][2]), 0);

// ─── Structure (frame FEA) ──────────────────────────────────────────────────

const DEFAULT_STUDY: FrameStudy = { curves: [], section: { shape: "tube", d: 25, t: 2 }, material: "aluminium", supports: [], loads: [], selfWeight: true };

/** Frame analysis on line/polyline members: deflection, stress, safety factor. */
export function StructurePanel({ model, api, change, selected }: Common) {
  const [tab, setTab] = React.useState("Setup");
  const study = model.studies?.structure ?? DEFAULT_STUDY;
  const setStudy = (s: FrameStudy, label?: string) => change({ ...model, studies: { ...model.studies, structure: s } }, label);
  const [result, setResult] = React.useState<FrameResult | null>(null);
  const [exaggerate, setExaggerate] = React.useState(50);
  const curves = model.objects.filter((o) => o.kind === "curve");

  const members = React.useMemo(() => {
    const out: { a: Vec3; b: Vec3 }[] = [];
    for (const id of study.curves) {
      const o = model.objects.find((x) => x.id === id);
      if (!o?.curve) continue;
      const pts = curveWorld(o, o.curve.type === "polyline" || o.curve.type === "rect" ? 2 : 24);
      for (let i = 1; i < pts.length; i++) out.push({ a: [pts[i - 1].x, pts[i - 1].y, pts[i - 1].z], b: [pts[i].x, pts[i].y, pts[i].z] });
    }
    return out;
  }, [study.curves, model.objects]);
  const joints = React.useMemo(() => {
    const nodes: Vec3[] = [];
    for (const m of members) for (const p of [m.a, m.b]) if (!nodes.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1e-3)) nodes.push(p);
    return nodes;
  }, [members]);
  const near = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3;
  const supportAt = (p: Vec3) => study.supports.find((s) => near(s.at, p))?.type ?? "";
  const loadAt = (p: Vec3) => study.loads.find((l) => near(l.at, p));

  const solve = () => {
    const r = solveFrame({ members: members.map((m) => ({ ...m, section: study.section, material: study.material })), supports: study.supports, loads: study.loads, selfWeight: study.selfWeight });
    setResult(r);
    setTab("Results");
    if (!r.ok) toast.error(r.error ?? "Couldn't solve");
  };

  // results overlay: members by utilization + deformed shape
  React.useEffect(() => {
    if (!result?.ok) return api.overlay("fea", null);
    const g = new THREE.Group();
    const color = (u: number) => new THREE.Color().setHSL(Math.max(0, 0.33 * (1 - Math.min(1, u))), 0.9, 0.5);
    const nodeIdx = (p: Vec3) => result.nodes.findIndex((q) => near(q, p));
    members.forEach((m, k) => {
      const r = result.members[k];
      if (!r) return;
      const i = nodeIdx(m.a);
      const j = nodeIdx(m.b);
      const def = (n: number, p: Vec3) => new THREE.Vector3(p[0] + result.displacement[n][0] * exaggerate, p[1] + result.displacement[n][1] * exaggerate, p[2] + result.displacement[n][2] * exaggerate);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([def(i, m.a), def(j, m.b)]), new THREE.LineBasicMaterial({ color: color(r.utilization), depthTest: false }));
      line.renderOrder = 9;
      g.add(line);
    });
    for (const s of study.supports) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 4), new THREE.MeshBasicMaterial({ color: s.type === "fixed" ? "#4772b3" : "#5ad1e6" }));
      c.position.set(s.at[0], s.at[1] - 0.025, s.at[2]);
      g.add(c);
    }
    for (const l of study.loads) {
      const dir = new THREE.Vector3(...l.force);
      const len = dir.length();
      if (len > 0) g.add(new THREE.ArrowHelper(dir.clone().normalize(), new THREE.Vector3(...l.at).sub(dir.clone().normalize().multiplyScalar(0.2)), 0.2, "#ff5252", 0.05, 0.03));
    }
    api.overlay("fea", g);
    return () => api.overlay("fea", null);
  }, [result, exaggerate, members, study.supports, study.loads, api]);

  const sec = study.section;
  const sp = sectionProps(sec);
  return (
    <Shell onTab={setTab} tab={tab} tabs={["Setup", "Joints", "Results"]}>
      {tab === "Setup" ? (
        <>
          <div className={head}>Members</div>
          <p className="px-3 py-1 text-[#8a8a8a]">Draw the frame with Line / Polyline (each segment is a member, ends that touch are joined), then tick them here.</p>
          <div className="max-h-40 overflow-y-auto px-3">
            {curves.map((c) => (
              <label className="flex items-center gap-2 py-0.5" key={c.id}>
                <input checked={study.curves.includes(c.id)} onChange={(e) => setStudy({ ...study, curves: e.target.checked ? [...study.curves, c.id] : study.curves.filter((x) => x !== c.id) }, "Members")} type="checkbox" />
                {c.name}
              </label>
            ))}
            {!curves.length ? <p className="text-[#8a8a8a]">No curves yet: use Line or Polyline in the Layout workspace.</p> : null}
          </div>
          {selected?.kind === "curve" && !study.curves.includes(selected.id) ? (
            <button className={cn(btn, "mx-3 mt-1")} onClick={() => setStudy({ ...study, curves: [...study.curves, selected.id] }, "Members")} type="button">
              <Plus className="mr-1 inline h-3 w-3" />
              Add selected
            </button>
          ) : null}
          <div className={head}>Section &amp; material</div>
          <div className="flex flex-wrap items-center gap-1 px-3 py-1">
            <select className={inp} onChange={(e) => setStudy({ ...study, section: { ...sec, shape: e.target.value as Section["shape"] } }, "Section")} value={sec.shape}>
              <option value="tube">Round tube</option>
              <option value="square">Square tube</option>
              <option value="rect">Rectangle bar</option>
              <option value="rod">Round bar</option>
            </select>
            <span className="text-[#bdbdbd]">{sec.shape === "rect" ? "W" : "D"}</span>
            <Num onChange={(v) => setStudy({ ...study, section: { ...sec, d: Math.max(1, v) } })} step={1} value={sec.d} w="w-12" />
            {sec.shape === "rect" ? (
              <>
                <span className="text-[#bdbdbd]">H</span>
                <Num onChange={(v) => setStudy({ ...study, section: { ...sec, h: Math.max(1, v) } })} step={1} value={sec.h ?? sec.d} w="w-12" />
              </>
            ) : null}
            {sec.shape === "tube" || sec.shape === "square" ? (
              <>
                <span className="text-[#bdbdbd]">wall</span>
                <Num onChange={(v) => setStudy({ ...study, section: { ...sec, t: Math.max(0.2, v) } })} step={0.5} value={sec.t ?? 2} w="w-12" />
              </>
            ) : null}
            <span className="text-[#8a8a8a]">mm</span>
          </div>
          <div className="px-3 text-[#8a8a8a]">
            A {fmt(sp.A * 1e6, 1)} mm² · I {fmt(sp.Iz * 1e12 / 1e4, 2)} cm⁴
          </div>
          <div className="flex items-center gap-2 px-3 py-1">
            <select className={inp} onChange={(e) => setStudy({ ...study, material: e.target.value as MaterialId }, "Material")} value={study.material}>
              {(Object.keys(MATERIALS) as MaterialId[]).map((m) => (
                <option key={m} value={m}>
                  {MATERIALS[m].label}
                </option>
              ))}
            </select>
            <span className="text-[#8a8a8a]">
              E {fmt(MATERIALS[study.material].E / 1e9, 1)} GPa · yield {fmt(MATERIALS[study.material].fy / 1e6, 0)} MPa
            </span>
          </div>
          <label className="flex items-center gap-2 px-3 py-1">
            <input checked={study.selfWeight} onChange={(e) => setStudy({ ...study, selfWeight: e.target.checked }, "Self weight")} type="checkbox" />
            Include its own weight
          </label>
          <div className="flex gap-1 px-3 py-2">
            <button className={btn} onClick={() => setTab("Joints")} type="button">Supports &amp; loads →</button>
            <button className={cn(btn, "bg-[#4772b3] text-white hover:bg-[#5582c4]")} disabled={!members.length} onClick={solve} type="button">Solve</button>
          </div>
        </>
      ) : null}

      {tab === "Joints" ? (
        <>
          <div className={head}>Supports &amp; loads at the joints</div>
          <p className="px-3 py-1 text-[#8a8a8a]">Fixed holds a joint completely, pinned lets it turn. Loads in newtons (y is up, so −y pushes down; 1 kg ≈ 9.81 N).</p>
          <div className="flex gap-1 px-3 pb-1">
            <button
              className={btn}
              onClick={() => {
                const minY = Math.min(...joints.map((p) => p[1]));
                setStudy({ ...study, supports: joints.filter((p) => p[1] < minY + 1e-3).map((p) => ({ at: p, type: "fixed" as const })) }, "Fix lowest joints");
              }}
              type="button"
            >
              Fix the lowest joints
            </button>
          </div>
          <table className="mx-2 w-[calc(100%-1rem)] table-fixed">
            <thead className="text-[#8a8a8a]">
              <tr>
                <th className="w-[30%] text-left font-normal">Joint (m)</th>
                <th className="w-[22%] text-left font-normal">Support</th>
                <th className="text-right font-normal">Fx</th>
                <th className="text-right font-normal">Fy</th>
                <th className="text-right font-normal">Fz</th>
              </tr>
            </thead>
            <tbody>
              {joints.map((p, i) => {
                const l = loadAt(p);
                const setLoad = (c: number, v: number) => {
                  const f = [...(l?.force ?? [0, 0, 0])] as Vec3;
                  f[c] = v;
                  const rest = study.loads.filter((x) => !near(x.at, p));
                  setStudy({ ...study, loads: f.some((x) => x !== 0) ? [...rest, { at: p, force: f }] : rest });
                };
                return (
                  <tr key={i}>
                    <td className="truncate font-mono text-[10px] text-[#bdbdbd]">{p.map((v) => v.toFixed(2)).join(",")}</td>
                    <td>
                      <select
                        className={cn(inp, "w-full text-left")}
                        onChange={(e) => {
                          const rest = study.supports.filter((s) => !near(s.at, p));
                          setStudy({ ...study, supports: e.target.value ? [...rest, { at: p, type: e.target.value as "fixed" | "pinned" }] : rest }, "Support");
                        }}
                        value={supportAt(p)}
                      >
                        <option value="">—</option>
                        <option value="fixed">Fixed</option>
                        <option value="pinned">Pinned</option>
                      </select>
                    </td>
                    {[0, 1, 2].map((c) => (
                      <td key={c}>
                        <Num onChange={(v) => setLoad(c, v)} step={10} value={l?.force[c] ?? 0} w="w-full" />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-3 py-2">
            <button className={cn(btn, "bg-[#4772b3] text-white hover:bg-[#5582c4]")} disabled={!members.length} onClick={solve} type="button">Solve</button>
          </div>
        </>
      ) : null}

      {tab === "Results" ? (
        result ? (
          result.ok ? (
            <>
              <div className={head}>Results (linear static)</div>
              <table className="mx-3 my-1 w-[calc(100%-1.5rem)]">
                <tbody>
                  {[
                    ["Max deflection", `${fmt(result.maxDisplacement * 1000, 2)} mm`],
                    ["Max stress", `${fmt(result.maxStress / 1e6, 1)} MPa`],
                    ["Yield strength", `${fmt(MATERIALS[study.material].fy / 1e6, 0)} MPa`],
                    ["Safety factor", Number.isFinite(result.safetyFactor) ? fmt(result.safetyFactor, 2) : "∞"],
                    ["Frame mass", `${fmt(result.mass, 2)} kg`],
                    ["Members / joints", `${result.members.length} / ${result.nodes.length}`],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-0.5 text-[#bdbdbd]">{k}</td>
                      <td className={cn("text-right font-mono", k === "Safety factor" && (result.safetyFactor < 1 ? "text-[#ff5252]" : result.safetyFactor < 2 ? "text-[#ffb142]" : "text-[#5bd18b]"))}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={cn("px-3 py-1", result.safetyFactor < 1 ? "text-[#ff8a80]" : result.safetyFactor < 2 ? "text-[#ffcf80]" : "text-[#9be3b5]")}>
                {result.safetyFactor < 1
                  ? "It yields: the stress is above the material's strength. Use a bigger section, a stronger material or more bracing."
                  : result.safetyFactor < 2
                    ? "It holds, with little margin (under 2×). For anything people rely on, aim for 2–3× or more."
                    : "It holds with a healthy margin."}
              </p>
              <label className="flex items-center gap-2 px-3 py-1">
                <span className="text-[#bdbdbd]">Deformation ×</span>
                <input className="h-1 flex-1 accent-[#4772b3]" max={500} min={1} onChange={(e) => setExaggerate(Number(e.target.value))} type="range" value={exaggerate} />
                <span className="w-8 text-right">{exaggerate}</span>
              </label>
              <div className="mx-3 my-1 h-2 rounded" style={{ background: "linear-gradient(90deg,hsl(120,90%,50%),hsl(60,90%,50%),hsl(0,90%,50%))" }} />
              <div className="mx-3 flex justify-between text-[10px] text-[#8a8a8a]">
                <span>0%</span>
                <span>utilization</span>
                <span>100% of yield</span>
              </div>
              <div className={head}>Reactions</div>
              {result.reactions.map((r, i) => (
                <div className="px-3 font-mono text-[10.5px] text-[#bdbdbd]" key={i}>
                  ({r.at.map((v) => v.toFixed(2)).join(", ")}) F {r.force.map((v) => v.toFixed(0)).join(" / ")} N
                </div>
              ))}
              <div className="px-3 py-2">
                <button
                  className={btn}
                  onClick={() => {
                    const rows = [
                      "member,length_m,stress_MPa,utilization",
                      ...result.members.map((m) => `${m.index + 1},${m.length.toFixed(4)},${(m.stress / 1e6).toFixed(3)},${m.utilization.toFixed(4)}`),
                    ];
                    void exportFile("frame-results.csv", rows.join("\n"), "csv", "CSV");
                  }}
                  type="button"
                >
                  Export CSV
                </button>
              </div>
              <p className="px-3 text-[10px] text-[#7a7a7a]">Beam elements (bending, shear, axial, torsion); small deflections; joints welded rigid. Checks yield, not buckling or fatigue.</p>
            </>
          ) : (
            <p className="px-3 py-2 text-[#ff8a80]">{result.error}</p>
          )
        ) : (
          <p className="px-3 py-2 text-[#8a8a8a]">Set it up and press Solve.</p>
        )
      ) : null}
    </Shell>
  );
}

// ─── Inspect: mass properties, section view ─────────────────────────────────

export function InspectPanel({ model, api, selected }: Common) {
  const [tab, setTab] = React.useState("Mass");
  const [density, setDensity] = React.useState(DENSITIES["PLA (solid)"]);
  const [mp, setMp] = React.useState<MassProps | null>(null);
  const [cut, setCut] = React.useState<{ axis: "x" | "y" | "z"; at: number; flip: boolean } | null>(null);
  React.useEffect(() => {
    api.section(cut);
  }, [cut, api]);
  React.useEffect(() => () => (api.section(null), api.overlay("cg", null)), [api]);
  const compute = () => {
    if (!selected) return;
    const t = api.tris(selected.id);
    if (!t?.length) return toast.error("That object has no solid geometry");
    const r = massProps(t, density);
    setMp(r);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), new THREE.MeshBasicMaterial({ color: "#ff3d71", depthTest: false }));
    m.renderOrder = 10;
    m.position.set(...r.cg);
    api.overlay("cg", m);
  };
  void model;
  return (
    <Shell onTab={setTab} tab={tab} tabs={["Mass", "Section"]}>
      {tab === "Mass" ? (
        <>
          <div className={head}>Mass properties</div>
          <p className="px-3 py-1 text-[#8a8a8a]">Of the selected object as a solid (closed mesh). {selected ? `Selected: ${selected.name}` : "Select an object."}</p>
          <div className="flex items-center gap-1 px-3 py-1">
            <select className={inp} onChange={(e) => setDensity(Number(e.target.value))} value={density}>
              {Object.entries(DENSITIES).map(([k, v]) => (
                <option key={k} value={v}>
                  {k} ({v})
                </option>
              ))}
            </select>
            <Num onChange={setDensity} step={10} value={density} w="w-16" />
            <span className="text-[#8a8a8a]">kg/m³</span>
            <button className={cn(btn, "bg-[#4772b3] text-white hover:bg-[#5582c4]")} disabled={!selected} onClick={compute} type="button">Compute</button>
          </div>
          {mp ? (
            <table className="mx-3 my-1 w-[calc(100%-1.5rem)] font-mono text-[10.5px]">
              <tbody>
                {[
                  ["Volume", `${fmt(mp.volume * 1e6, 2)} cm³`],
                  ["Surface area", `${fmt(mp.area * 1e4, 2)} cm²`],
                  ["Mass", `${fmt(mp.mass * 1000, 1)} g`],
                  ["Centre of gravity", mp.cg.map((v) => (v * 1000).toFixed(1)).join(", ") + " mm"],
                  ["Ixx / Iyy / Izz (at CG)", mp.inertia.slice(0, 3).map((v) => (v * 1e6).toFixed(1)).join(" / ") + " kg·mm²"],
                  ["Principal moments", mp.principal.map((v) => (v * 1e6).toFixed(1)).join(" / ") + " kg·mm²"],
                  ["Radii of gyration", mp.gyration.map((v) => (v * 1000).toFixed(1)).join(" / ") + " mm"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-0.5 pr-2 font-sans text-[#bdbdbd]">{k}</td>
                    <td className="text-right text-[#e6e6e6]">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
      {tab === "Section" ? (
        <>
          <div className={head}>Section view</div>
          <p className="px-3 py-1 text-[#8a8a8a]">Cut the whole model with a plane to look inside.</p>
          <label className="flex items-center gap-2 px-3 py-1">
            <input checked={!!cut} onChange={(e) => setCut(e.target.checked ? { axis: "x", at: 0, flip: false } : null)} type="checkbox" />
            Cut
          </label>
          {cut ? (
            <>
              <div className="flex gap-1 px-3 py-1">
                {(["x", "y", "z"] as const).map((a) => (
                  <button className={cn(btn, cut.axis === a && "bg-[#4772b3] text-white")} key={a} onClick={() => setCut({ ...cut, axis: a })} type="button">
                    {a.toUpperCase()} plane
                  </button>
                ))}
                <button className={btn} onClick={() => setCut({ ...cut, flip: !cut.flip })} type="button">Flip</button>
              </div>
              <label className="flex items-center gap-2 px-3 py-1">
                <span className="text-[#bdbdbd]">At</span>
                <input className="h-1 flex-1 accent-[#4772b3]" max={5} min={-5} onChange={(e) => setCut({ ...cut, at: Number(e.target.value) })} step={0.005} type="range" value={cut.at} />
                <Num onChange={(v) => setCut({ ...cut, at: v })} step={0.01} value={cut.at} />
                <span className="text-[#8a8a8a]">m</span>
              </label>
            </>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}
