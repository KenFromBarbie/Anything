// The office floor, built to the size of the team.
//
// The hand-drawn map (office.tmj) is cut into modules and put back together:
//
//   ┌ CEO office ┬ boardroom ┬ [staff room] ┬ [nook …] ┬ staff office ┐  rows 0–10
//   │                                                   │              │
//   ├ desk pod ┬ desk pod ┬ … ┬ [lounge / library / utility] ┬ café   ┤  rows 11–21
//
// Desk pods (4 tiles wide, 2 desks) are added as the team grows. Amenity
// strips fill the floor beside them, and they get plainer as the team grows:
// a small team has a lounge with sofas and a fireplace and a library; a large
// one gets printers, cabinets and water coolers, or nothing extra at all.
// The top row is as wide as the bottom: any width beyond the fixed rooms is a
// nook, furnished to the same standard.
//
// No Pixi here: the result is plain Tiled JSON plus the theme coordinates
// that move with it, so it can be built and checked outside the app
// (test/modular-office.test.cjs).

/** A map tile coordinate. */
export interface Tile { x: number; y: number; }

/** Who works on the floor. */
export interface Headcount {
  /** Agents besides Michael (staff included). */
  workers: number;
  /** Permanent staff among them (they sit in the private offices). */
  staff: number;
}

/** How well appointed the office is: plusher the smaller the team. */
export type Comfort = 'luxury' | 'comfort' | 'standard' | 'lean';

type Layer = number[];
interface TileLayerJson { name: string; type: 'tilelayer'; data: Layer; width: number; height: number; [k: string]: unknown }
interface ObjectJson { id: number; name: string; type: string; x: number; y: number; width: number; height: number; rotation: number; visible: boolean; point?: boolean }
interface ObjectLayerJson { name: string; type: 'objectgroup'; objects: ObjectJson[]; [k: string]: unknown }
type LayerJson = TileLayerJson | ObjectLayerJson;
interface MapJson { width: number; height: number; tilewidth: number; layers: LayerJson[]; [k: string]: unknown }

/** An idle errand at a placed prop (see ErrandSpot in themeRegistry). */
export interface ExtraErrand {
  kind: 'water' | 'dispenser' | 'bin';
  stand: Tile;
  facing: 'up' | 'down' | 'left' | 'right';
  fx: Tile;
}

export interface ModularOffice {
  /** The generated map (Tiled JSON). */
  map: MapJson;
  comfort: Comfort;
  /** Desk pods on the open floor. */
  deskPods: number;
  /** Whether the second staff room (two more private desks) is built. */
  staffRoom: boolean;
  /** Seat order for everyone: Michael, then the open-floor desks. */
  primarySeatNames: string[];
  /** Private-office desks, in claim order. */
  staffSeatNames: string[];
  /** Where a coordinate of the hand-drawn map is in this one, or null when
   *  that part of the map isn't built. */
  place(t: Tile): Tile | null;
  /** Errands at the props placed here. */
  errands: ExtraErrand[];
  /** A key that changes only when the layout does. */
  key: string;
}

const LAYERS = ['floor', 'walls', 'furniture-below', 'furniture-above', 'collision'] as const;
type LayerName = (typeof LAYERS)[number];

// Regions of the hand-drawn map (tile coordinates, inclusive).
const TOP_ROWS = 11;          // rows 0–10: rooms and the partition below them
const LEFT_W = 19;            // x 0–18: CEO office + boardroom
const STAFF_ROOM = { x: 19, w: 6 };   // x 19–24: staff room (2 desks)
// x 25–33 on top (staff office) and x 24–33 below (café): the café's wall
// sits a column left of the staff office's.
const WING_TOP = { x: 25, w: 9 };
const WING = { x: 24, w: 10 };
const POD_W = 4;
const ROW_A = 13;             // desk spawn rows of a pod
const ROW_B = 18;
const DOOR_SRC_X = 16;        // the entrance gap in the bottom wall
const H = 22;

