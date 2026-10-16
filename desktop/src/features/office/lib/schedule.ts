/**
 * Schedule helpers for the Triggers section — the same rules as the Office's
 * (munder-difflin: shared/weeklySchedule.ts and the triggers UI): a mission
 * runs on an interval, or on chosen weekdays at a time of day.
 */

export type Weekly = { days: number[]; minute: number };

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export const INTERVALS: { ms: number; label: string }[] = [
  { ms: 15 * MINUTE, label: "Every 15 minutes" },
  { ms: 30 * MINUTE, label: "Every 30 minutes" },
  { ms: HOUR, label: "Every hour" },
  { ms: 2 * HOUR, label: "Every 2 hours" },
  { ms: 6 * HOUR, label: "Every 6 hours" },
  { ms: 12 * HOUR, label: "Every 12 hours" },
  { ms: DAY, label: "Every day" },
  { ms: WEEK, label: "Every week" },
];

/** A valid weekly schedule, or null (no days, or an impossible time). */
export function normalizeWeekly(w: unknown): Weekly | null {
  if (!w || typeof w !== "object") return null;
  const raw = w as { days?: unknown; minute?: unknown };
  if (!Array.isArray(raw.days)) return null;
  const days = [
    ...new Set(
      raw.days.filter(
        (d): d is number =>
          typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6,
      ),
    ),
  ].sort((a, b) => a - b);
  if (days.length === 0) return null;
  const minute = raw.minute;
  if (
    typeof minute !== "number" ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 1439
  ) {
    return null;
  }
  return { days, minute };
}

export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatWeekly(w: unknown): string {
  const n = normalizeWeekly(w);
  if (!n) return "no days picked";
  const at = formatMinute(n.minute);
  const key = n.days.join(",");
  if (key === "0,1,2,3,4,5,6") return `Every day at ${at}`;
  if (key === "1,2,3,4,5") return `Weekdays at ${at}`;
  if (key === "0,6") return `Weekends at ${at}`;
  return `${n.days.map((d) => WEEKDAYS[d]).join(", ")} at ${at}`;
}

/** The first matching slot strictly after `nowMs`, or null. */
export function nextWeeklyFireMs(w: unknown, nowMs: number): number | null {
  const n = normalizeWeekly(w);
  if (!n) return null;
  const from = new Date(nowMs);
  for (let offset = 0; offset <= 7; offset++) {
    const slot = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + offset,
      Math.floor(n.minute / 60),
      n.minute % 60,
      0,
      0,
    );
    if (!n.days.includes(slot.getDay())) continue;
    if (slot.getTime() > nowMs) return slot.getTime();
  }
  return null;
}

/** A truthful label for any stored interval, preset or not. */
export function formatInterval(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "off";
  const preset = INTERVALS.find((i) => i.ms === ms);
  if (preset) return preset.label;
  if (ms % WEEK === 0) return `Every ${ms / WEEK} weeks`;
  if (ms % DAY === 0) return `Every ${ms / DAY} days`;
  if (ms % HOUR === 0) return `Every ${ms / HOUR} hours`;
  if (ms % MINUTE === 0) return `Every ${ms / MINUTE} minutes`;
  return `Every ${Math.round(ms / 1000)} seconds`;
}
