import assert from "node:assert/strict";
import test from "node:test";

import { baseTitle, groupVersions } from "./artifactVersions.ts";

const at = (id, title, createdAt, kind = "model", extra = {}) => ({
  id,
  title,
  kind,
  createdAt,
  ...extra,
});

test("version marks don't make a new thing", () => {
  assert.equal(
    baseTitle("Solar water distillation: website (v2, sourced)"),
    "solar water distillation: website",
  );
  assert.equal(baseTitle("Funnel deck v3"), "funnel deck");
  assert.equal(baseTitle("Cat (edited)"), "cat");
  assert.equal(baseTitle("Lab diagram (dark)"), "lab diagram (dark)");
});

test("every iteration of one thing is one card, showing the latest", () => {
  const groups = groupVersions([
    at("a", "Trike (3D model)", 1),
    at("b", "Trike (3D model)", 2),
    at("c", "Trike (3D model)", 3),
    at("d", "Gaming PC (3D model)", 4),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].latest.id, "d");
  assert.equal(groups[1].latest.id, "c");
  assert.deepEqual(
    groups[1].versions.map((v) => v.id),
    ["a", "b", "c"],
  );
});

test("a site and a model with the same title stay apart", () => {
  const groups = groupVersions([
    at("a", "Trike", 1, "model"),
    at("b", "Trike", 2, "html"),
  ]);
  assert.equal(groups.length, 2);
});

test("the Office's series joins versions whose title changed", () => {
  const groups = groupVersions([
    at("a", "Pricing page", 1, "html"),
    at("b", "Pricing page, darker", 2, "html", { series: "a" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].latest.id, "b");
});