// Furniture: [tileset gid of the top-left tile, width, height]. Office
// tileset at gid 1, interiors at 1025, 16 tiles a row.
const O = (r: number, c: number) => 1 + r * 16 + c;
const I = (r: number, c: number) => 1025 + r * 16 + c;
interface Piece { gid: number; w: number; h: number; walk?: boolean; rug?: boolean }
const P = {
  armchair: { gid: O(16, 0), w: 1, h: 1 },
  armchairSide: { gid: O(16, 2), w: 1, h: 1 },
  cooler: { gid: O(17, 9), w: 1, h: 2 },
  vending: { gid: O(17, 14), w: 2, h: 2 },
  cabWood: { gid: O(18, 1), w: 1, h: 2 },
  cabGrey: { gid: O(18, 2), w: 1, h: 2 },
  lowCab: { gid: O(19, 4), w: 2, h: 1 },
  lowCabGrey: { gid: O(19, 6), w: 2, h: 1 },
  picture: { gid: O(25, 0), w: 2, h: 1, walk: true },
  picture2: { gid: O(25, 2), w: 2, h: 1, walk: true },
  whiteboard: { gid: O(27, 2), w: 2, h: 1, walk: true },
  plant: { gid: O(28, 2), w: 1, h: 2 },
  plantWhite: { gid: O(28, 3), w: 1, h: 2 },
  bush: { gid: O(28, 4), w: 1, h: 1 },
  printer: { gid: O(27, 11), w: 2, h: 1 },
  boxes: { gid: O(28, 8), w: 2, h: 2 },
  shelfWood: { gid: O(9, 8), w: 2, h: 2 },
  shelfBooks: { gid: O(9, 13), w: 2, h: 2 },
  coffee: { gid: O(20, 8), w: 1, h: 1 },
  sofa: { gid: I(72, 1), w: 3, h: 2 },
  sofaWhite: { gid: I(72, 4), w: 3, h: 2 },
  fireplace: { gid: I(67, 4), w: 2, h: 3 },
  books: { gid: I(68, 10), w: 2, h: 2 },
  books2: { gid: I(71, 10), w: 2, h: 2 },
  palm: { gid: I(44, 13), w: 2, h: 2 },
  lamp: { gid: I(55, 11), w: 1, h: 2 },
  lampBlue: { gid: I(54, 12), w: 1, h: 2 },
  globe: { gid: I(66, 12), w: 1, h: 2 },
  rugBlue: { gid: I(11, 13), w: 3, h: 4, rug: true },
  rugRed: { gid: I(15, 7), w: 4, h: 3, rug: true },
  rugSmall: { gid: I(15, 11), w: 2, h: 2, rug: true },
} satisfies Record<string, Piece>;

/** How plush the office is for a team this size (Michael included). */
export function comfortFor(people: number): Comfort {
  if (people <= 4) return 'luxury';
  if (people <= 9) return 'comfort';
  if (people <= 15) return 'standard';
  return 'lean';
}

type StripKind = 'pod' | 'lounge' | 'library' | 'utility';

/** Lay out the bottom strips and whether the staff room is built. */
export function planOffice(h: Headcount): { comfort: Comfort; strips: StripKind[]; staffRoom: boolean; pad: number } {
  const workers = Math.max(0, Math.floor(h.workers));
  const staff = Math.min(Math.max(0, Math.floor(h.staff)), workers);
  const comfort = comfortFor(workers + 1);
  const staffRoom = staff > 2;
  const privateDesks = staffRoom ? 4 : 2;
  // Everyone without a private desk sits on the open floor, plus one spare.
  const floorPeople = workers - Math.min(staff, privateDesks);
  const pods = Math.max(1, Math.ceil((floorPeople + 1) / 2));
  const extras: StripKind[] =
    comfort === 'luxury' ? ['lounge', 'library'] :
    comfort === 'comfort' ? ['lounge'] :
    comfort === 'standard' ? ['utility'] : [];
  const strips: StripKind[] = [...Array<StripKind>(pods).fill('pod'), ...extras];
  // The top row needs the CEO office and boardroom (and the staff room).
  const minWidth = LEFT_W + (staffRoom ? STAFF_ROOM.w : 0) + WING_TOP.w - WING.w + 1;
  // Filler for the rest of the width: alternating lounges and libraries for
  // a small team, office storage for a larger one.
  const plush = comfort === 'luxury' || comfort === 'comfort';
  for (let i = 0; strips.length * POD_W < minWidth; i++) {
    strips.push(plush ? (i % 2 ? 'lounge' : 'library') : 'utility');
  }
  const pad = strips.length * POD_W + WING.w - WING_TOP.w - LEFT_W - (staffRoom ? STAFF_ROOM.w : 0);
  return { comfort, strips, staffRoom, pad };
}

/** Changes only when the layout for this headcount does (rebuild the floor
 *  then, not on every hire). */
export function officeLayoutKey(h: Headcount): string {
  const plan = planOffice(h);
  return `${plan.comfort}:${plan.strips.join(',')}:${plan.staffRoom ? 's' : ''}`;
}

