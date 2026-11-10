"""Self-contained HTML reports for simulation results: headline numbers,
SVG line charts, tables, images and a note on assumptions. Light and dark
themes, fluid width, no scripts or external files (images are inlined), so
it publishes as one file with buzz-show.

    from simkit.report import Report
    r = Report("Boat Bike — stability", "Hull v5, 180 kg with rider")
    r.numbers({"Draft": "0.21 m", "GM": "0.43 m", "Max roll": "11°"})
    r.chart("Righting lever", x=heel, ys={"GZ (m)": gz}, x_label="Heel (°)")
    r.table(["Speed", "Drag"], rows)
    r.image("Airflow", "tunnel.gif")
    r.note("Assumptions: …")
    r.save("stability.html")
"""

from __future__ import annotations

import base64
import html
import mimetypes

PALETTE = ["#2f6fdf", "#e0563b", "#1f9d74", "#9a5bd6", "#d39b1d", "#3aa6c4"]


class Report:
    def __init__(self, title: str, subtitle: str = ""):
        self.title = title
        self.subtitle = subtitle
        self.parts: list[str] = []

    def heading(self, text: str) -> "Report":
        self.parts.append(f"<h2>{html.escape(text)}</h2>")
        return self

    def text(self, text: str) -> "Report":
        self.parts.append(f"<p>{html.escape(text)}</p>")
        return self

    def numbers(self, values: dict) -> "Report":
        cells = "".join(
            f'<div class="num"><div class="v">{html.escape(str(v))}</div><div class="k">{html.escape(str(k))}</div></div>'
            for k, v in values.items())
        self.parts.append(f'<div class="nums">{cells}</div>')
        return self

    def chart(self, title: str, x, ys: dict, x_label: str = "", y_label: str = "",
              zero_line: bool = True) -> "Report":
        """A line chart: one line per entry of `ys` (name → values)."""
        x = [float(v) for v in x]
        series = {k: [float(v) for v in vals] for k, vals in ys.items()}
        W, H, L, R, T, B = 640, 300, 56, 16, 16, 40
        allv = [v for vals in series.values() for v in vals]
        x0, x1 = min(x), max(x)
        y0, y1 = min(allv + ([0.0] if zero_line else [])), max(allv + ([0.0] if zero_line else []))
        if y1 == y0:
            y1 = y0 + 1
        pad = (y1 - y0) * 0.06
        y0, y1 = y0 - pad, y1 + pad
        sx = lambda v: L + (v - x0) / ((x1 - x0) or 1) * (W - L - R)
        sy = lambda v: T + (1 - (v - y0) / (y1 - y0)) * (H - T - B)

        def ticks(lo, hi, n=5):
            import math
            span = hi - lo
            step = 10 ** math.floor(math.log10(span / n)) if span > 0 else 1
            for m in (1, 2, 5, 10):
                if span / (step * m) <= n:
                    step *= m
                    break
            start = math.ceil(lo / step) * step
            out = []
            v = start
            while v <= hi + 1e-9:
                out.append(round(v, 10))
                v += step
            return out

        grid = []
        for t in ticks(y0, y1):
            grid.append(f'<line x1="{L}" x2="{W - R}" y1="{sy(t):.1f}" y2="{sy(t):.1f}" class="g"/>'
                        f'<text x="{L - 6}" y="{sy(t) + 4:.1f}" text-anchor="end">{t:g}</text>')
        for t in ticks(x0, x1, 8):
            grid.append(f'<text x="{sx(t):.1f}" y="{H - B + 16}" text-anchor="middle">{t:g}</text>')
        if zero_line and y0 < 0 < y1:
            grid.append(f'<line x1="{L}" x2="{W - R}" y1="{sy(0):.1f}" y2="{sy(0):.1f}" class="z"/>')
        lines, legend = [], []
        for i, (name, vals) in enumerate(series.items()):
            c = PALETTE[i % len(PALETTE)]
            pts = " ".join(f"{sx(a):.1f},{sy(b):.1f}" for a, b in zip(x, vals))
            lines.append(f'<polyline points="{pts}" fill="none" stroke="{c}" stroke-width="2"/>')
            legend.append(f'<span><i style="background:{c}"></i>{html.escape(name)}</span>')
        svg = (f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{html.escape(title)}">{"".join(grid)}{"".join(lines)}'
               f'<text x="{(L + W - R) / 2}" y="{H - 6}" text-anchor="middle" class="ax">{html.escape(x_label)}</text>'
               f'<text x="14" y="{(T + H - B) / 2}" text-anchor="middle" class="ax" transform="rotate(-90 14 {(T + H - B) / 2})">{html.escape(y_label)}</text></svg>')
        self.parts.append(f'<figure><figcaption>{html.escape(title)}</figcaption>{svg}'
                          f'<div class="legend">{"".join(legend) if len(series) > 1 else ""}</div></figure>')
        return self

    def table(self, header: list, rows: list) -> "Report":
        head = "".join(f"<th>{html.escape(str(h))}</th>" for h in header)
        body = "".join("<tr>" + "".join(f"<td>{html.escape(_fmt(c))}</td>" for c in row) + "</tr>" for row in rows)
        self.parts.append(f'<div class="tw"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
        return self

    def image(self, caption: str, path: str) -> "Report":
        mime = mimetypes.guess_type(path)[0] or "image/png"
        with open(path, "rb") as fh:
            data = base64.b64encode(fh.read()).decode("ascii")
        self.parts.append(f'<figure><figcaption>{html.escape(caption)}</figcaption>'
                          f'<img src="data:{mime};base64,{data}" alt="{html.escape(caption)}"/></figure>')
        return self

    def note(self, text: str) -> "Report":
        self.parts.append(f'<aside>{html.escape(text)}</aside>')
        return self

    def save(self, path: str) -> str:
        page = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(self.title)}</title><style>
