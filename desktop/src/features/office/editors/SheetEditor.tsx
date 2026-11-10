import * as React from "react";
import {
  BarChart3,
  Bold,
  Eraser,
  LineChart,
  PieChart,
  Sigma,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";

import { ChartView } from "./ChartView";
import { closeEditor, exportFile, saveToCreate } from "./editorStore";
import {
  type ChartType,
  colName,
  evaluate,
  formatValue,
  refOf,
  type SheetFile,
  sheetToCsv,
  usedBounds,
} from "./formats";
import { OfficeShell, RibbonButton, RibbonGroup } from "./OfficeShell";
import { editorRequest } from "./requests";

type Pos = { col: number; row: number };

export function SheetEditor({
  title: initialTitle,
  file,
  series: initialSeries,
  path,
  artifactId,
}: {
  title: string;
  file: SheetFile;
  series?: string;
  path?: string;
  artifactId?: string;
}) {
  const [title, setTitle] = React.useState(initialTitle);
  const [sheet, setSheet] = React.useState<SheetFile>(file);
  const [series, setSeries] = React.useState(initialSeries);
  const [saved, setSaved] = React.useState<{ id: string; path?: string } | null>(artifactId ? { id: artifactId, path } : null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [sel, setSel] = React.useState<Pos>({ col: 0, row: 0 });
  const [anchor, setAnchor] = React.useState<Pos>({ col: 0, row: 0 });
  const [editing, setEditing] = React.useState<string | null>(null);
  const dragging = React.useRef(false);
  const grid = React.useRef<HTMLDivElement>(null);

  const bounds = usedBounds(sheet.cells);
  const cols = Math.max(26, bounds.cols + 3);
  const rows = Math.max(60, bounds.rows + 10);
  const get = React.useMemo(() => evaluate(sheet.cells), [sheet.cells]);
  const bold = React.useMemo(() => new Set(sheet.bold ?? []), [sheet.bold]);

  const range = {
    c0: Math.min(sel.col, anchor.col),
    c1: Math.max(sel.col, anchor.col),
    r0: Math.min(sel.row, anchor.row),
    r1: Math.max(sel.row, anchor.row),
  };
  const rangeText = `${refOf(range.c0, range.r0)}:${refOf(range.c1, range.r1)}`;
  const inRange = (c: number, r: number) => c >= range.c0 && c <= range.c1 && r >= range.r0 && r <= range.r1;
  const selRef = refOf(sel.col, sel.row);

  const change = (next: SheetFile) => {
    setSheet(next);
    setDirty(true);
  };
  const setCell = (ref: string, value: string) => {
    const cells = { ...sheet.cells };
    if (value === "") delete cells[ref];
    else cells[ref] = value;
    change({ ...sheet, cells });
  };
  const eachSelected = (fn: (ref: string) => void) => {
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) fn(refOf(c, r));
  };

  const go = (col: number, row: number, extend = false) => {
    const p = { col: Math.max(0, Math.min(cols - 1, col)), row: Math.max(0, Math.min(rows - 1, row)) };
    setSel(p);
    if (!extend) setAnchor(p);
  };
  const commit = (move?: Pos) => {
    if (editing !== null) setCell(selRef, editing.trim());
    setEditing(null);
    if (move) go(move.col, move.row);
    grid.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (editing !== null) return;
    const { col, row } = sel;
    const k = e.key;
    if (k === "ArrowUp") go(col, row - 1, e.shiftKey);
    else if (k === "ArrowDown" || k === "Enter") go(col, row + 1, e.shiftKey && k !== "Enter");
    else if (k === "ArrowLeft") go(col - 1, row, e.shiftKey);
    else if (k === "ArrowRight" || k === "Tab") go(col + 1, row, e.shiftKey && k !== "Tab");
    else if (k === "Delete" || k === "Backspace") {
      const cells = { ...sheet.cells };
      eachSelected((ref) => delete cells[ref]);
      change({ ...sheet, cells });
    } else if (k === "F2") setEditing(sheet.cells[selRef] ?? "");
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "b") toggleBold();
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setEditing(k);
    } else return;
    e.preventDefault();
  };

  const toggleBold = () => {
    const next = new Set(bold);
    const all = (() => {
      let on = true;
      eachSelected((ref) => {
        if (!next.has(ref)) on = false;
      });
      return on;
    })();
    eachSelected((ref) => (all ? next.delete(ref) : next.add(ref)));
    change({ ...sheet, bold: [...next] });
  };

  const autoSum = () => {
    // Sum the numbers above the selected cell, Excel-style.
    let r = sel.row - 1;
    while (r >= 0 && typeof get(refOf(sel.col, r)) === "number") r--;
    const first = r + 1;
    if (first >= sel.row) {
      toast("Put the total under a column of numbers.");
      return;
    }
    setCell(selRef, `=SUM(${refOf(sel.col, first)}:${refOf(sel.col, sel.row - 1)})`);
  };

  const addChart = (type: ChartType) => {
    if (range.c0 === range.c1 && range.r0 === range.r1) {
      toast("Select the data first: labels in the first column, numbers next to them.");
      return;
    }
    change({ ...sheet, charts: [...sheet.charts, { type, range: rangeText, title: "Chart title" }] });
  };

  const save = async (): Promise<{ id: string; path?: string } | null> => {
    if (saving) return null;
    setSaving(true);
    try {
      const out = await saveToCreate("sheet", title, sheet, series);
      setSeries(out.series);
      const next = { id: out.id, path: out.path };
      setSaved(next);
      setDirty(false);
      toast(`Saved "${title.trim() || "Untitled"}" to Create.`);
      return next;
    } catch (e) {
      toast.error(String(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Status bar: Excel's sum / average / count of the selection.
  const stats = (() => {
    const nums: number[] = [];
    let count = 0;
    eachSelected((ref) => {
      const v = get(ref);
      if (v === "") return;
      count++;
      if (typeof v === "number") nums.push(v);
    });
    return { count, nums };
  })();

  const home = (
    <>
      <RibbonGroup label="Font">
        <RibbonButton active={bold.has(selRef)} big icon={Bold} label="Bold" onClick={toggleBold} />
      </RibbonGroup>
      <RibbonGroup label="Editing">
        <RibbonButton big icon={Sigma} label="AutoSum" onClick={autoSum} />
        <RibbonButton
          big
          icon={Eraser}
          label="Clear"
          onClick={() => {
            const cells = { ...sheet.cells };
            eachSelected((ref) => delete cells[ref]);
            change({ ...sheet, cells });
          }}
        />
      </RibbonGroup>
    </>
  );
  const insert = (
    <RibbonGroup label="Charts">
      <RibbonButton big icon={BarChart3} label="Column" onClick={() => addChart("bar")} />
      <RibbonButton big icon={LineChart} label="Line" onClick={() => addChart("line")} />
      <RibbonButton big icon={PieChart} label="Pie" onClick={() => addChart("pie")} />
    </RibbonGroup>
  );

  const raw = sheet.cells[selRef] ?? "";
  return (
    <OfficeShell
      ask={{
        placeholder: Object.keys(sheet.cells).length ? "Add a column with the margin per month…" : "A monthly budget for a small café, with totals and a chart…",
        build: async (text) => {
          if (!Object.keys(sheet.cells).length) return editorRequest("sheet", title, text, null);
          const current = dirty || !saved ? await save() : saved;
          return current ? editorRequest("sheet", title, text, current) : null;
        },
      }}
      dirty={dirty}
      isNew={!saved}
      exports={[
        { label: "Export for Excel (.csv)", run: () => void exportFile(`${title || "Untitled"}.csv`, sheetToCsv(sheet), "csv", "CSV (Excel)").catch((e) => toast.error(String(e))) },
      ]}
      kind="sheet"
      onClose={closeEditor}
      onSave={() => void save()}
      onTitle={(t) => {
        setTitle(t);
        setDirty(true);
      }}
      saving={saving}
      status={
        <>
          <span>Ready</span>
          {stats.nums.length > 1 ? (
            <span className="ml-auto flex gap-4">
              <span>Average: {formatValue(stats.nums.reduce((a, b) => a + b, 0) / stats.nums.length)}</span>
              <span>Count: {stats.count}</span>
              <span>Sum: {formatValue(stats.nums.reduce((a, b) => a + b, 0))}</span>
            </span>
          ) : null}
        </>
      }
      tabs={[
        { id: "home", label: "Home", content: home },
        { id: "insert", label: "Insert", content: insert },
      ]}
      title={title}
    >
      <div className="flex h-full min-h-0 flex-col bg-white dark:bg-[#1f1f1f]">
        {/* formula bar */}
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-black/10 px-2 text-sm dark:border-white/10">
          <span className="w-20 rounded border border-black/15 px-1.5 py-0.5 text-center text-xs dark:border-white/15">
            {range.c0 === range.c1 && range.r0 === range.r1 ? selRef : rangeText}
          </span>
          <span className="italic text-[#616161]">fx</span>
          <input
            aria-label="Formula bar"
            className="h-6 flex-1 rounded border border-black/15 px-2 text-sm outline-none focus:border-[#107C41] dark:border-white/15 dark:bg-[#262626]"
            onChange={(e) => setEditing(e.target.value)}
            onFocus={() => setEditing(raw)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit({ col: sel.col, row: sel.row + 1 });
              if (e.key === "Escape") {
                setEditing(null);
                grid.current?.focus();
              }
            }}
            value={editing ?? raw}
          />
        </div>
        <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          <div
            className="relative w-max outline-none"
            onKeyDown={onKey}
            onMouseUp={() => (dragging.current = false)}
            ref={grid}
            tabIndex={0}
          >
            <table className="border-collapse text-[13px] [font-family:Calibri,Aptos,'Segoe_UI',sans-serif]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 h-6 w-10 border border-[#d4d4d4] bg-[#f3f3f3] dark:border-[#3a3a3a] dark:bg-[#2b2b2b]" />
                  {Array.from({ length: cols }, (_, c) => (
                    <th
                      className={cn(
                        "sticky top-0 z-10 h-6 w-24 min-w-24 border border-[#d4d4d4] bg-[#f3f3f3] text-xs font-normal text-[#424242] dark:border-[#3a3a3a] dark:bg-[#2b2b2b] dark:text-[#cfcfcf]",
                        c >= range.c0 && c <= range.c1 && "bg-[#d3f0e0] font-semibold text-[#107C41] dark:bg-[#1e3a2b]",
                      )}
                      key={c}
                    >
                      {colName(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }, (_, r) => (
                  <tr key={r}>
                    <th
                      className={cn(
                        "sticky left-0 z-10 h-6 w-10 border border-[#d4d4d4] bg-[#f3f3f3] text-xs font-normal text-[#424242] dark:border-[#3a3a3a] dark:bg-[#2b2b2b] dark:text-[#cfcfcf]",
                        r >= range.r0 && r <= range.r1 && "bg-[#d3f0e0] font-semibold text-[#107C41] dark:bg-[#1e3a2b]",
                      )}
                    >
                      {r + 1}
                    </th>
                    {Array.from({ length: cols }, (_, c) => {
                      const ref = refOf(c, r);
                      const isSel = c === sel.col && r === sel.row;
                      const v = get(ref);
                      const shown = sheet.cells[ref] === undefined ? "" : formatValue(v);
                      return (
                        <td
                          className={cn(
                            "h-6 w-24 min-w-24 max-w-24 truncate border border-[#e1e1e1] px-1 dark:border-[#333]",
                            typeof v === "number" ? "text-right" : "text-left",
                            typeof v === "string" && v.startsWith("#") && "text-[#C00000]",
                            bold.has(ref) && "font-bold",
                            inRange(c, r) && !isSel && "bg-[#e6f4ec] dark:bg-[#1e3a2b]",
                            isSel && "relative outline outline-2 -outline-offset-1 outline-[#107C41]",
                          )}
                          key={ref}
                          onDoubleClick={() => setEditing(sheet.cells[ref] ?? "")}
                          onMouseDown={(e) => {
                            if (editing !== null) commit();
                            dragging.current = true;
                            go(c, r, e.shiftKey);
                          }}
                          onMouseEnter={() => {
                            if (dragging.current) setSel({ col: c, row: r });
                          }}
                        >
                          {isSel && editing !== null ? (
                            <input
                              autoFocus
                              className="absolute inset-0 z-10 w-full border-2 border-[#107C41] bg-white px-1 outline-none dark:bg-[#1f1f1f]"
                              onBlur={() => commit()}
                              onChange={(e) => setEditing(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commit({ col: c, row: r + 1 });
                                } else if (e.key === "Tab") {
                                  e.preventDefault();
                                  commit({ col: c + 1, row: r });
                                } else if (e.key === "Escape") {
                                  setEditing(null);
                                  grid.current?.focus();
                                }
                              }}
                              value={editing}
                            />
                          ) : (
                            shown
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
          {sheet.charts.length ? (
            <div className="flex w-[512px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-black/10 bg-[#f3f3f3] p-4 dark:border-white/10 dark:bg-[#1a1a1a]">
              {sheet.charts.map((chart, i) => (
                <div className="w-[480px] rounded border border-black/10 bg-white p-2 shadow-sm dark:border-white/10" key={`${chart.range}-${i}`}>
                  <div className="mb-1 flex items-center gap-1.5">
                    <input
                      aria-label="Chart title"
                      className="h-7 flex-1 rounded px-1.5 text-sm outline-none hover:bg-black/5 focus:bg-black/5 dark:text-[#242424]"
                      onChange={(e) => change({ ...sheet, charts: sheet.charts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                      value={chart.title}
                    />
                    <select
                      aria-label="Chart type"
                      className="h-7 rounded border border-black/15 px-1 text-xs dark:text-[#242424]"
                      onChange={(e) => change({ ...sheet, charts: sheet.charts.map((x, j) => (j === i ? { ...x, type: e.target.value as ChartType } : x)) })}
                      value={chart.type}
                    >
                      <option value="bar">Column</option>
                      <option value="line">Line</option>
                      <option value="pie">Pie</option>
                    </select>
                    <span className="text-xs text-[#616161]">{chart.range}</span>
                    <button
                      aria-label="Delete chart"
                      className="rounded p-1 text-[#616161] hover:bg-black/5"
                      onClick={() => change({ ...sheet, charts: sheet.charts.filter((_, j) => j !== i) })}
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <ChartView chart={chart} get={get} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </OfficeShell>
  );
}