/** Build the office for this headcount from the hand-drawn map. */
export function buildModularOffice(source: MapJson, headcount: Headcount): ModularOffice {
  const plan = planOffice(headcount);
  const bottomW = plan.strips.length * POD_W;
  const W = bottomW + WING.w;
  const dx = W - (WING.x + WING.w); // how far the wing moves

  const src = new Map<string, Layer>();
  for (const l of source.layers) if (l.type === 'tilelayer') src.set(l.name, l.data);
  const SW = source.width;
  const get = (name: LayerName, x: number, y: number) => src.get(name)?.[y * SW + x] ?? 0;

  const out = new Map<LayerName, Layer>(LAYERS.map((n) => [n, new Array(W * H).fill(0)]));
  const set = (name: LayerName, x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    out.get(name)![y * W + x] = v;
  };

  /** Copy a block of the hand-drawn map; `only` limits which layers. */
  const copy = (sx: number, sy: number, w: number, h: number, tx: number, ty: number, only?: LayerName[]) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (const n of only ?? LAYERS) set(n, tx + x, ty + y, get(n, sx + x, sy + y));
      }
    }
  };

  /** Place a piece with its top-left at (x, y). The bottom row is drawn
   *  under people and blocks the way; rows above it are drawn over them. */
  const put = (p: Piece, x: number, y: number) => {
    for (let r = 0; r < p.h; r++) {
      for (let c = 0; c < p.w; c++) {
        const gid = p.gid + r * 16 + c;
        if (p.rug) { set('walls', x + c, y + r, gid); continue; }
        const bottom = r === p.h - 1;
        set(bottom ? 'furniture-below' : 'furniture-above', x + c, y + r, gid);
        if (bottom && !p.walk) set('collision', x + c, y + r, 1);
      }
    }
  };

  const spawns: ObjectJson[] = [];
  const spawn = (name: string, t: Tile) =>
    spawns.push({ id: 0, name, type: '', x: t.x * 16, y: t.y * 16, width: 0, height: 0, rotation: 0, visible: true, point: true });
  const errands: ExtraErrand[] = [];

  // ── top row ─────────────────────────────────────────────────────────────
  copy(0, 0, LEFT_W, TOP_ROWS, 0, 0);
  let x = LEFT_W;
  if (plan.staffRoom) {
    copy(STAFF_ROOM.x, 0, STAFF_ROOM.w, TOP_ROWS, x, 0);
    x += STAFF_ROOM.w;
  }
  const padX = x;
  for (let i = 0; i < plan.pad; i++) {
    // Source columns of the same parity keep the floor's two-tile pattern.
    const px = padX + i;
    const even = px % 2 === 0;
    // Back wall (rows 0–2) and bare floor (3–7) from the staff room's
    // middle; its desks' tiles and collision are left behind.
    copy(even ? 20 : 21, 0, 1, 3, px, 0);
    copy(even ? 20 : 21, 3, 1, 5, px, 3, ['floor']);
    // The partition (rows 8–10), with a doorway in the middle of a wide nook.
    const door = plan.pad >= 3 && i === Math.floor(plan.pad / 2);
    copy(door ? (even ? 20 : 13) : (even ? 10 : 11), 8, 1, 3, px, 8, ['floor', 'walls', 'collision']);
  }
  furnishNook(padX, plan.pad, plan.comfort, put, errands);

  // ── wing: staff office over the café ─────────────────────────────────────
  copy(WING_TOP.x, 0, WING_TOP.w, TOP_ROWS, WING_TOP.x + dx, 0);
  copy(WING.x, TOP_ROWS, WING.w, H - TOP_ROWS, WING.x + dx, TOP_ROWS);

  // ── bottom row: pods and amenity strips ──────────────────────────────────
  const seats: string[] = [];
  let pod = 0;
  // The entrance: a gap in the bottom wall on a strip's walkway column
  // (column 0, never furnished), towards the middle, right of a desk pod so
  // the bin by the door has room.
  const pods = plan.strips.filter((k) => k === 'pod').length;
  const doorStrip = Math.max(1, Math.min(Math.floor(plan.strips.length / 2), pods));
  plan.strips.forEach((kind, i) => {
    const sx = i * POD_W;
    // The first strip carries the outer wall; the rest are open floor.
    const from = i === 0 ? 0 : 4;
    if (kind === 'pod') {
      copy(from, TOP_ROWS, POD_W, H - TOP_ROWS, sx, TOP_ROWS);
      pod++;
      // Against the bottom wall behind the back desk (the corner plant of the
      // first pod stays): plants for a small team, storage for a large one.
      if (i !== 0 && i !== doorStrip - 1) {
        if (plan.comfort === 'luxury' || plan.comfort === 'comfort') put(pod % 2 ? P.bush : P.plantWhite, sx + 3, pod % 2 ? 20 : 19);
        else put(pod % 2 ? P.lowCabGrey : P.lowCab, sx + 2, 20);
      }
      const a = `pc-${2 * pod - 1}`;
      const b = `pc-${2 * pod}`;
      spawn(a, { x: sx + 2, y: ROW_A });
      spawn(b, { x: sx + 2, y: ROW_B });
      seats.push(a, b);
    } else {
      copy(from, TOP_ROWS, POD_W, H - TOP_ROWS, sx, TOP_ROWS, ['floor', 'walls', 'collision']);
      for (let y = TOP_ROWS; y < H - 1; y++) {
        for (let c = 0; c < POD_W; c++) {
          if (i === 0 && c === 0) continue; // the outer wall
          set('collision', sx + c, y, 0);
        }
      }
      furnishStrip(kind, sx, put, errands);
    }
  });

  const doorX = doorStrip * POD_W;
  copy(DOOR_SRC_X, 20, 1, 2, doorX, 20);
  spawn('entrance', { x: doorX, y: 20 });
  copy(DOOR_SRC_X + 1, 20, 1, 1, doorX - 1, 20, ['furniture-below', 'furniture-above', 'collision']);
  errands.push({ kind: 'bin', stand: { x: doorX - 2, y: 20 }, facing: 'right', fx: { x: doorX - 1, y: 20 } });

  // ── coordinates that move with their module ─────────────────────────────
  const place = (t: Tile): Tile | null => {
    if (t.y < TOP_ROWS ? t.x >= WING_TOP.x : t.x >= WING.x) return { x: t.x + dx, y: t.y };
    if (t.y < TOP_ROWS && t.x < LEFT_W) return { ...t };
    if (t.y < TOP_ROWS && t.x < STAFF_ROOM.x + STAFF_ROOM.w) return plan.staffRoom ? { ...t } : null;
    // The open floor is rebuilt; only the first strip's corner plant stays.
    if (t.x < POD_W && plan.strips[0] === 'pod') return { ...t };
    return null;
  };
  for (const l of source.layers) {
    if (l.type !== 'objectgroup' || l.name !== 'spawn-points') continue;
    for (const o of l.objects) {
      if (/^pc-\d+$/.test(o.name) || o.name === 'entrance' || /^desk-(team-lead|backend|product|data|project|market)/.test(o.name)) continue;
      const t = place({ x: Math.round(o.x / 16), y: Math.round(o.y / 16) });
      if (t) spawn(o.name, t);
    }
  }
  const zones: ObjectJson[] = [];
  for (const l of source.layers) {
    if (l.type !== 'objectgroup' || l.name !== 'zones') continue;
    for (const o of l.objects) {
      const t = place({ x: o.x / 16, y: o.y / 16 });
      if (t) zones.push({ ...o, x: t.x * 16, y: t.y * 16 });
    }
  }

  const staffSeatNames = ['desk-chief-architect', 'desk-ui-ux-expert'];
  if (plan.staffRoom) staffSeatNames.push('desk-agent-organizer', 'warroom-seat');

  const layers: LayerJson[] = [];
  let id = 1;
  for (const name of LAYERS) {
    const like = source.layers.find((l) => l.name === name) as TileLayerJson | undefined;
    layers.push({ ...(like ?? {}), id: id++, name, type: 'tilelayer', x: 0, y: 0, width: W, height: H, data: out.get(name)! });
  }
  const objectLayer = (name: string, objects: ObjectJson[]): ObjectLayerJson => ({
    draworder: 'topdown', id: id++, name, opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0, objects,
  });
  layers.push(objectLayer('spawn-points', spawns), objectLayer('zones', zones));

  return {
    map: { ...source, width: W, height: H, nextlayerid: id, layers },
    comfort: plan.comfort,
    deskPods: pod,
    staffRoom: plan.staffRoom,
    primarySeatNames: ['desk-ceo', ...seats],
    staffSeatNames,
    place,
    errands,
    key: `${plan.comfort}:${plan.strips.join(',')}:${plan.staffRoom ? 's' : ''}`,
  };
}

