import { type CellValue, chartData, type SheetChart } from "./formats";

const PALETTE = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];

/** A chart from a sheet range (Excel's default colours), drawn as SVG. */
export function ChartView({
  chart,
  get,
  width = 480,
  height = 280,
}: {
  chart: SheetChart;
  get: (ref: string) => CellValue;
  width?: number;
  height?: number;
}) {
  const { labels, series } = chartData(chart.range, get);
  const W = width;
  const H = height;
  const top = chart.title ? 34 : 14;
  const legend = series.length > 1 || chart.type === "pie" ? 22 : 0;
  if (!labels.length || !series.length) {
    return (
      <svg height={H} role="img" viewBox={`0 0 ${W} ${H}`} width="100%">
        <text fill="#888" fontSize="13" textAnchor="middle" x={W / 2} y={H / 2}>
          No data in {chart.range}
        </text>
      </svg>
    );
  }
  const titleEl = chart.title ? (
    <text fill="#404040" fontSize="15" fontWeight="600" textAnchor="middle" x={W / 2} y={22}>
      {chart.title}
    </text>
  ) : null;

  if (chart.type === "pie") {
    const values = series[0].values.map((v) => Math.max(0, v));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const r = Math.min(W, H - top - legend) / 2 - 8;
    const cx = W / 2;
    const cy = top + (H - top - legend) / 2;
    let angle = -Math.PI / 2;
    return (
      <svg height={H} role="img" viewBox={`0 0 ${W} ${H}`} width="100%">
        {titleEl}
        {values.map((v, i) => {
          const a = (v / total) * Math.PI * 2;
          const x1 = cx + r * Math.cos(angle);
          const y1 = cy + r * Math.sin(angle);
          angle += a;
          const x2 = cx + r * Math.cos(angle);
          const y2 = cy + r * Math.sin(angle);
          const d = a >= Math.PI * 2 - 1e-6
            ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
            : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`;
          return <path d={d} fill={PALETTE[i % PALETTE.length]} key={`${labels[i]}-${i}`} stroke="#fff" strokeWidth="1.5" />;
        })}
        <Legend items={labels} y={H - 8} width={W} />
      </svg>
    );
  }

  const left = 48;
  const right = 12;
  const bottom = 26 + legend;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const step = niceStep(span / 5);
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  const lo = ticks[0];
  const hi = Math.max(ticks[ticks.length - 1], max);
  const y = (v: number) => top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const band = plotW / labels.length;

  return (
    <svg height={H} role="img" viewBox={`0 0 ${W} ${H}`} width="100%">
      {titleEl}
      {ticks.map((t) => (
        <g key={t}>
          <line stroke="#e5e5e5" x1={left} x2={W - right} y1={y(t)} y2={y(t)} />
          <text fill="#7f7f7f" fontSize="11" textAnchor="end" x={left - 6} y={y(t) + 4}>
            {Number(t.toPrecision(6)).toLocaleString()}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <text fill="#595959" fontSize="11" key={`${l}-${i}`} textAnchor="middle" x={left + band * (i + 0.5)} y={top + plotH + 16}>
          {l.length > 12 ? `${l.slice(0, 11)}…` : l}
        </text>
      ))}
      {chart.type === "bar"
        ? series.map((s, si) => {
            const w = (band * 0.7) / series.length;
            return s.values.map((v, i) => (
              <rect
                fill={PALETTE[si % PALETTE.length]}
                height={Math.abs(y(v) - y(0))}
                key={`${si}-${i}`}
                width={Math.max(1, w - 2)}
                x={left + band * i + band * 0.15 + w * si}
                y={Math.min(y(v), y(0))}
              />
            ));
          })
        : series.map((s, si) => (
            <g key={s.name}>
              <polyline
                fill="none"
                points={s.values.map((v, i) => `${left + band * (i + 0.5)},${y(v)}`).join(" ")}
                stroke={PALETTE[si % PALETTE.length]}
                strokeWidth="2.5"
              />
              {s.values.map((v, i) => (
                <circle cx={left + band * (i + 0.5)} cy={y(v)} fill={PALETTE[si % PALETTE.length]} key={`${s.name}-${i}`} r="3" />
              ))}
            </g>
          ))}
      {legend ? <Legend items={series.map((s) => s.name)} y={H - 8} width={W} /> : null}
    </svg>
  );
}

function Legend({ items, y, width }: { items: string[]; y: number; width: number }) {
  const w = Math.min(110, width / Math.max(1, items.length));
  const start = width / 2 - (w * items.length) / 2;
  return (
    <g>
      {items.map((name, i) => (
        <g key={`${name}-${i}`} transform={`translate(${start + w * i}, ${y})`}>
          <rect fill={PALETTE[i % PALETTE.length]} height="9" width="9" y="-9" />
          <text fill="#595959" fontSize="11" x="13">
            {name.length > 12 ? `${name.slice(0, 11)}…` : name}
          </text>
        </g>
      ))}
    </g>
  );
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}
