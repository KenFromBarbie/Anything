import * as React from "react";
import * as THREE from "three";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";

import type { CadApi } from "./CadPanels";
import { exportFile } from "./editorStore";
import type { ModelFile, SceneObject } from "./modelFormat";
import { DEFAULT_PRINT, FILAMENTS, formatDuration, type Move, parseGcode, PRINTERS, type PrintSettings, slice, type SliceResult, toGcode } from "./slicer";

const head = "mt-2 border-b border-black/50 bg-[#262626] px-3 py-1 font-semibold text-[#cfcfcf]";
const inp = "rounded border border-black/50 bg-[#1e1e1e] px-1.5 py-0.5";
const btn = "rounded bg-[#3a3a3a] px-2 py-1 hover:bg-[#454545] disabled:opacity-40";
const primary = "rounded bg-[#4772b3] px-2 py-1 text-white hover:bg-[#5582c4] disabled:opacity-40";

const KIND_COLOR: Record<Move["kind"], string> = { outer: "#ff8a3d", wall: "#ffd166", infill: "#4cc9f0", solid: "#57cc99", skirt: "#9aa0a6", travel: "#ff5c8a" };

/** 3D printing: slice the selected solid, look at the path layer by layer,
 *  and save the G-code for the printer. */
export function PrintPanel({
  model,
  selected,
  api,
  change,
  onExportStl,
}: {
  model: ModelFile;
  selected?: SceneObject;
  api: CadApi;
  change: (m: ModelFile, label?: string) => void;
  onExportStl: () => void;
}) {
  const [tab, setTab] = React.useState("Slice");
  const s: PrintSettings = { ...DEFAULT_PRINT, ...(model.studies?.print ?? {}) };
  const set = (patch: Partial<PrintSettings>) => change({ ...model, studies: { ...model.studies, print: { ...s, ...patch } } });
  const [result, setResult] = React.useState<SliceResult | null>(null);
  const [layer, setLayer] = React.useState(0);
  const [travel, setTravel] = React.useState(false);
  const [only, setOnly] = React.useState(false);
  const [loaded, setLoaded] = React.useState<{ name: string; layers: { z: number; moves: Move[] }[]; filament: number } | null>(null);
  const printer = PRINTERS.find((p) => p.id === s.printer) ?? PRINTERS[0];
  const fil = FILAMENTS.find((f) => f.id === s.filament) ?? FILAMENTS[0];
  const gcode = React.useMemo(() => (result?.ok ? toGcode(result, s, selected?.name ?? "model") : ""), [result, s.startGcode, s.endGcode, selected?.name]);

  const run = () => {
    if (!selected) return toast.error("Select the object to print");
    const t = api.tris(selected.id);
    if (!t?.length) return toast.error("That object has no solid geometry");
    const r = slice(t, s);
    setResult(r);
    setLoaded(null);
    if (!r.ok) return toast.error(r.error ?? "Couldn't slice it");
    setLayer(r.layers.length - 1);
    setTab("Preview");
  };

  // path preview on the model (printer mm → scene m, back where the part is)
  React.useEffect(() => {
    const src = loaded ? { layers: loaded.layers, ox: 0, oy: 0, base: 0, k: 1000 } : result?.ok ? { layers: result.layers, ox: result.offset[0], oy: result.offset[1], base: result.baseZ, k: 1000 * s.scale } : null;
    if (!src || tab === "Slice") return api.overlay("print-path", null);
    const groups = new Map<string, number[]>();
    const from = only ? layer : 0;
    for (let i = from; i <= Math.min(layer, src.layers.length - 1); i++) {
      const l = src.layers[i];
      let px = 0, py = 0, has = false;
      for (const m of l.moves) {
        if (has && (m.e || travel)) {
          const key = m.e ? m.kind : "travel";
          const arr = groups.get(key) ?? [];
          if (!groups.has(key)) groups.set(key, arr);
          const y = (l.z + src.base) / src.k;
          arr.push((px - src.ox) / src.k, y, -(py - src.oy) / src.k, (m.x - src.ox) / src.k, y, -(m.y - src.oy) / src.k);
        }
        px = m.x; py = m.y; has = true;
      }
    }
    const g = new THREE.Group();
    for (const [kind, pos] of groups) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: KIND_COLOR[kind as Move["kind"]] ?? "#fff", depthTest: !loaded, transparent: kind === "travel", opacity: kind === "travel" ? 0.5 : 1 }));
      line.renderOrder = 8;
      g.add(line);
    }
    api.overlay("print-path", g);
    return () => api.overlay("print-path", null);
  }, [result, loaded, layer, travel, only, tab, api, s.scale]);

  const fitToBed = () => {
    if (!selected) return;
    const t = api.tris(selected.id);
    if (!t?.length) return;
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i += 3) for (let c = 0; c < 3; c++) {
      mn[c] = Math.min(mn[c], t[i + c]);
      mx[c] = Math.max(mx[c], t[i + c]);
    }
    const mm = [(mx[0] - mn[0]) * 1000, (mx[2] - mn[2]) * 1000, (mx[1] - mn[1]) * 1000];
    const k = Math.min((printer.bed[0] - 10) / mm[0], (printer.bed[1] - 10) / mm[1], (printer.bed[2] - 5) / mm[2]);
    set({ scale: Math.round(k * 1000) / 1000 });
  };

  const num = (v: number, on: (n: number) => void, step = 1, w = "w-14") => <input className={cn(inp, w, "text-right")} onChange={(e) => on(Number(e.target.value))} step={step} type="number" value={v} />;
  const row = (label: string, children: React.ReactNode) => (
    <label className="flex items-center gap-2 px-3 py-0.5">
      <span className="w-24 shrink-0 text-[#bdbdbd]">{label}</span>
      {children}
    </label>
  );
  const shown = loaded ? loaded.layers : result?.ok ? result.layers : [];

  return (
    <div className="flex w-[23rem] shrink-0 flex-col border-r border-black/60 bg-[#2b2b2b] text-[11px]">
      <div className="flex gap-0.5 border-b border-black/60 bg-[#262626] p-1">
        {["Slice", "Preview", "G-code"].map((t) => (
          <button className={cn("rounded px-2 py-1", tab === t ? "bg-[#4772b3] text-white" : "text-[#bdbdbd] hover:bg-[#3a3a3a]")} key={t} onClick={() => setTab(t)} type="button">
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {tab === "Slice" ? (
          <>
            <div className={head}>Printer &amp; filament</div>
            {row(
              "Printer",
              <select className={cn(inp, "min-w-0 flex-1")} onChange={(e) => set({ printer: e.target.value })} value={s.printer}>
                {PRINTERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>,
            )}
            {row(
              "Filament",
              <>
                <select className={cn(inp, "min-w-0 flex-1")} onChange={(e) => set({ filament: e.target.value })} value={s.filament}>
                  {FILAMENTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <span className="text-[#8a8a8a]">
                  {fil.nozzle}° / {fil.bed}°
                </span>
              </>,
            )}
            <div className={head}>Part</div>
            <p className="px-3 py-1 text-[#8a8a8a]">{selected ? `Printing: ${selected.name}` : "Select the object to print."} The scene is in metres (1 unit = 1000 mm); scale it for the printer.</p>
            {row(
              "Scale",
              <>
                {num(s.scale, (v) => set({ scale: Math.max(0.0001, v) }), 0.01, "w-16")}
                <button className={btn} onClick={fitToBed} type="button">Fit to bed</button>
                <button className={btn} onClick={() => set({ scale: 1 })} type="button">1:1</button>
                <button className={btn} onClick={() => set({ scale: 0.1 })} type="button">1:10</button>
              </>,
            )}
            <div className={head}>Quality</div>
            {row(
              "Layer height",
              <>
                {num(s.layer, (v) => set({ layer: Math.min(printer.nozzle * 0.8, Math.max(0.05, v)) }), 0.04)}
                <span className="text-[#8a8a8a]">mm</span>
                {[
                  ["Fine", 0.12],
                  ["Standard", 0.2],
                  ["Draft", 0.28],
                ].map(([l, v]) => (
                  <button className={cn(btn, s.layer === v && "bg-[#4772b3] text-white")} key={l} onClick={() => set({ layer: v as number })} type="button">
                    {l}
                  </button>
                ))}
              </>,
            )}
            {row("Walls", num(s.walls, (v) => set({ walls: Math.min(8, Math.max(1, Math.round(v))) })))}
            {row(
              "Infill",
              <>
                <input className="h-1 flex-1 accent-[#4772b3]" max={100} min={0} onChange={(e) => set({ infill: Number(e.target.value) })} step={5} type="range" value={s.infill} />
                <span className="w-8 text-right">{s.infill}%</span>
              </>,
            )}
            {row("Top / bottom", <>{num(s.topBottom, (v) => set({ topBottom: Math.min(20, Math.max(0, Math.round(v))) }))}<span className="text-[#8a8a8a]">solid layers</span></>)}
            <div className={head}>Speed</div>
            {row("Print", <>{num(s.speed, (v) => set({ speed: Math.min(printer.maxSpeed, Math.max(5, v)) }), 5)}<span className="text-[#8a8a8a]">mm/s (max {printer.maxSpeed})</span></>)}
            {row("First layer", <>{num(s.firstSpeed, (v) => set({ firstSpeed: Math.max(5, v) }), 5)}<span className="text-[#8a8a8a]">mm/s</span></>)}
            {row("Retraction", <>{num(s.retract, (v) => set({ retract: Math.max(0, v) }), 0.5)}<span className="text-[#8a8a8a]">mm (0.5–1 for direct drive)</span></>)}
            <label className="flex items-center gap-2 px-3 py-1">
              <input checked={s.skirt} onChange={(e) => set({ skirt: e.target.checked })} type="checkbox" />
              Skirt (primes the nozzle around the part)
            </label>
            <div className="flex gap-1 px-3 py-2">
              <button className={primary} disabled={!selected} onClick={run} type="button">Slice</button>
              <button className={btn} onClick={onExportStl} type="button">Export STL (for another slicer)</button>
            </div>
            {result ? <Summary printer={printer.label} r={result} /> : null}
          </>
        ) : null}

        {tab === "Preview" ? (
          shown.length ? (
            <>
              <div className={head}>Print path{loaded ? `: ${loaded.name}` : ""}</div>
              <label className="flex items-center gap-2 px-3 py-2">
                <span className="text-[#bdbdbd]">Layer</span>
                <input className="h-1 flex-1 accent-[#4772b3]" max={shown.length - 1} min={0} onChange={(e) => setLayer(Number(e.target.value))} type="range" value={Math.min(layer, shown.length - 1)} />
                <span className="w-20 text-right font-mono">
                  {Math.min(layer, shown.length - 1) + 1} / {shown.length}
                </span>
              </label>
              <div className="px-3 text-[#8a8a8a]">Height {shown[Math.min(layer, shown.length - 1)]?.z.toFixed(2)} mm</div>
              <label className="flex items-center gap-2 px-3 py-1">
                <input checked={only} onChange={(e) => setOnly(e.target.checked)} type="checkbox" />
                Only this layer
              </label>
              <label className="flex items-center gap-2 px-3 py-1">
                <input checked={travel} onChange={(e) => setTravel(e.target.checked)} type="checkbox" />
                Show travel moves
              </label>
              <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-1">
                {(Object.keys(KIND_COLOR) as Move["kind"][]).map((k) => (
                  <span className="flex items-center gap-1" key={k}>
                    <span className="h-2 w-3 rounded-sm" style={{ background: KIND_COLOR[k] }} />
                    {k === "outer" ? "outer wall" : k === "wall" ? "inner wall" : k === "solid" ? "top/bottom" : k}
                  </span>
                ))}
              </div>
              {result?.ok && !loaded ? <Summary printer={printer.label} r={result} /> : null}
            </>
          ) : (
            <p className="px-3 py-2 text-[#8a8a8a]">Slice a part first (or open a G-code file in the G-code tab).</p>
          )
        ) : null}

        {tab === "G-code" ? (
          <>
            <div className={head}>G-code</div>
            <div className="flex flex-wrap gap-1 px-3 py-2">
              <button
                className={primary}
                disabled={!gcode}
                onClick={() => void exportFile(`${(selected?.name ?? "model").replace(/[^A-Za-z0-9_-]+/g, "-")}.gcode`, gcode, "gcode", "G-code").then((ok) => ok && toast.success("G-code saved: copy it to the printer's SD card or send it with your print host"))}
                type="button"
              >
                Save .gcode
              </button>
              <label className={cn(btn, "cursor-pointer")}>
                Open a .gcode file…
                <input
                  accept=".gcode,.gco,.g,.nc,text/plain"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const p = parseGcode(await f.text());
                    if (!p.layers.length) return toast.error("No print moves found in that file");
                    setLoaded({ name: f.name, ...p });
                    setLayer(p.layers.length - 1);
                    setTab("Preview");
                  }}
                  type="file"
                />
              </label>
            </div>
            {gcode ? (
              <>
                <div className="px-3 text-[#8a8a8a]">{gcode.split("\n").length.toLocaleString()} lines · Marlin flavour (Ender, Prusa, most Klipper setups)</div>
                <textarea className={cn(inp, "mx-3 mt-1 h-56 w-[calc(100%-1.5rem)] resize-y font-mono text-[10.5px] leading-snug")} readOnly spellCheck={false} value={gcode.length > 60000 ? `${gcode.slice(0, 60000)}\n; … (${(gcode.length / 1024).toFixed(0)} kB in the saved file)` : gcode} />
              </>
            ) : (
              <p className="px-3 text-[#8a8a8a]">Slice a part to get its G-code.</p>
            )}
            <div className={head}>Your own start / end code</div>
            <p className="px-3 py-1 text-[#8a8a8a]">Replaces the built-in prime line and shut-down (heating and homing stay). Leave empty for the defaults.</p>
            <textarea className={cn(inp, "mx-3 h-20 w-[calc(100%-1.5rem)] resize-y font-mono text-[10.5px]")} onChange={(e) => set({ startGcode: e.target.value || undefined })} placeholder={"; start, e.g.\nG29 ; bed levelling\nG1 Z2 F3000"} spellCheck={false} value={s.startGcode ?? ""} />
            <textarea className={cn(inp, "mx-3 mt-1 h-20 w-[calc(100%-1.5rem)] resize-y font-mono text-[10.5px]")} onChange={(e) => set({ endGcode: e.target.value || undefined })} placeholder={"; end, e.g.\nG1 Z200 F3000\nM104 S0\nM140 S0\nM84"} spellCheck={false} value={s.endGcode ?? ""} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Summary({ r, printer }: { r: SliceResult; printer: string }) {
  if (!r.ok) return <p className="px-3 py-2 text-[#ff8a80]">{r.error}</p>;
  return (
    <div className="mx-3 mt-2 space-y-1 rounded bg-[#232323] p-2">
      <table className="w-full">
        <tbody>
          {[
            ["Size on the bed", `${r.size.map((v) => v.toFixed(1)).join(" × ")} mm`],
            ["Layers", String(r.layers.length)],
            ["Print time", `about ${formatDuration(r.seconds)}`],
            ["Filament", `${(r.filament / 1000).toFixed(2)} m · ${r.grams.toFixed(1)} g`],
            ["Material cost", `about ${r.cost.toFixed(2)}`],
          ].map(([k, v]) => (
            <tr key={k}>
              <td className="py-0.5 text-[#bdbdbd]">{k}</td>
              <td className="text-right font-mono text-[#e6e6e6]">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.warnings.map((w) => (
        <div className="text-[#ffcf80]" key={w}>
          {w}
        </div>
      ))}
      {!r.warnings.length ? <div className="text-[#5bd18b]">Fits the {printer.split(" (")[0]} and needs no supports.</div> : null}
      <p className="text-[10px] text-[#7a7a7a]">Time is an estimate (real printers accelerate and vary). No supports, bridges or seam tuning: for a tricky part, export the STL to a full slicer.</p>
    </div>
  );
}