:root{{--bg:#ffffff;--fg:#1d2330;--mute:#667085;--line:#e4e7ec;--card:#f6f7f9}}
@media (prefers-color-scheme:dark){{:root{{--bg:#16181d;--fg:#e8eaee;--mute:#98a2b3;--line:#2b2f38;--card:#1e2128}}}}
*{{box-sizing:border-box}}body{{margin:0;background:transparent;color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:20px}}
h1{{font-size:22px;margin:0}}.sub{{color:var(--mute);margin:2px 0 16px}}h2{{font-size:16px;margin:24px 0 8px}}
.nums{{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:12px 0}}
.num{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}}.num .v{{font-size:20px;font-weight:600}}.num .k{{color:var(--mute);font-size:12px}}
figure{{margin:16px 0}}figcaption{{font-weight:600;margin-bottom:6px}}svg{{width:100%;height:auto;display:block}}
svg text{{fill:var(--mute);font-size:11px}}svg .ax{{font-size:12px}}svg .g{{stroke:var(--line)}}svg .z{{stroke:var(--mute);stroke-dasharray:3 3}}
.legend{{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--mute)}}.legend i{{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}}
img{{max-width:100%;border-radius:8px;border:1px solid var(--line)}}
.tw{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;font-size:13px}}th,td{{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right}}th:first-child,td:first-child{{text-align:left}}
aside{{background:var(--card);border-left:3px solid var(--mute);padding:10px 12px;border-radius:6px;color:var(--mute);font-size:13px;margin:16px 0}}
</style></head><body><h1>{html.escape(self.title)}</h1><div class="sub">{html.escape(self.subtitle)}</div>
{"".join(self.parts)}
<script>
addEventListener("message",e=>{{const t=e.data;if(t&&t.type==="buzz-theme"){{const s=document.documentElement.style;
if(t.foreground)s.setProperty("--fg",t.foreground);if(t.muted)s.setProperty("--mute",t.muted);if(t.border)s.setProperty("--line",t.border);
if(t.font)document.body.style.fontFamily=t.font;if(t.accent){{s.setProperty("--accent",t.accent);document.querySelectorAll("polyline")[0]?.setAttribute("stroke",t.accent)}}}}}});
new ResizeObserver(()=>parent.postMessage({{anythingHeight:document.documentElement.scrollHeight}},"*")).observe(document.documentElement)
</script>
</body></html>"""
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(page)
        return path


def _fmt(v) -> str:
    if isinstance(v, float):
        return f"{v:.3g}" if abs(v) < 1000 else f"{v:,.0f}"
    return str(v)
