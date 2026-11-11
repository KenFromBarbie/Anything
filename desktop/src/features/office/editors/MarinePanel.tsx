import * as React from "react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";

import { Slider } from "./CreativeShell";
import { exportFile } from "./editorStore";
import {
  DEFAULT_HULL,
  type Equilibrium,
  equilibrium,
  gzCurve,
  type HullParams,
  holtrop,
  NU,
  offsets,
  RHO,
  savitsky,
  sliceTris,
  submerged,
  type Tris,
  boundsOfTris,
  type Weight,
} from "./marine";
import type { ModelFile, SceneObject, Vec3 } from "./modelFormat";

type Tab = "Hull" | "Weights" | "Hydrostatics" | "Stability" | "Resistance" | "Lines";
const TABS: Tab[] = ["Hull", "Weights", "Hydrostatics", "Stability", "Resistance", "Lines"];
const KN = 0.514444;

export type MarineApi = {
  /** World-space triangles of an object (at the current pose). */
  tris: (id: string) => Tris | null;
  /** Centre of an object's bounds. */
  centre: (id: string) => Vec3 | null;
  /** Show the floating waterline (or hide it). */
  water: (w: { y: number; about: Vec3; heel: number; trim: number } | null) => void;
};

/** Orca3D-style naval architecture on the scene. */
export function MarinePanel({
  model,
  selected,
  api,
  onAddHull,
  onHull,
  onMass,
  commit,
}: {
  model: ModelFile;
  selected?: SceneObject;
  api: MarineApi;
  onAddHull: (h: HullParams) => void;
  onHull: (id: string, h: HullParams) => void;
  onMass: (id: string, mass: number | undefined, cg?: Vec3 | undefined) => void;
  commit: (label: string) => void;
}) {
  const [tab, setTab] = React.useState<Tab>("Hull");
  const [water, setWater] = React.useState<"salt" | "fresh">("salt");
  const [hullId, setHullId] = React.useState<string | null>(null);
  const hull = model.objects.find((o) => o.id === hullId) ?? model.objects.find((o) => o.kind === "hull") ?? (selected && selected.kind !== "empty" ? selected : undefined);
  const rho = RHO[water];

  // Weights: every object with a mass; CG at its bounds' centre unless set.
  const weights: (Weight & { id: string; set: boolean })[] = model.objects
    .filter((o) => (o.mass ?? 0) > 0)
    .map((o) => ({ id: o.id, name: o.name, mass: o.mass as number, cg: (o.cg ?? api.centre(o.id) ?? [0, 0, 0]) as [number, number, number], set: !!o.cg }));
  const total = weights.reduce((s, w) => s + w.mass, 0);
  const cg: [number, number, number] = total
    ? [0, 1, 2].map((a) => weights.reduce((s, w) => s + w.mass * w.cg[a], 0) / total) as [number, number, number]
    : [0, 0, 0];

  const [draftIn, setDraftIn] = React.useState(0.3);
  const [kgIn, setKgIn] = React.useState(0.5);
  const [result, setResult] = React.useState<{ eq: Equilibrium; weight: Weight; mode: string } | null>(null);
  const [gz, setGz] = React.useState<{ heel: number; gz: number }[] | null>(null);

  const solve = (): { eq: Equilibrium; weight: Weight; mode: string } | null => {
    if (!hull) {
      toast.message("Add a hull (Hull tab) or select the object to analyse");
      return null;
    }
    const t = api.tris(hull.id);
    if (!t?.length) return null;
    let weight: Weight;
    let mode: string;
    if (total > 0) {
      weight = { name: "Total", mass: total, cg };
      mode = "Floating at its weight, free trim";
    } else {
      // At a draft: the weight is what it displaces there, G at the KG given.
      const { min } = boundsOfTris(t);
      const h = submerged(t, min[1] + draftIn);
      weight = { name: "At draft", mass: h.volume * rho, cg: [h.centre[0], min[1] + kgIn, 0] };
      mode = `At ${draftIn.toFixed(2)} m draft (KG ${kgIn.toFixed(2)} m)`;
    }
    const eq = equilibrium(t, weight, rho);
    if (!eq) {
      toast.error("It sinks: the weight is more than the hull can hold up");
      return null;
    }
    const r = { eq, weight, mode };
    setResult(r);
    api.water({ y: eq.waterline, about: weight.cg, heel: 0, trim: eq.trim });
    return r;
  };

  React.useEffect(() => () => api.water(null), [api]);

  const runGz = () => {
    const r = result ?? solve();
    if (!r || !hull) return;
    const t = api.tris(hull.id);
    if (!t) return;
    setGz(gzCurve(t, r.weight, rho, r.eq.trim, Array.from({ length: 19 }, (_, i) => i * 5)));
  };

  const head = "mt-2 border-b border-black/50 bg-[#262626] px-3 py-1 font-semibold text-[#cfcfcf]";
  return (
    <div className="flex w-[23rem] shrink-0 flex-col border-r border-black/60 bg-[#2b2b2b] text-[11px]">
      <div className="flex flex-wrap gap-0.5 border-b border-black/60 bg-[#262626] p-1">
        {TABS.map((t) => (
          <button
            className={cn("rounded px-2 py-1", tab === t ? "bg-[#4772b3] text-white" : "text-[#bdbdbd] hover:bg-[#3a3a3a]")}
            key={t}
            onClick={() => setTab(t)}
            type="button"
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 border-b border-black/50 px-3 py-1.5">
        <span className="text-[#a8a8a8]">Hull</span>
        <select className="min-w-0 flex-1 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5" onChange={(e) => setHullId(e.target.value || null)} value={hull?.id ?? ""}>
          <option value="">(choose)</option>
          {model.objects
            .filter((o) => o.kind !== "empty")
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
        <select className="rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5" onChange={(e) => setWater(e.target.value as "salt" | "fresh")} value={water}>
          <option value="salt">Sea water</option>
          <option value="fresh">Fresh water</option>
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {tab === "Hull" ? (
          <HullTab hull={hull?.kind === "hull" ? hull : undefined} onAdd={onAddHull} onChange={(h) => hull && onHull(hull.id, h)} onCommit={() => commit("Hull shape")} />
        ) : null}

        {tab === "Weights" ? (
          <>
            <div className={head}>Weights &amp; centre of gravity</div>
            <p className="px-3 py-1 text-[#8a8a8a]">Give each part its mass (the hull's own structure too). Its centre of gravity is the middle of the part unless you type one. x forward, y up, z to starboard (m).</p>
            <table className="mx-2 w-[calc(100%-1rem)] table-fixed">
              <thead className="text-[#8a8a8a]">
                <tr>
                  <th className="w-[34%] text-left font-normal">Item</th>
                  <th className="text-right font-normal">kg</th>
                  <th className="text-right font-normal">LCG</th>
                  <th className="text-right font-normal">VCG</th>
                  <th className="text-right font-normal">TCG</th>
                </tr>
              </thead>
              <tbody>
                {model.objects
                  .filter((o) => o.kind !== "empty" || (o.mass ?? 0) > 0)
                  .map((o) => {
                    const c = (o.cg ?? api.centre(o.id) ?? [0, 0, 0]) as Vec3;
                    const num = (v: number, set: (n: number) => void, w = "w-full") => (
                      <input className={cn("rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-right", w)} onBlur={() => commit("Weight")} onChange={(e) => set(Number(e.target.value))} step={0.01} type="number" value={Math.round(v * 1000) / 1000} />
                    );
                    return (
                      <tr key={o.id}>
                        <td className="truncate pr-1">{o.name}</td>
                        <td className="px-0.5">{num(o.mass ?? 0, (m) => onMass(o.id, m > 0 ? m : undefined, o.cg))}</td>
                        {[0, 1, 2].map((a) => (
                          <td className="px-0.5" key={a}>
                            {num(c[a], (v) => {
                              const next = [...c] as Vec3;
                              next[a] = v;
                              onMass(o.id, o.mass, next);
                            })}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
              </tbody>
              <tfoot className="font-semibold text-white">
                <tr>
                  <td>Total</td>
                  <td className="text-right">{total.toFixed(0)}</td>
                  {cg.map((v, i) => (
                    <td className="text-right" key={i}>
                      {total ? v.toFixed(3) : "—"}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </>
        ) : null}

        {tab === "Hydrostatics" ? (
          <>
            <div className={head}>Condition</div>
            {total > 0 ? (
              <p className="px-3 py-1 text-[#b5b5b5]">
                Floats at its weight: {total.toFixed(0)} kg, G at ({cg.map((v) => v.toFixed(2)).join(", ")}), free trim.
              </p>
            ) : (
              <>
                <p className="px-3 py-1 text-[#8a8a8a]">No weights yet (Weights tab): working at a draft instead.</p>
                <Slider label="Draft (m)" max={5} min={0.01} onChange={setDraftIn} step={0.01} value={draftIn} />
                <Slider label="KG (m)" max={10} min={0} onChange={setKgIn} step={0.01} value={kgIn} />
              </>
            )}
            <div className="px-3 py-1">
              <button className="w-full rounded bg-[#4772b3] py-1.5 font-medium text-white hover:bg-[#5582c4]" onClick={() => solve()} type="button">
                Calculate hydrostatics
              </button>
            </div>
            {result ? <HydroTable eq={result.eq} mode={result.mode} rho={rho} /> : null}
          </>
        ) : null}

        {tab === "Stability" ? (
          <>
            <div className={head}>Righting arm (GZ) curve</div>
            <div className="px-3 py-1">
              <button className="w-full rounded bg-[#4772b3] py-1.5 font-medium text-white hover:bg-[#5582c4]" onClick={runGz} type="button">
                Calculate the GZ curve (0–90°)
              </button>
            </div>
            {gz && result ? <Stability gz={gz} gm={result.eq.gmt} /> : <p className="px-3 text-[#8a8a8a]">Heels the hull in 5° steps about its centre of gravity, floating at the same weight and trim.</p>}
          </>
        ) : null}

        {tab === "Resistance" ? <ResistanceTab hull={hull} result={result} solve={solve} water={water} /> : null}

        {tab === "Lines" ? <LinesTab hull={hull} tris={hull ? api.tris(hull.id) : null} /> : null}
      </div>
    </div>
  );
}

function HullTab({ hull, onAdd, onChange, onCommit }: { hull?: SceneObject; onAdd: (h: HullParams) => void; onChange: (h: HullParams) => void; onCommit: () => void }) {
  const [draft, setDraft] = React.useState<HullParams>(DEFAULT_HULL);
  const h = hull?.hull ?? draft;
  const set = (patch: Partial<HullParams>) => (hull ? onChange({ ...h, ...patch }) : setDraft({ ...h, ...patch }));
  const S = (label: string, key: keyof HullParams, min: number, max: number, step: number, unit = "") => (
    <Slider key={key} label={label} max={max} min={min} onChange={(v) => set({ [key]: v } as Partial<HullParams>)} onCommit={onCommit} step={step} unit={unit} value={h[key] as number} />
  );
  const head = "mt-2 border-b border-black/50 bg-[#262626] px-3 py-1 font-semibold text-[#cfcfcf]";
  return (
    <>
      <div className={head}>{hull ? `Hull · ${hull.name}` : "Hull design (new)"}</div>
      <div className="flex gap-1 px-3 py-1">
        {(["planing", "round"] as const).map((t) => (
          <button className={cn("flex-1 rounded px-2 py-1", h.type === t ? "bg-[#4772b3] text-white" : "bg-[#3a3a3a] hover:bg-[#454545]")} key={t} onClick={() => { set({ type: t }); onCommit(); }} type="button">
            {t === "planing" ? "Hard-chine planing" : "Round-bilge displacement"}
          </button>
        ))}
      </div>
      {S("Length overall", "length", 1, 120, 0.05, "m")}
      {S("Beam", "beam", 0.3, 30, 0.01, "m")}
      {S("Depth", "depth", 0.2, 20, 0.01, "m")}
      {h.type === "planing" ? (
        <>
          {S("Deadrise aft", "deadriseAft", 0, 35, 0.5, "°")}
          {S("Deadrise fwd", "deadriseFwd", 0, 65, 0.5, "°")}
        </>
      ) : (
        S("Bilge squareness", "bilge", 2, 8, 0.1)
      )}
      {S("Transom beam", "transom", 0.05, 1, 0.01)}
      {S("Entry fullness", "entry", 1.05, 4, 0.05)}
      {S("Forefoot rise", "keelRise", 0, 1, 0.01)}
      {S("Sheer rise at bow", "sheerRise", 0, 5, 0.01, "m")}
      {S("Topside flare", "flare", 0, 35, 0.5, "°")}
      {!hull ? (
        <div className="px-3 pt-2">
          <button className="w-full rounded bg-[#4772b3] py-1.5 font-medium text-white hover:bg-[#5582c4]" onClick={() => onAdd(h)} type="button">
            Create hull
          </button>
        </div>
      ) : (
        <p className="px-3 pt-2 text-[#8a8a8a]">The transom is at x = 0 and the bow at x = length; y up, z to starboard. Drag a slider and the hull updates; every analysis tab uses the current shape.</p>
      )}
    </>
  );
}

function Row({ k, v, u = "" }: { k: string; v: string; u?: string }) {
  return (
    <tr className="border-b border-white/5">
      <td className="py-0.5 pl-3 text-[#a8a8a8]">{k}</td>
      <td className="py-0.5 pr-1 text-right tabular-nums text-white">{v}</td>
      <td className="w-10 py-0.5 pr-3 text-[#8a8a8a]">{u}</td>
    </tr>
  );
}

function HydroTable({ eq, mode, rho }: { eq: Equilibrium; mode: string; rho: number }) {
  const f = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : "—");
  const rows: [string, string, string][] = [
    ["Displacement", f(eq.displacement, 1), "kg"],
    ["Volume", f(eq.volume, 4), "m³"],
    ["Max draft (keel to waterline)", f(eq.draft), "m"],
    ["Draft near aft / fwd ends", `${f(eq.draftAft)} / ${f(eq.draftFwd)}`, "m"],
    ["Trim (bow down +)", f(eq.trim, 2), "°"],
    ["LWL", f(eq.lwl), "m"],
    ["BWL", f(eq.bwl), "m"],
    ["Wetted surface", f(eq.wetted), "m²"],
    ["Waterplane area", f(eq.awp), "m²"],
    ["LCB (x)", f(eq.centre[0]), "m"],
    ["VCB above keel (KB)", f(eq.kb), "m"],
    ["LCF (x)", f(eq.lcf), "m"],
    ["BMt / BMl", `${f(eq.bmt)} / ${f(eq.bml, 2)}`, "m"],
    ["KMt / KMl", `${f(eq.kmt)} / ${f(eq.kml, 2)}`, "m"],
    ["GMt / GMl", `${f(eq.gmt)} / ${f(eq.gml, 2)}`, "m"],
    ["Block coefficient Cb", f(eq.cb), ""],
    ["Prismatic Cp", f(eq.cp), ""],
    ["Midship Cm", f(eq.cm), ""],
    ["Waterplane Cwp", f(eq.cwp), ""],
    ["Immersion (TPC)", f(eq.tpc * 1000, 1), "kg/cm"],
    ["Moment to trim 1 cm", f(eq.mct * 1000, 2), "kg·m"],
    ["Immersed transom", f(eq.transomArea, 4), "m²"],
  ];
  const csv = () =>
    void exportFile("hydrostatics.csv", ["Item,Value,Unit", `Condition,${mode},`, `Water density,${rho},kg/m³`, ...rows.map((r) => r.map((x) => `"${x}"`).join(","))].join("\n"), "csv", "CSV", false).then((ok) => ok && toast.success("Exported"));
  return (
    <>
      <div className="mt-2 flex items-center border-b border-black/50 bg-[#262626] px-3 py-1 font-semibold text-[#cfcfcf]">
        Results
        <button className="ml-auto rounded bg-[#3a3a3a] px-2 py-0.5 font-normal hover:bg-[#454545]" onClick={csv} type="button">
          Export CSV
        </button>
      </div>
      <p className="px-3 py-1 text-[#8a8a8a]">{mode}. The blue plane in the viewport is the waterline.</p>
      <table className="w-full">
        <tbody>
          {rows.map(([k, v, u]) => (
            <Row k={k} key={k} u={u} v={v} />
          ))}
        </tbody>
      </table>
    </>
  );
}

function Stability({ gz, gm }: { gz: { heel: number; gz: number }[]; gm: number }) {
  const ok = gz.filter((p) => Number.isFinite(p.gz));
  const max = ok.reduce((m, p) => (p.gz > m.gz ? p : m), { heel: 0, gz: -Infinity });
  const zero = ok.find((p, i) => i > 0 && p.gz <= 0);
  const vanish = zero ? String(zero.heel) : ">90";
  // area under GZ (m·rad), trapezoids
  const area = (to: number, from = 0) => {
    let a = 0;
    for (let i = 1; i < ok.length; i++) {
      const p = ok[i - 1], q = ok[i];
      if (q.heel <= from || p.heel >= to) continue;
      a += (((Math.max(0, p.gz) + Math.max(0, q.gz)) / 2) * ((Math.min(q.heel, to) - Math.max(p.heel, from)) * Math.PI)) / 180;
    }
    return a;
  };
  const at30 = ok.find((p) => p.heel === 30)?.gz ?? 0;
  const criteria: [string, boolean, string][] = [
    ["Area 0–30° ≥ 0.055 m·rad", area(30) >= 0.055, area(30).toFixed(4)],
    ["Area 0–40° ≥ 0.090 m·rad", area(40) >= 0.09, area(40).toFixed(4)],
    ["Area 30–40° ≥ 0.030 m·rad", area(40, 30) >= 0.03, area(40, 30).toFixed(4)],
    ["GZ at 30° ≥ 0.20 m", at30 >= 0.2, at30.toFixed(3)],
    ["Max GZ at ≥ 25°", max.heel >= 25, `${max.heel}°`],
    ["Initial GM ≥ 0.15 m", gm >= 0.15, gm.toFixed(3)],
  ];
  const W = 320, H = 170, pad = 28;
  const ymax = Math.max(0.05, ...ok.map((p) => p.gz)) * 1.15;
  const ymin = Math.min(0, ...ok.map((p) => p.gz));
  const X = (h: number) => pad + (h / 90) * (W - pad - 8);
  const Y = (g: number) => H - pad - ((g - ymin) / (ymax - ymin)) * (H - pad - 8);
  return (
    <div className="px-2">
      <svg className="mt-2 w-full" viewBox={`0 0 ${W} ${H}`}>
        <rect fill="#1e1e1e" height={H} width={W} />
        {[0, 15, 30, 45, 60, 75, 90].map((h) => (
          <g key={h}>
            <line stroke="#333" x1={X(h)} x2={X(h)} y1={8} y2={H - pad} />
            <text fill="#8a8a8a" fontSize="9" textAnchor="middle" x={X(h)} y={H - pad + 12}>
              {h}°
            </text>
          </g>
        ))}
        <line stroke="#666" x1={pad} x2={W - 8} y1={Y(0)} y2={Y(0)} />
        <text fill="#8a8a8a" fontSize="9" x={2} y={Y(ymax / 1.15) + 3}>
          {(ymax / 1.15).toFixed(2)}
        </text>
        {/* GM tangent at 57.3° */}
        <line stroke="#4772b3" strokeDasharray="3 3" x1={X(0)} x2={X(57.3)} y1={Y(0)} y2={Y(gm)} />
        <polyline fill="none" points={ok.map((p) => `${X(p.heel)},${Y(p.gz)}`).join(" ")} stroke="#ffa028" strokeWidth="2" />
        {ok.map((p) => (
          <circle cx={X(p.heel)} cy={Y(p.gz)} fill="#ffa028" key={p.heel} r="1.8" />
        ))}
        <text fill="#8a8a8a" fontSize="9" x={W - 60} y={14}>
          GZ (m)
        </text>
      </svg>
      <table className="mt-1 w-full">
        <tbody>
          <Row k="Max GZ" u="m" v={`${max.gz.toFixed(3)} at ${max.heel}°`} />
          <Row k="Range of positive stability" u="" v={`to ${vanish}°`} />
        </tbody>
      </table>
      <div className="mt-2 px-1 text-[#a8a8a8]">IMO intact stability (IS Code 2008, general criteria). A reference for ships; small craft use ISO 12217.</div>
      <ul className="mt-1 space-y-0.5 px-1">
        {criteria.map(([k, pass, v]) => (
          <li className="flex items-center gap-2" key={k}>
            <span className={cn("w-10 rounded px-1 text-center text-[10px] font-bold", pass ? "bg-[#23a55a] text-white" : "bg-[#da373c] text-white")}>{pass ? "PASS" : "FAIL"}</span>
            <span className="flex-1">{k}</span>
            <span className="tabular-nums text-white">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResistanceTab({ hull, result, solve, water }: { hull?: SceneObject; result: { eq: Equilibrium; weight: Weight } | null; solve: () => { eq: Equilibrium; weight: Weight } | null; water: "salt" | "fresh" }) {
  const [vMin, setVMin] = React.useState(2);
  const [vMax, setVMax] = React.useState(30);
  const [eta, setEta] = React.useState(0.5);
  const [method, setMethod] = React.useState<"auto" | "holtrop" | "savitsky">("auto");
  const [rows, setRows] = React.useState<{ kn: number; fn: number; r: number | null; p: number | null; trim?: number; m: string }[] | null>(null);
  const run = () => {
    const r = result ?? solve();
    if (!r) return;
    const e = r.eq;
    const rho = RHO[water];
    const nu = NU[water];
    const out: NonNullable<typeof rows> = [];
    const beta = hull?.hull?.type === "planing" ? hull.hull.deadriseAft : 15;
    const planingHull = hull?.hull?.type !== "round";
    for (let kn = vMin; kn <= vMax + 1e-9; kn += Math.max(0.5, (vMax - vMin) / 20)) {
      const v = kn * KN;
      const fn = v / Math.sqrt(9.80665 * e.lwl);
      let R: number | null = null;
      let trim: number | undefined;
      let m = "";
      const useSav = method === "savitsky" || (method === "auto" && planingHull && fn > 0.45);
      if (useSav) {
        const s = savitsky({ mass: e.displacement, b: e.bwl, lcg: r.weight.cg[0] - e.xAft, beta, rho, nu }, v);
        if (s) {
          R = s.r;
          trim = s.trim;
        }
        m = "Savitsky";
      } else if (fn <= 0.45 || method === "holtrop") {
        R = holtrop({ L: e.lwl, B: e.bwl, T: e.draft, V: e.volume, cm: Math.max(0.3, e.cm), cwp: e.cwp, cb: e.cb, lcb: ((e.centre[0] - (e.xAft + e.xFwd) / 2) / e.lwl) * 100, S: e.wetted, AT: e.transomArea, rho, nu }, v);
        m = "Holtrop";
      } else m = "—";
      out.push({ kn, fn, r: R, p: R != null ? (R * v) / eta / 1000 : null, trim, m });
    }
    setRows(out);
  };
  const csv = () =>
    rows &&
    void exportFile("resistance.csv", ["Speed (kn),Fn,Resistance (N),Power (kW),Running trim (deg),Method", ...rows.map((r) => [r.kn.toFixed(1), r.fn.toFixed(3), r.r?.toFixed(0) ?? "", r.p?.toFixed(2) ?? "", r.trim?.toFixed(2) ?? "", r.m].join(","))].join("\n"), "csv", "CSV", false).then((ok) => ok && toast.success("Exported"));
  const ok = rows?.filter((r) => r.r != null) ?? [];
  const W = 320, H = 160, pad = 30;
  const pmax = Math.max(1, ...ok.map((r) => r.p as number));
  const X = (kn: number) => pad + ((kn - vMin) / Math.max(1, vMax - vMin)) * (W - pad - 8);
  const Y = (p: number) => H - pad - (p / pmax) * (H - pad - 10);
  return (
    <>
      <div className="mt-2 border-b border-black/50 bg-[#262626] px-3 py-1 font-semibold text-[#cfcfcf]">Resistance &amp; power</div>
      <div className="flex gap-1 px-3 py-1">
        {(["auto", "holtrop", "savitsky"] as const).map((m) => (
          <button className={cn("flex-1 rounded px-1 py-0.5 capitalize", method === m ? "bg-[#4772b3] text-white" : "bg-[#3a3a3a] hover:bg-[#454545]")} key={m} onClick={() => setMethod(m)} type="button">
            {m === "auto" ? "Auto" : m === "holtrop" ? "Holtrop-Mennen" : "Savitsky"}
          </button>
        ))}
      </div>
      <Slider label="From (kn)" max={60} min={0.5} onChange={setVMin} step={0.5} value={vMin} />
      <Slider label="To (kn)" max={80} min={1} onChange={setVMax} step={0.5} value={vMax} />
      <Slider label="Prop. efficiency" max={0.8} min={0.2} onChange={setEta} step={0.01} value={eta} />
      <div className="flex gap-1 px-3 py-1">
        <button className="flex-1 rounded bg-[#4772b3] py-1.5 font-medium text-white hover:bg-[#5582c4]" onClick={run} type="button">
          Predict
        </button>
        {rows ? (
          <button className="rounded bg-[#3a3a3a] px-2 hover:bg-[#454545]" onClick={csv} type="button">
            CSV
          </button>
        ) : null}
      </div>
      <p className="px-3 text-[#8a8a8a]">Holtrop-Mennen (1984) for displacement speeds (Fn ≤ 0.45), Savitsky (1964) once planing. Uses the hull at its floating condition from Hydrostatics.</p>
      {rows ? (
        <div className="px-2">
          <svg className="mt-2 w-full" viewBox={`0 0 ${W} ${H}`}>
            <rect fill="#1e1e1e" height={H} width={W} />
            <polyline fill="none" points={ok.map((r) => `${X(r.kn)},${Y(r.p as number)}`).join(" ")} stroke="#4aa3ff" strokeWidth="2" />
            <text fill="#8a8a8a" fontSize="9" x={4} y={14}>
              {pmax.toFixed(0)} kW
            </text>
            <text fill="#8a8a8a" fontSize="9" x={pad} y={H - 10}>
              {vMin} kn
            </text>
            <text fill="#8a8a8a" fontSize="9" textAnchor="end" x={W - 8} y={H - 10}>
              {vMax} kn
            </text>
          </svg>
          <table className="mt-1 w-full tabular-nums">
            <thead className="text-[#8a8a8a]">
              <tr>
                <th className="text-left font-normal">kn</th>
                <th className="text-right font-normal">Fn</th>
                <th className="text-right font-normal">R (kN)</th>
                <th className="text-right font-normal">P (kW)</th>
                <th className="text-right font-normal">trim</th>
                <th className="text-right font-normal" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr className="border-b border-white/5" key={r.kn}>
                  <td>{r.kn.toFixed(1)}</td>
                  <td className="text-right">{r.fn.toFixed(2)}</td>
                  <td className="text-right text-white">{r.r != null ? (r.r / 1000).toFixed(2) : "—"}</td>
                  <td className="text-right text-white">{r.p != null ? r.p.toFixed(1) : "—"}</td>
                  <td className="text-right">{r.trim != null ? `${r.trim.toFixed(1)}°` : ""}</td>
                  <td className="text-right text-[#8a8a8a]">{r.m}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function LinesTab({ hull, tris }: { hull?: SceneObject; tris: Tris | null }) {
  const [n, setN] = React.useState(10);
  if (!hull || !tris?.length) return <p className="p-3 text-[#8a8a8a]">Choose a hull above.</p>;
  const { min, max } = boundsOfTris(tris);
  const L = max[0] - min[0];
  const stations = Array.from({ length: n + 1 }, (_, i) => min[0] + (L * i) / n).map((x, i, a) => (i === 0 ? x + L * 1e-4 : i === a.length - 1 ? x - L * 1e-4 : x));
  const D = max[1] - min[1];
  const heights = Array.from({ length: 6 }, (_, i) => min[1] + (D * (i + 1)) / 7);
  const halfB = Math.max(Math.abs(min[2]), Math.abs(max[2]));
  // Body plan: aft stations on the left (mirrored), forward on the right.
  const W = 320, H = 200;
  const k = Math.min((W / 2 - 10) / halfB, (H - 20) / D);
  const bx = (z: number, aft: boolean) => W / 2 + (aft ? -1 : 1) * z * k;
  const by = (y: number) => H - 10 - (y - min[1]) * k;
  const body = stations.map((x, i) => ({ aft: i < stations.length / 2, segs: sliceTris(tris, 0, x).filter(([a, b]) => a[0] >= -1e-6 && b[0] >= -1e-6) }));
  // Profile with waterlines and plan view
  const PW = 320, PH = 120;
  const pk = Math.min((PW - 20) / L, (PH - 20) / (D + 2 * halfB + 0.2 * D));
  const px = (x: number) => 10 + (x - min[0]) * pk;
  const profile = sliceTris(tris, 2, 0);
  const plan = heights.map((y) => sliceTris(tris, 1, y).filter(([a, b]) => a[1] >= -1e-6 && b[1] >= -1e-6));
  const off = offsets(tris, stations, heights);
  const csv = () =>
    void exportFile(
      `${hull.name} offsets.csv`,
      [
        `Half-breadths (m) at stations (x, m) and waterlines (height above keel, m)`,
        ["Station x", ...heights.map((h) => `WL ${(h - min[1]).toFixed(3)}`)].join(","),
        ...off.map((row, i) => [stations[i].toFixed(3), ...row.map((v) => v.toFixed(4))].join(",")),
      ].join("\n"),
      "csv",
      "CSV",
      false,
    ).then((ok) => ok && toast.success("Exported"));
  return (
    <div className="px-2">
      <div className="mt-2 flex items-center gap-2 px-1">
        <span className="font-semibold text-[#cfcfcf]">Body plan</span>
        <span className="text-[#8a8a8a]">aft ← | → fwd</span>
        <select className="ml-auto rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5" onChange={(e) => setN(Number(e.target.value))} value={n}>
          {[6, 10, 12, 20].map((v) => (
            <option key={v} value={v}>
              {v} stations
            </option>
          ))}
        </select>
      </div>
      <svg className="mt-1 w-full" viewBox={`0 0 ${W} ${H}`}>
        <rect fill="#f8f6ef" height={H} width={W} />
        <line stroke="#c9c2b0" x1={W / 2} x2={W / 2} y1={0} y2={H} />
        {heights.map((y) => (
          <line key={y} stroke="#e2dccb" x1={0} x2={W} y1={by(y)} y2={by(y)} />
        ))}
        {body.map((s, i) =>
          s.segs.map(([a, b], j) => <line key={`${i}-${j}`} stroke={s.aft ? "#b23a3a" : "#2c5aa0"} strokeWidth="0.9" x1={bx(a[0], s.aft)} x2={bx(b[0], s.aft)} y1={by(a[1])} y2={by(b[1])} />),
        )}
      </svg>
      <div className="mt-2 px-1 font-semibold text-[#cfcfcf]">Profile &amp; half-breadth plan</div>
      <svg className="mt-1 w-full" viewBox={`0 0 ${PW} ${PH}`}>
        <rect fill="#f8f6ef" height={PH} width={PW} />
        {stations.map((x) => (
          <line key={x} stroke="#e2dccb" x1={px(x)} x2={px(x)} y1={0} y2={PH} />
        ))}
        {profile.map(([a, b], j) => (
          <line key={j} stroke="#333" strokeWidth="0.9" x1={px(a[0])} x2={px(b[0])} y1={10 + (max[1] - a[1]) * pk} y2={10 + (max[1] - b[1]) * pk} />
        ))}
        {plan.map((segs, i) =>
          segs.map(([a, b], j) => (
            <line key={`${i}-${j}`} stroke="#2c5aa0" strokeWidth="0.8" x1={px(a[0])} x2={px(b[0])} y1={PH - 10 - a[1] * pk} y2={PH - 10 - b[1] * pk} />
          )),
        )}
      </svg>
      <div className="mt-2 flex items-center px-1">
        <span className="font-semibold text-[#cfcfcf]">Offsets</span>
        <button className="ml-auto rounded bg-[#3a3a3a] px-2 py-0.5 hover:bg-[#454545]" onClick={csv} type="button">
          Export table (CSV)
        </button>
      </div>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full tabular-nums">
          <thead className="text-[#8a8a8a]">
            <tr>
              <th className="pr-2 text-left font-normal">x</th>
              {heights.map((h) => (
                <th className="text-right font-normal" key={h}>
                  {(h - min[1]).toFixed(2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {off.map((row, i) => (
              <tr className="border-b border-white/5" key={stations[i]}>
                <td className="pr-2">{stations[i].toFixed(2)}</td>
                {row.map((v, j) => (
                  <td className="text-right text-white" key={j}>
                    {v ? v.toFixed(3) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
