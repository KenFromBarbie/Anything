import assert from "node:assert/strict";
import test from "node:test";

import {
  formatInterval,
  formatWeekly,
  nextWeeklyFireMs,
  normalizeWeekly,
} from "./schedule.ts";

test("weekly schedules normalize and read naturally", () => {
  assert.equal(normalizeWeekly({ days: [], minute: 60 }), null);
  assert.equal(normalizeWeekly({ days: [1], minute: 1440 }), null);
  assert.deepEqual(normalizeWeekly({ days: [3, 1, 1, 9], minute: 570 }), {
    days: [1, 3],
    minute: 570,
  });
  assert.equal(
    formatWeekly({ days: [1, 2, 3, 4, 5], minute: 570 }),
    "Weekdays at 09:30",
  );
  assert.equal(formatWeekly({ days: [1, 3], minute: 0 }), "Mon, Wed at 00:00");
});

test("the next weekly slot is strictly after now", () => {
  // Wednesday 2026-10-14 10:00 local.
  const now = new Date(2026, 9, 14, 10, 0).getTime();
  const sameDayLater = nextWeeklyFireMs({ days: [3], minute: 11 * 60 }, now);
  assert.equal(new Date(sameDayLater).getHours(), 11);
  const nextWeek = nextWeeklyFireMs({ days: [3], minute: 9 * 60 }, now);
  assert.equal(new Date(nextWeek).getDate(), 21);
});

test("intervals label presets and arbitrary values", () => {
  assert.equal(formatInterval(3_600_000), "Every hour");
  assert.equal(formatInterval(3 * 3_600_000), "Every 3 hours");
  assert.equal(formatInterval(0), "off");
});
