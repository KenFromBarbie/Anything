import * as React from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Copy,
  Eye,
  EyeOff,
  Italic,
  Merge,
  Plus,
  Trash2,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";

import { Panel, Slider } from "./CreativeShell";
import { boundsOf, ctx2d, drawContent } from "./imageEngine";
import { type Adjust, BLEND_MODES, IMAGE_FONTS, type ImageLayer, NO_ADJUST } from "./imageFormat";

export const SWATCHES = [
  "#000000", "#404040", "#808080", "#bfbfbf", "#ffffff", "#7f1d1d",
  "#ef4444", "#f97316", "#f59e0b", "#facc15", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
  "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#78350f",
];

const iconBtn = "flex h-6 w-6 items-center justify-center rounded hover:bg-[#3d3d3d] disabled:opacity-30";

export function ColorPanel({
  fg,
  bg,
  onFg,
  onBg,
}: {
  fg: string;
  bg: string;
  onFg: (c: string) => void;
  onBg: (c: string) => void;
}) {
  return (
    <Panel title="Color">
      <div className="flex items-start gap-3 p-3">
        <div className="relative h-12 w-12 shrink-0">
          <label className="absolute bottom-0 right-0 h-8 w-8 cursor-pointer rounded-sm border border-black/70 shadow" style={{ background: bg }} title="Background colour">
            <input className="sr-only" onChange={(e) => onBg(e.target.value)} type="color" value={toSix(bg)} />
          </label>
          <label className="absolute left-0 top-0 h-8 w-8 cursor-pointer rounded-sm border border-white/70 shadow" style={{ background: fg }} title="Foreground colour">
            <input className="sr-only" onChange={(e) => onFg(e.target.value)} type="color" value={toSix(fg)} />
          </label>
        </div>
        <div className="grid flex-1 grid-cols-12 gap-[3px]">
          {SWATCHES.map((c) => (
            <button
              aria-label={c}
              className="aspect-square rounded-[2px] border border-black/50"
              key={c}
              onClick={() => onFg(c)}
              onContextMenu={(e) => {
                e.preventDefault();
                onBg(c);
              }}
              style={{ background: c }}
              title={`${c} (right-click: background)`}
              type="button"
            />
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 px-3 pb-2 text-[11px]">
        <span className="text-[#a8a8a8]">Hex</span>
        <input
          className="w-24 rounded border border-black/50 bg-[#1e1e1e] px-1.5 py-0.5 font-mono"
          onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && onFg(e.target.value)}
          defaultValue={fg}
          key={fg}
        />
      </label>
    </Panel>
  );
}

export function toSix(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c.slice(1).split("").map((x) => x + x).join("")}`;
  return "#000000";
}

export function PropertiesPanel({
  layer,
  raster,
  onChange,
  onCommit,
}: {
  layer: ImageLayer | undefined;
  raster?: HTMLCanvasElement;
  onChange: (patch: Partial<ImageLayer>) => void;
  onCommit: (label: string) => void;
}) {
  if (!layer) return <p className="p-3 text-[11px] text-[#8a8a8a]">No layer selected.</p>;
  const b = boundsOf(layer, raster);
  const field = (label: string, value: number, set: (v: number) => void) => (
    <label className="flex items-center gap-1.5">
      <span className="w-4 text-[#a8a8a8]">{label}</span>
      <input
        className="w-16 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-right"
        onBlur={() => onCommit("Properties")}
        onChange={(e) => set(Number(e.target.value))}
        type="number"
        value={Math.round(value)}
      />
    </label>
  );
  return (
    <div className="space-y-2 p-3 text-[11px]">
      <div className="font-semibold text-[#cfcfcf]">
        {layer.kind === "raster" ? "Pixel layer" : layer.kind === "text" ? "Type layer" : "Shape layer"}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {field("X", layer.x, (x) => onChange({ x }))}
        {field("Y", layer.y, (y) => onChange({ y }))}
        {layer.kind === "shape" ? (
          <>
            {field("W", layer.w, (w) => onChange({ w } as Partial<ImageLayer>))}
            {field("H", layer.h, (h) => onChange({ h } as Partial<ImageLayer>))}
          </>
        ) : (
          <span className="col-span-2 text-[#8a8a8a]">
            {Math.round(b.w)} × {Math.round(b.h)} px
          </span>
        )}
      </div>
      {layer.kind === "text" ? (
        <>
          <textarea
            className="h-16 w-full resize-none rounded border border-black/50 bg-[#1e1e1e] p-1.5 text-[12px]"
            onBlur={() => onCommit("Edit type")}
            onChange={(e) => onChange({ text: e.target.value } as Partial<ImageLayer>)}
            value={layer.text}
          />
          <div className="flex items-center gap-1.5">
            <select
              className="min-w-0 flex-1 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5"
              onChange={(e) => {
                onChange({ font: e.target.value } as Partial<ImageLayer>);
                onCommit("Font");
              }}
              value={layer.font}
            >
              {IMAGE_FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <input
              className="w-14 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-right"
              min={1}
              onBlur={() => onCommit("Font size")}
              onChange={(e) => onChange({ size: Math.max(1, Number(e.target.value)) } as Partial<ImageLayer>)}
              type="number"
              value={layer.size}
            />
            <span className="text-[#8a8a8a]">px</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              className="h-6 w-8 cursor-pointer rounded border border-black/50 bg-transparent"
              onBlur={() => onCommit("Text colour")}
              onChange={(e) => onChange({ color: e.target.value } as Partial<ImageLayer>)}
              type="color"
              value={toSix(layer.color)}
            />
            <button className={cn(iconBtn, layer.bold && "bg-[#4a4a4a]")} onClick={() => { onChange({ bold: !layer.bold } as Partial<ImageLayer>); onCommit("Bold"); }} title="Bold" type="button">
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button className={cn(iconBtn, layer.italic && "bg-[#4a4a4a]")} onClick={() => { onChange({ italic: !layer.italic } as Partial<ImageLayer>); onCommit("Italic"); }} title="Italic" type="button">
              <Italic className="h-3.5 w-3.5" />
            </button>
            <span className="w-2" />
            {(["left", "center", "right"] as const).map((a) => {
              const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
              return (
                <button
                  className={cn(iconBtn, (layer.align ?? "left") === a && "bg-[#4a4a4a]")}
                  key={a}
                  onClick={() => {
                    onChange({ align: a } as Partial<ImageLayer>);
                    onCommit("Align text");
                  }}
                  title={`Align ${a}`}
                  type="button"
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {layer.kind === "shape" ? (
        <>
          <ColorRow label="Fill" onChange={(fill) => onChange({ fill } as Partial<ImageLayer>)} onCommit={() => onCommit("Fill")} value={layer.fill} />
          <ColorRow label="Stroke" onChange={(stroke) => onChange({ stroke } as Partial<ImageLayer>)} onCommit={() => onCommit("Stroke")} value={layer.stroke} />
          <Slider label="Stroke width" max={100} min={0} onChange={(strokeWidth) => onChange({ strokeWidth } as Partial<ImageLayer>)} onCommit={() => onCommit("Stroke width")} value={layer.strokeWidth} />
          {layer.shape === "rect" ? (
            <Slider label="Corner radius" max={500} min={0} onChange={(radius) => onChange({ radius } as Partial<ImageLayer>)} onCommit={() => onCommit("Corner radius")} value={layer.radius ?? 0} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  onChange: (c: string) => void;
  onCommit: () => void;
}) {
  const none = value === "transparent";
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 text-[#a8a8a8]">{label}</span>
      <input
        className="h-6 w-8 cursor-pointer rounded border border-black/50 bg-transparent disabled:opacity-30"
        disabled={none}
        onBlur={onCommit}
        onChange={(e) => onChange(e.target.value)}
        type="color"
        value={toSix(value)}
      />
      <label className="flex items-center gap-1 text-[#a8a8a8]">
        <input
          checked={none}
          onChange={(e) => {
            onChange(e.target.checked ? "transparent" : "#000000");
            onCommit();
          }}
          type="checkbox"
        />
        None
      </label>
    </div>
  );
}

const ADJUSTMENTS: { key: keyof Adjust; label: string; min: number; max: number; unit: string }[] = [
  { key: "brightness", label: "Brightness", min: 0, max: 200, unit: "%" },
  { key: "contrast", label: "Contrast", min: 0, max: 200, unit: "%" },
  { key: "saturation", label: "Saturation", min: 0, max: 300, unit: "%" },
  { key: "hue", label: "Hue", min: -180, max: 180, unit: "°" },
  { key: "blur", label: "Blur", min: 0, max: 50, unit: "px" },
  { key: "grayscale", label: "Black & White", min: 0, max: 100, unit: "%" },
  { key: "sepia", label: "Sepia", min: 0, max: 100, unit: "%" },
  { key: "invert", label: "Invert", min: 0, max: 100, unit: "%" },
];

export function AdjustmentsPanel({
  layer,
  onChange,
  onCommit,
}: {
  layer: ImageLayer | undefined;
  onChange: (a: Adjust) => void;
  onCommit: (label: string) => void;
}) {
  if (!layer) return <p className="p-3 text-[11px] text-[#8a8a8a]">No layer selected.</p>;
  const a = layer.adjust ?? NO_ADJUST;
  return (
    <div className="py-2">
      <p className="px-3 pb-1 text-[11px] text-[#8a8a8a]">Applies to “{layer.name}”, without changing its pixels.</p>
      {ADJUSTMENTS.map((s) => (
        <Slider
          key={s.key}
          label={s.label}
          max={s.max}
          min={s.min}
          onChange={(v) => onChange({ ...a, [s.key]: v })}
          onCommit={() => onCommit(s.label)}
          unit={s.unit}
          value={a[s.key]}
        />
      ))}
      <button
        className="mx-3 mt-1 rounded border border-black/50 bg-[#3a3a3a] px-2 py-0.5 text-[11px] hover:bg-[#454545]"
        onClick={() => {
          onChange({ ...NO_ADJUST });
          onCommit("Reset adjustments");
        }}
        type="button"
      >
        Reset
      </button>
    </div>
  );
}

export function HistoryPanel({
  labels,
  index,
  onPick,
}: {
  labels: string[];
  index: number;
  onPick: (i: number) => void;
}) {
  return (
    <ul className="py-1 text-[12px]">
      {labels.map((l, i) => (
        <li key={`${i}-${l}`}>
          <button
            className={cn(
              "w-full px-3 py-1 text-left",
              i === index ? "bg-[#2f6fd6] text-white" : i > index ? "text-[#6f6f6f] hover:bg-[#333]" : "hover:bg-[#333]",
            )}
            onClick={() => onPick(i)}
            type="button"
          >
            {l}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function LayersPanel({
  layers,
  rasters,
  active,
  tick,
  docSize,
  onSelect,
  onChange,
  onCommit,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
  onMergeDown,
}: {
  layers: ImageLayer[];
  rasters: Map<string, HTMLCanvasElement>;
  active: string;
  tick: number;
  docSize: { width: number; height: number };
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<ImageLayer>) => void;
  onCommit: (label: string) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (dir: 1 | -1) => void;
  onMergeDown: () => void;
}) {
  const current = layers.find((l) => l.id === active);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const index = layers.findIndex((l) => l.id === active);
  return (
    <Panel className="flex-1" title="Layers">
      <div className="flex items-center gap-2 border-b border-black/50 px-2 py-1.5 text-[11px]">
        <select
          aria-label="Blend mode"
          className="min-w-0 flex-1 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 capitalize"
          disabled={!current}
          onChange={(e) => {
            if (!current) return;
            onChange(current.id, { blend: e.target.value as ImageLayer["blend"] });
            onCommit("Blend mode");
          }}
          value={current?.blend ?? "normal"}
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m.replace("-", " ")}
            </option>
          ))}
        </select>
        <span className="text-[#a8a8a8]">Opacity</span>
        <input
          aria-label="Opacity"
          className="w-12 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-right"
          disabled={!current}
          max={100}
          min={0}
          onBlur={() => onCommit("Opacity")}
          onChange={(e) => current && onChange(current.id, { opacity: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })}
          type="number"
          value={Math.round((current?.opacity ?? 1) * 100)}
        />
        <span className="text-[#8a8a8a]">%</span>
      </div>
      <ul className="py-0.5">
        {[...layers].reverse().map((l) => (
          <li key={l.id}>
            <div
              className={cn(
                "flex h-11 cursor-default items-center gap-1.5 border-b border-black/30 pr-2",
                l.id === active ? "bg-[#3d4f6b]" : "hover:bg-[#333]",
              )}
              onClick={() => onSelect(l.id)}
              onKeyDown={() => {}}
              role="option"
              aria-selected={l.id === active}
              tabIndex={-1}
            >
              <button
                aria-label={l.visible ? "Hide layer" : "Show layer"}
                className="flex h-full w-7 shrink-0 items-center justify-center text-[#b5b5b5] hover:text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(l.id, { visible: !l.visible });
                  onCommit(l.visible ? "Hide layer" : "Show layer");
                }}
                type="button"
              >
                {l.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 opacity-50" />}
              </button>
              <LayerThumb docSize={docSize} layer={l} raster={rasters.get(l.id)} tick={tick} />
              {renaming === l.id ? (
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-[#2f80ed] bg-[#1e1e1e] px-1 py-0.5 text-[12px]"
                  defaultValue={l.name}
                  onBlur={(e) => {
                    setRenaming(null);
                    if (e.target.value.trim() && e.target.value !== l.name) {
                      onChange(l.id, { name: e.target.value.trim() });
                      onCommit("Rename layer");
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <span
                  className={cn("min-w-0 flex-1 truncate text-[12px]", !l.visible && "opacity-50")}
                  onDoubleClick={() => setRenaming(l.id)}
                  title="Double-click to rename"
                >
                  {l.name}
                </span>
              )}
              {l.kind === "text" ? <span className="text-[10px] text-[#8a8a8a]">T</span> : null}
              {l.adjust && JSON.stringify(l.adjust) !== JSON.stringify(NO_ADJUST) ? (
                <span className="text-[10px] text-[#8a8a8a]" title="Has adjustments">fx</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <div className="sticky bottom-0 flex items-center justify-end gap-0.5 border-t border-black/50 bg-[#262626] px-2 py-1">
        <button className={iconBtn} onClick={() => onMove(1)} disabled={index >= layers.length - 1} title="Move layer up" type="button">
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button className={iconBtn} onClick={() => onMove(-1)} disabled={index <= 0} title="Move layer down" type="button">
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button className={iconBtn} onClick={onMergeDown} disabled={index <= 0} title="Merge down (Ctrl+E)" type="button">
          <Merge className="h-3.5 w-3.5" />
        </button>
        <button className={iconBtn} onClick={onDuplicate} disabled={!current} title="Duplicate layer (Ctrl+J)" type="button">
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button className={iconBtn} onClick={onAdd} title="New layer (Ctrl+Shift+N)" type="button">
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button className={iconBtn} onClick={onDelete} disabled={layers.length <= 1} title="Delete layer" type="button">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </Panel>
  );
}

function LayerThumb({
  layer,
  raster,
  tick,
  docSize,
}: {
  layer: ImageLayer;
  raster?: HTMLCanvasElement;
  tick: number;
  docSize: { width: number; height: number };
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const k = Math.min(44 / docSize.width, 32 / docSize.height);
  const w = Math.max(1, Math.round(docSize.width * k));
  const h = Math.max(1, Math.round(docSize.height * k));
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick = pixels changed
  React.useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = ctx2d(c);
    g.clearRect(0, 0, c.width, c.height);
    g.save();
    g.scale(k, k);
    drawContent(g, layer, raster);
    g.restore();
  }, [layer, raster, tick, k]);
  return (
    <canvas
      className="shrink-0 border border-black/60 [background:repeating-conic-gradient(#bbb_0_25%,#fff_0_50%)_0_0/8px_8px]"
      height={h}
      ref={ref}
      width={w}
    />
  );
}