type Put = (p: Piece, x: number, y: number) => void;

/** An amenity strip: 4 tiles wide, rows 11–20. Column 0 and rows 11, 15–16
 *  stay clear as walkways. */
function furnishStrip(kind: StripKind, sx: number, put: Put, errands: ExtraErrand[]) {
  const x = (c: number) => sx + c;
  if (kind === 'lounge') {
    put(P.sofa, x(1), 12);
    put(P.rugBlue, x(1), 14);
    put(P.armchair, x(1), 17);
    put(P.armchair, x(3), 17);
    put(P.lamp, x(1), 18);
    put(P.fireplace, x(2), 18);
    put(P.bush, x(1), 20);
    errands.push({ kind: 'water', stand: { x: x(0), y: 20 }, facing: 'right', fx: { x: x(1), y: 20 } });
  } else if (kind === 'library') {
    put(P.books, x(1), 12);
    put(P.globe, x(3), 12);
    put(P.rugSmall, x(1), 14);
    put(P.armchairSide, x(3), 14);
    put(P.palm, x(1), 17);
    put(P.books2, x(2), 19);
    put(P.plantWhite, x(1), 19);
    errands.push({ kind: 'water', stand: { x: x(0), y: 20 }, facing: 'right', fx: { x: x(1), y: 20 } });
  } else {
    put(P.cabGrey, x(1), 12);
    put(P.cabWood, x(2), 12);
    put(P.cooler, x(3), 12);
    put(P.printer, x(1), 17);
    put(P.boxes, x(1), 18);
    put(P.lowCabGrey, x(2), 20);
    put(P.plant, x(3), 18);
    errands.push({ kind: 'dispenser', stand: { x: x(3), y: 14 }, facing: 'up', fx: { x: x(3), y: 13 } });
    errands.push({ kind: 'water', stand: { x: x(0), y: 19 }, facing: 'right', fx: { x: x(1), y: 19 } });
  }
}

