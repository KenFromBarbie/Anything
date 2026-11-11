import assert from "node:assert/strict";
import test from "node:test";

import { foldDiff, lineDiff } from "./lineDiff.ts";

const kinds = (d) => d.map((l) => `${l.kind[0]}${l.text}`).join(" ");

test("a changed line in the middle", () => {
  assert.equal(kinds(lineDiff("a\nb\nc\n", "a\nB\nc\n")), "sa rb aB sc");
  assert.equal(kinds(lineDiff("", "x\ny")), "ax ay");
  assert.equal(kinds(lineDiff("x\ny", "")), "rx ry");
  assert.equal(kinds(lineDiff("a\nb", "a\nb")), "sa sb");
});

test("insertions keep their neighbours and line numbers", () => {
  const d = lineDiff("one\ntwo\nfour", "one\ntwo\nthree\nfour");
  assert.equal(kinds(d), "sone stwo athree sfour");
  assert.equal(d.find((l) => l.kind === "add").n, 3);
});

test("folding keeps context and marks gaps", () => {
  const a = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
  const b = a.replace("l15", "CHANGED");
  const f = foldDiff(lineDiff(a, b), 2);
  assert.equal(f.filter((x) => x === null).length, 2);
  assert.equal(f.filter((x) => x && x.kind !== "same").length, 2);
  assert.equal(f.filter(Boolean).length, 6);
});

test("very large texts fall back without hanging", () => {
  const a = Array.from({ length: 4000 }, (_, i) => `a${i}`).join("\n");
  const b = Array.from({ length: 4000 }, (_, i) => `b${i}`).join("\n");
  const d = lineDiff(a, b);
  assert.equal(d.length, 8000);
});
