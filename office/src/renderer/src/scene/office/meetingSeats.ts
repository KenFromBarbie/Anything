/**
 * Where agents sit in a meeting: the conference table's chairs, and the open
 * floor tile each one is reached from. Pure (map queries come in as
 * functions), so the seating rules are testable without a renderer.
 */

export interface SeatTile { x: number; y: number }

export interface MeetSeat {
  tile: SeatTile;
  /** The reachable open tile an attendee walks to before taking the chair. */
  approach: SeatTile;
  face: 'up' | 'down';
}

export interface Zone { x: number; y: number; width: number; height: number }

const key = (x: number, y: number) => `${x},${y}`;

/** Open tiles reachable on foot from `start`. An open tile beside a chair can
 *  sit in a walled-off pocket, and an agent sent there never arrives. */
export function reachableFrom(start: SeatTile, isWalkable: (x: number, y: number) => boolean): Set<string> {
  const reach = new Set<string>();
  const queue: SeatTile[] = [];
  const push = (x: number, y: number) => {
    const k = key(x, y);
    if (reach.has(k) || !isWalkable(x, y)) return;
    reach.add(k);
    queue.push({ x, y });
  };
  push(start.x, start.y);
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    push(q.x + 1, q.y); push(q.x - 1, q.y); push(q.x, q.y + 1); push(q.x, q.y - 1);
  }
  return reach;
}

/** The reachable tile nearest `t` (Manhattan), within `rx` × `ry`. */
export function nearestReachable(reach: Set<string>, t: SeatTile, rx: number, ry: number): SeatTile | null {
  let best: SeatTile | null = null;
  let bestD = Infinity;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if (!reach.has(key(t.x + dx, t.y + dy))) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestD) { bestD = d; best = { x: t.x + dx, y: t.y + dy }; }
    }
  }
  return best;
}

/**
 * The boardroom's chairs, in the order they fill. The table is the widest
 * blocked rows; the chairs are the blocked tiles in the row just above it
 * (facing down) and just below it (facing up), within its width. The far
 * side fills first (facing the room, plainly seated; from the near side an
 * agent shows its back and reads as standing), each side from the middle
 * outwards. Chairs with no reachable tile beside them are left out.
 */
export function findMeetSeats(
  zone: Zone,
  isWalkable: (x: number, y: number) => boolean,
  reach: Set<string>,
): MeetSeat[] {
  const rows: Array<{ y: number; xs: number[] }> = [];
  for (let y = zone.y; y < zone.y + zone.height; y++) {
    const xs: number[] = [];
    for (let x = zone.x; x < zone.x + zone.width; x++) if (!isWalkable(x, y)) xs.push(x);
    rows.push({ y, xs });
  }
  const widest = Math.max(0, ...rows.map((r) => r.xs.length));
  const tableRows = rows.filter((r) => widest > 0 && r.xs.length === widest);
  if (!tableRows.length) return [];
  const top = tableRows[0].y;
  const bottom = tableRows[tableRows.length - 1].y;
  const minX = Math.min(...tableRows.flatMap((r) => r.xs));
  const maxX = Math.max(...tableRows.flatMap((r) => r.xs));
  const seats: MeetSeat[] = [];
  for (const r of rows) {
    if (r.y !== top - 1 && r.y !== bottom + 1) continue;
    const face: 'up' | 'down' = r.y < top ? 'down' : 'up';
    for (const x of r.xs) {
      if (x < minX || x > maxX) continue;
      const approach = nearestReachable(reach, { x, y: r.y }, 4, 3);
      if (approach) seats.push({ tile: { x, y: r.y }, approach, face });
    }
  }
  const mid = (minX + maxX) / 2;
  return seats.sort((a, b) =>
    (a.face === 'down' ? 0 : 1) - (b.face === 'down' ? 0 : 1)
    || Math.abs(a.tile.x - mid) - Math.abs(b.tile.x - mid));
}

/** Is a character at pixel `pos` in the chair at `seatPx` (the tile's
 *  top-left)? Judged by distance: a seated pose can read as the tile above. */
export function inChair(pos: { x: number; y: number }, seatPx: { x: number; y: number }, ts: number): boolean {
  return Math.abs(pos.x - (seatPx.x + ts / 2)) <= ts / 2 && Math.abs(pos.y - (seatPx.y + ts)) <= ts;
}