/** The nook in the top row: rows 3–7 between the back wall and the
 *  partition, as wide as the floor below leaves. Its back wall and the row
 *  above the partition are lined with furniture end to end (a doorway in the
 *  partition stays clear); the middle row stays a walkway. */
function furnishNook(nx: number, w: number, comfort: Comfort, put: Put, errands: ExtraErrand[]) {
  if (w <= 0) return;
  const plush = comfort === 'luxury' || comfort === 'comfort';
  if (w < 3) {
    put(plush ? P.plantWhite : P.plant, nx, 3);
    return;
  }
  const end = nx + w;
  const door = nx + Math.floor(w / 2); // see the partition above
  const line = (pieces: Piece[], y: number, skip: (x: number, p: Piece) => boolean) => {
    let x = nx;
    for (let i = 0; x < end; i++) {
      const p = pieces[i % pieces.length];
      if (x + p.w > end) {
        // Close the row with something one tile wide.
        const last = plush ? P.bush : P.cabGrey;
        if (!skip(x, last)) put(last, x, y - (last.h - 1));
        break;
      }
      if (skip(x, p)) { x++; continue; }
      put(p, x, y - (p.h - 1));
      if (p === P.cooler) errands.push({ kind: 'dispenser', stand: { x, y: y + 1 }, facing: 'up', fx: { x, y } });
      if (p === P.bush || p === P.plant || p === P.plantWhite) {
        errands.push({ kind: 'water', stand: { x, y: y < 5 ? y + 1 : y - 1 }, facing: y < 5 ? 'up' : 'down', fx: { x, y } });
      }
      x += p.w;
    }
  };
  // Pictures (or whiteboards) on the back wall, every few tiles.
  for (let x = nx + 1; x + 2 <= end; x += 6) put(plush ? (x % 4 ? P.picture : P.picture2) : P.whiteboard, x, 1);
  // Back wall (bottom row 4), then the row above the partition (row 7).
  line(plush ? [P.shelfWood, P.palm, P.books, P.lamp, P.shelfBooks] : [P.cabGrey, P.cabWood, P.cooler, P.boxes, P.cabGrey, P.printer], 4, () => false);
  const nearDoor = (x: number, p: Piece) => x <= door + 1 && x + p.w - 1 >= door - 1;
  line(plush ? [P.armchair, P.bush, P.lampBlue, P.armchairSide, P.plantWhite] : [P.lowCabGrey, P.bush, P.lowCab, P.boxes], 7, nearDoor);
  if (plush && w >= 4) put(P.rugRed, Math.max(nx, Math.min(door - 2, end - 4)), 5);
}
