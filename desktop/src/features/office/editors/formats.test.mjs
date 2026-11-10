import assert from "node:assert/strict";
import test from "node:test";

import {
  chartData,
  editorKindOf,
  evaluate,
  fileName,
  parseFile,
  rangeRefs,
  sheetToCsv,
  slidesToHtml,
} from "./formats.ts";

test("sheet formulas: arithmetic, refs, ranges, functions, errors", () => {
  const get = evaluate({
    A1: "Month", B1: "Sales",
    A2: "Jan", B2: "100",
    A3: "Feb", B3: "150",
    A4: "Mar", B4: "1,250",
    B5: "=SUM(B2:B4)",
    B6: "=AVERAGE(B2:B4)",
    B7: "=B5*2+(B2-50)/5^2",
    B8: "=MAX(B2:B4)-MIN(B2:B4)",
    B9: '=IF(B5>1000,"big","small")',
    C1: "=C2", C2: "=C1",
    C3: "=1/0",
    C4: "=NOPE(1)",
    C5: "=ROUND(2/3,2)",
    C6: '="Total: "&B5',
    C7: "=COUNT(A1:B4)",
    C8: "=-B2+",
  });
  assert.equal(get("B5"), 1500);
  assert.equal(get("B6"), 500);
  assert.equal(get("B7"), 3002);
  assert.equal(get("B8"), 1150);
  assert.equal(get("B9"), "big");
  assert.equal(get("C1"), "#CYCLE!");
  assert.equal(get("C3"), "#DIV/0!");
  assert.equal(get("C4"), "#NAME?");
  assert.equal(get("C5"), 0.67);
  assert.equal(get("C6"), "Total: 1500");
  assert.equal(get("C7"), 3);
  assert.equal(get("C8"), "#ERROR!");
  assert.equal(get("A2"), "Jan");
  assert.equal(get("Z99"), "");
});

test("charts read labels from the first column and series names from the header", () => {
  const get = evaluate({ A1: "Month", B1: "Sales", C1: "Costs", A2: "Jan", B2: "10", C2: "4", A3: "Feb", B3: "20", C3: "5" });
  const d = chartData("A1:C3", get);
  assert.deepEqual(d.labels, ["Jan", "Feb"]);
  assert.deepEqual(d.series, [{ name: "Sales", values: [10, 20] }, { name: "Costs", values: [4, 5] }]);
  assert.equal(rangeRefs("B2:A1").flat().join(","), "A1,B1,A2,B2");
});

test("files: names, kinds, parsing what agents write, exports", () => {
  assert.equal(fileName("Q3 brief: draft!", "doc"), "Q3 brief draft.doc.json");
  assert.equal(editorKindOf("C:/x/Deck.slides.json"), "slides");
  assert.equal(editorKindOf("C:/x/data.json"), null);
  const deck = parseFile("slides", { slides: [{ title: "Hi", layout: "weird" }], theme: "nope" });
  assert.equal(deck.theme, "office");
  assert.equal(deck.slides[0].layout, "content");
  const sheet = parseFile("sheet", { cells: { A1: "x", bad: "y", B2: "" }, charts: [{ range: "A1:B2", type: "donut" }] });
  assert.deepEqual(sheet.cells, { A1: "x" });
  assert.equal(sheet.charts[0].type, "bar");
  assert.equal(sheetToCsv({ ...sheet, cells: { A1: "a,b", B1: "=1+1" } }), '"a,b",2');
  assert.match(slidesToHtml("T", deck), /<section><h2>Hi<\/h2>/);
});
