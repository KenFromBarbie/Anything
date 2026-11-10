// The office floor, built to the size of the team.
//
// The hand-drawn map (office.tmj) is cut into modules and put back together:
//
//   ┌ CEO office ┬ boardroom ┬ [executive room] ┬ [nook …] ┬ executive office ┐  rows 0–10
//   │                                                                          │
//   ├ desks · desks · desks │ desks · … ┬ [lounge / library / café / utility] ┬ café ┤  bands
//
// Desks stand edge to edge in rows (a cubicle panel between neighbours), with
// a one-tile aisle every few desks and wherever a room's door or a task
// board's stand opens onto the floor. Each band holds a front and a back row
// of desks; a larger team gets more bands, so the floor grows down as well as
// across and keeps the window's shape. Amenity strips fill the rest, plainer
// as the team grows: lounges and libraries for a few people, printers,
// cabinets and coolers for many, and café tables enough for a third of them.
//
// No Pixi here: the result is plain Tiled JSON plus the theme coordinates
// that move with it, so it can be built and checked outside the app
// (test/modular-office.test.cjs).

/** A map tile coordinate. */
export interface Tile { x: number; y: number; }

/** Who works on the floor. */
export interface Headcount {
  /** Agents besides the CEO (executives included). */
  workers: number;
  /** Executives among them (they sit in the private offices). */
  staff: number;
  /** The view's width / height: the floor is made at least wide enough to
   *  fill it (the extra width is amenities), so there are no bars beside it. */
  viewAspect?: number;
  /** The owner's choices (the CEO's desk → Customize office). */
  prefs?: OfficeLayoutPrefs;
}

/** How the owner wants the office (config.officeLayout). Absent = automatic. */
export interface OfficeLayoutPrefs {
  /** Fixed comfort, or 'auto' (plusher the smaller the team). */
  style?: 'auto' | Comfort;
  /** Café seats for a fifth, a third or half of the team. */
  cafe?: 'small' | 'normal' | 'large';
  /** Which amenities may fill spare space (all, when absent). */
  fill?: Partial<Record<'lounge' | 'library' | 'cafe' | 'utility', boolean>>;
  /** Cubicle panels between neighbouring desks (on when absent). */
  cubicles?: boolean;
}

/** The view's shape, rounded so a small resize doesn't rebuild the floor. */
export function aspectBucket(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 0;
  return Math.round((width / height) * 10) / 10;
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
  /** The generated map (Tiled JSON). Besides the usual layers it has
   *  `partitions` (cubicle panels, drawn by the scene) and `props` (things
   *  that can be clicked, e.g. printers). */
  map: MapJson;
  comfort: Comfort;
  /** Desks on the open floor. */
  desks: number;
  /** Whether the second executive room (two more private desks) is built. */
  staffRoom: boolean;
  /** Seat order for everyone: the CEO, then the open-floor desks. */
  primarySeatNames: string[];
  /** Private-office desks, in claim order. */
  staffSeatNames: string[];
  /** Café table seats, paired across each table. */
  cafeSeatNames: string[];
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
const STAFF_ROOM = { x: 19, w: 6 };   // x 19–24: executive room (2 desks)
// x 25–33 on top (executive office) and x 24–33 below (café): the café's
// wall sits a column left of the office's.
const WING_TOP = { x: 25, w: 9 };
const WING = { x: 24, w: 10 };
const DESK_SRC_X = 5;         // a desk: x 5–7, rows 11–14 (front) and 16–19 (back)
const DESK_W = 3;
const STRIP_W = 4;            // an amenity strip; its column 0 is a walkway
const DOOR_SRC_X = 16;        // the entrance gap in the bottom wall
const H0 = 22;                // the hand-drawn map's height
const BAND_H = 10;            // rows 11–20 of the hand-drawn floor
const MAX_BANDS = 4;
/** Desks side by side before an aisle. */
const DESKS_PER_RUN = 4;
/** An executive desk in the nook: the executive room's desk (x 19–21, rows
 *  5–7) and a gap. */
const EXEC_DESK_W = 4;
// Columns of the first band that must be aisles: under the CEO office's and
// the boardroom's doors (5, 13), the task boards' stands (8, 12; OfficeFloor's
// (8,11), (9,11), (12,11)), and the doors of the rooms/nook beyond (20, 26).
const FIRST_BAND_AISLES = [5, 8, 12, 13, 20, 26];
// The café in the hand-drawn map: its four seats around one table.
const CAFE_TABLE = { x: 27, y: 14 };
/** Café seats for this many people: by default a third of them on a break
 *  at once. */
const CAFE_SHARE = { small: 5, normal: 3, large: 2 } as const;
const cafeSeatsFor = (people: number, size: keyof typeof CAFE_SHARE = 'normal') => Math.ceil(people / CAFE_SHARE[size]);

// Furniture: [tileset gid of the top-left tile, width, height]. Office
// tileset at gid 1, interiors at 1025, 16 tiles a row.
const O = (r: number, c: number) => 1 + r * 16 + c;
const I = (r: number, c: number) => 1025 + r * 16 + c;
interface Piece { gid: number; w: number; h: number; walk?: boolean; rug?: boolean }
const P = {
  armchair: { gid: O(16, 0), w: 1, h: 1 },
  armchairSide: { gid: O(16, 2), w: 1, h: 1 },
  armchairSideL: { gid: O(16, 3), w: 1, h: 1 },
  cooler: { gid: O(16, 9), w: 1, h: 3 },
  vending: { gid: O(16, 14), w: 2, h: 3 },
  cabWood: { gid: O(18, 1), w: 1, h: 2 },
  cabGrey: { gid: O(18, 2), w: 1, h: 2 },
  lowCab: { gid: O(18, 4), w: 2, h: 2 },
  lowCabGrey: { gid: O(18, 6), w: 2, h: 2 },
  picture: { gid: O(24, 0), w: 2, h: 2, walk: true },
  picture2: { gid: O(24, 2), w: 2, h: 2, walk: true },
  whiteboard: { gid: O(26, 2), w: 2, h: 2, walk: true },
  plant: { gid: O(28, 2), w: 1, h: 2 },
  plantWhite: { gid: O(28, 3), w: 1, h: 2 },
  // A potted plant (the bare clump of leaves had no pot).
  bush: { gid: O(28, 2), w: 1, h: 2 },
  printer: { gid: O(27, 11), w: 2, h: 1 },
  shelfWood: { gid: O(9, 8), w: 2, h: 2 },
  shelfBooks: { gid: O(8, 13), w: 2, h: 3 },
  sofa: { gid: I(72, 1), w: 3, h: 2 },
  sofaWhite: { gid: I(72, 4), w: 3, h: 2 },
  fireplace: { gid: I(67, 4), w: 2, h: 4 },
  books: { gid: I(68, 10), w: 2, h: 3 },
  books2: { gid: I(71, 10), w: 2, h: 3 },
  palm: { gid: I(44, 13), w: 2, h: 2 },
  // The floor lamp with its base (the cream one beside it has none).
  lamp: { gid: I(56, 12), w: 1, h: 3 },
  lampBlue: { gid: I(53, 12), w: 1, h: 3 },
  globe: { gid: I(66, 12), w: 1, h: 2 },
  stool: { gid: I(31, 4), w: 1, h: 1, walk: true },
  /** A long low coffee table (in front of a sofa). */
  coffeeTable: { gid: I(13, 7), w: 3, h: 2 },
  /** A small round table: a café table, or a side table by an armchair. */
  roundTable: { gid: I(13, 6), w: 1, h: 1 },
  rugBlue: { gid: I(11, 13), w: 3, h: 4, rug: true },
  rugRed: { gid: I(15, 7), w: 4, h: 3, rug: true },
  rugSmall: { gid: I(15, 11), w: 2, h: 2, rug: true },
} satisfies Record<string, Piece>;

/** A printer on a low cabinet (2 wide; its cabinet's bottom row is the given
 *  row): placed by `putPrinter`, clickable (the `props` layer). */
const PRINTER_DESK: Piece = { gid: -1, w: 2, h: 2 };

/** How plush the office is for a team this size (the CEO included). */
export function comfortFor(people: number): Comfort {
  if (people <= 4) return 'luxury';
  if (people <= 9) return 'comfort';
  if (people <= 15) return 'standard';
  return 'lean';
}

type Amenity = 'lounge' | 'library' | 'utility' | 'cafe';
type CellKind = 'desks' | 'aisle' | Amenity;
/** One column group of a band: a pair of desks (front and back), an aisle,
 *  or an amenity strip. */
interface Cell { kind: CellKind; x: number; w: number }

export interface OfficePlan {
  comfort: Comfort;
  /** Bands of cells, top to bottom; the last one has the entrance. */
  bands: Cell[][];
  /** Width of the floor below the rooms, the café wing aside. */
  floorW: number;
  staffRoom: boolean;
  /** Width of the nook in the top row. */
  pad: number;
  /** Executive desks in the nook, for executives beyond the four offices. */
  execDesks: number;
  /** Cubicle panels between neighbouring desks. */
  cubicles: boolean;
  height: number;
}

/** Lay out one band: desk pairs in runs (an aisle between runs and wherever
 *  `aisles` asks), then its amenity strips. */
function layoutBand(pairs: number, amenities: Amenity[], aisles: readonly number[]): Cell[] {
  const cells: Cell[] = [];
  let x = 1; // column 0 is the outer wall
  let run = 0;
  for (let i = 0; i < pairs; i++) {
    if (run === DESKS_PER_RUN) {
      cells.push({ kind: 'aisle', x, w: 1 });
      x++;
      run = 0;
    }
    // Aisles where they must be, until the pair's three columns are clear.
    for (let needed = aisles.filter((a) => a >= x && a < x + DESK_W); needed.length; needed = aisles.filter((a) => a >= x && a < x + DESK_W)) {
      for (const to = Math.max(...needed); x <= to; x++) cells.push({ kind: 'aisle', x, w: 1 });
      run = 0;
    }
    cells.push({ kind: 'desks', x, w: DESK_W });
    x += DESK_W;
    run++;
  }
  for (const kind of amenities) {
    cells.push({ kind, x, w: STRIP_W });
    x += STRIP_W;
  }
  return cells;
}

const widthOf = (cells: Cell[]) => (cells.length ? cells[cells.length - 1].x + cells[cells.length - 1].w : 1);

/** Lay out the floor: bands of desks and amenities, and whether the second
 *  executive room is built. */
export function planOffice(h: Headcount): OfficePlan {
  const workers = Math.max(0, Math.floor(h.workers));
  const staff = Math.min(Math.max(0, Math.floor(h.staff)), workers);
  const people = workers + 1;
  const prefs = h.prefs ?? {};
  const comfort = prefs.style && prefs.style !== 'auto' ? prefs.style : comfortFor(people);
  const allowed = (a: Amenity) => prefs.fill?.[a] !== false;
  const plush = comfort === 'luxury' || comfort === 'comfort';
  const staffRoom = staff > 2;
  const privateDesks = staffRoom ? 4 : 2;
  // Everyone without a private desk sits on the open floor, plus one spare;
  // a desk pair is a front and a back desk.
  const floorPeople = workers - Math.min(staff, privateDesks + Math.max(0, staff - 4));
  const pairs = Math.max(1, Math.ceil((floorPeople + 1) / 2));
  const amenities: Amenity[] = (
    comfort === 'luxury' ? ['lounge', 'library'] :
    comfort === 'comfort' ? ['lounge'] :
    comfort === 'standard' ? ['utility'] : []
  ).filter((a) => allowed(a as Amenity)) as Amenity[];
  // The café in the wing seats 4; a café strip seats 8 more.
  const cafes = Math.max(0, Math.ceil((cafeSeatsFor(people, prefs.cafe) - 4) / 8));
  for (let i = 0; i < cafes; i++) amenities.push('cafe');
  // The top row needs the CEO office and boardroom (and the executive room).
  // More than four executives: a desk each in the nook, so it must fit them.
  const execDesks = Math.max(0, staff - 4);
  const minFloorW = LEFT_W + (staffRoom ? STAFF_ROOM.w : 0) + WING_TOP.w - WING.w + 1 + execDesks * EXEC_DESK_W;
  const aspect = h.viewAspect && h.viewAspect > 0 ? h.viewAspect : 0;

  let best: { bands: Cell[][]; floorW: number; height: number } | null = null;
  for (let b = 1; b <= (aspect ? MAX_BANDS : 1); b++) {
    const height = H0 + (b - 1) * BAND_H;
    // Pairs shared evenly; each amenity to the band that is narrowest so far.
    const pairShare = Array.from({ length: b }, (_, k) => Math.floor(pairs / b) + (k < pairs % b ? 1 : 0));
    const extra: Amenity[][] = Array.from({ length: b }, () => []);
    // (Band b - 1 becomes the top one, under the rooms, once reversed.)
    const bands = () => pairShare.map((n, k) => layoutBand(n, extra[k], k === b - 1 ? FIRST_BAND_AISLES : []));
    for (const a of amenities) {
      const widths = bands().map(widthOf);
      extra[widths.indexOf(Math.min(...widths))].push(a);
    }
    const laid = bands();
    const natural = Math.max(minFloorW, ...laid.map((b) => widthOf(b) + 1));
    const viewW = aspect ? Math.ceil((height - 2) * aspect) + 2 - WING.w : 0;
    best = { bands: laid, floorW: Math.max(natural, viewW), height };
    if (!aspect || natural <= viewW) break;
  }
  const { bands, floorW, height } = best!;
  // Fill every band to the floor's width: amenity strips (a mix, not one
  // kind over and over), then aisles.
  // The column beside the café wing stays an aisle: the café's door opens
  // onto it.
  const fill: Amenity[] = (
    plush ? ['library', 'lounge'] :
    comfort === 'standard' ? ['library', 'utility', 'lounge', 'cafe'] : ['utility', 'cafe', 'library']
  ).filter((a) => allowed(a as Amenity)) as Amenity[];
  // Nothing allowed: whatever the owner did allow, else open floor (aisles).
  if (!fill.length) fill.push(...(['lounge', 'library', 'cafe', 'utility'] as Amenity[]).filter(allowed));
  let filler = 0;
  for (const band of bands) {
    let x = widthOf(band);
    while (fill.length && x + STRIP_W <= floorW - 1) {
      band.push({ kind: fill[filler++ % fill.length], x, w: STRIP_W });
      x += STRIP_W;
    }
    for (; x < floorW; x++) band.push({ kind: 'aisle', x, w: 1 });
  }
  // Top to bottom, the last band holds the entrance.
  bands.reverse();
  const pad = floorW + WING.w - WING_TOP.w - LEFT_W - (staffRoom ? STAFF_ROOM.w : 0);
  return { comfort, bands, floorW, staffRoom, pad, execDesks, height, cubicles: prefs.cubicles !== false };
}

/** Changes only when the layout for this headcount does (rebuild the floor
 *  then, not on every hire). */
export function officeLayoutKey(h: Headcount): string {
  return keyOf(planOffice(h));
}

function keyOf(plan: OfficePlan): string {
  const band = (b: Cell[]) => b.map((c) => (c.kind === 'aisle' ? '|' : c.kind[0])).join('');
  return `${plan.comfort}:${plan.bands.map(band).join('/')}:${plan.staffRoom ? 's' : ''}${plan.execDesks || ''}${plan.cubicles ? '' : ':open'}`;
}

/** Build the office for this headcount from the hand-drawn map. */
export function buildModularOffice(source: MapJson, headcount: Headcount): ModularOffice {
  const plan = planOffice(headcount);
  const W = plan.floorW + WING.w;
  const H = plan.height;
  const dx = W - (WING.x + WING.w); // how far the wing moves
  const dy = H - H0;                // how far the bottom band moves
  const plush = plan.comfort === 'luxury' || plan.comfort === 'comfort';

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
  /** The floor's two-tile pattern: a column of the same parity. */
  const floorFrom = (x: number) => (x % 2 === 0 ? 4 : 5);
  const floorColumn = (x: number, sy: number, h: number, ty: number) => copy(floorFrom(x), sy, 1, h, x, ty, ['floor']);

  const props: ObjectJson[] = [];
  const object = (name: string, x: number, y: number, w: number, h: number): ObjectJson =>
    ({ id: 0, name, type: '', x: x * 16, y: y * 16, width: w * 16, height: h * 16, rotation: 0, visible: true });

  /** Place a piece with its top-left at (x, y). The bottom row is drawn
   *  under people and blocks the way; rows above it are drawn over them. */
  // One printer for every ten people; spare printer spots get a cabinet.
  const printerCap = Math.ceil((headcount.workers + 1) / 10);
  const put: Put = (p, x, y) => {
    if (p === PRINTER_DESK) {
      if (props.filter((o) => o.name === 'printer').length < printerCap) return putPrinter(x, y + 1);
      return put(P.lowCabGrey, x, y);
    }
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
  /** A printer on a low cabinet whose bottom row is `y`. The cabinet's top
   *  goes on the walls layer so the printer can stand on it. */
  function putPrinter(x: number, y: number) {
    for (let c = 0; c < 2; c++) {
      set('walls', x + c, y - 1, P.lowCabGrey.gid + c);
      set('furniture-below', x + c, y, P.lowCabGrey.gid + 16 + c);
      set('collision', x + c, y, 1);
      set('furniture-above', x + c, y - 1, P.printer.gid + c);
    }
    props.push(object('printer', x, y - 1, 2, 2));
  }

  const spawns: ObjectJson[] = [];
  const spawn = (name: string, t: Tile) =>
    spawns.push({ id: 0, name, type: '', x: t.x * 16, y: t.y * 16, width: 0, height: 0, rotation: 0, visible: true, point: true });
  const errands: ExtraErrand[] = [];
  const cafeSeats: string[] = ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4'];
  /** A café table (two seats each side, paired across it) at (x, y): stools
   *  on rows y and y + 3, the two-row table between them (so its top never
   *  covers the stools behind it). */
  const cafeTable = (x: number, y: number, names?: string[]) => {
    put(P.lowCab, x, y + 1);
    set('collision', x, y + 1, 1);
    set('collision', x + 1, y + 1, 1);
    for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 3], [x + 1, y + 3]]) {
      put(P.stool, cx, cy);
      if (!names) {
        const name = `cafe-seat-${cafeSeats.length + 1}`;
        cafeSeats.push(name);
        spawn(name, { x: cx, y: cy });
      }
    }
  };

  // ── top row ─────────────────────────────────────────────────────────────
  copy(0, 0, LEFT_W, TOP_ROWS, 0, 0);
  let x = LEFT_W;
  if (plan.staffRoom) {
    copy(STAFF_ROOM.x, 0, STAFF_ROOM.w, TOP_ROWS, x, 0);
    x += STAFF_ROOM.w;
  }
  const padX = x;
  for (let i = 0; i < plan.pad; i++) {
    const px = padX + i;
    const even = px % 2 === 0;
    // Back wall (rows 0–2) and bare floor (3–7) from the executive room's
    // middle; its desks' tiles and collision are left behind.
    copy(even ? 20 : 21, 0, 1, 3, px, 0);
    copy(even ? 20 : 21, 3, 1, 5, px, 3, ['floor']);
    // The partition (rows 8–10), with a doorway at the nook's second column
    // (above an aisle: see FIRST_BAND_AISLES).
    const door = plan.pad >= 3 && i === 1;
    copy(door ? (even ? 20 : 13) : (even ? 10 : 11), 8, 1, 3, px, 8, ['floor', 'walls', 'collision']);
  }
  // Executives beyond the four offices: a desk each along the nook's back
  // wall (rows 3–5; the chair's row 6 is reached from the walkway below).
  const execSeats: string[] = [];
  for (let k = 0; k < plan.execDesks; k++) {
    const ex = padX + 1 + k * EXEC_DESK_W;
    copy(STAFF_ROOM.x, 5, 3, 3, ex, 3, ['walls', 'furniture-below', 'furniture-above', 'collision']);
    const name = `desk-exec-${k + 1}`;
    spawn(name, { x: ex + 1, y: 5 });
    execSeats.push(name);
  }
  const nookFrom = plan.execDesks ? padX + 1 + plan.execDesks * EXEC_DESK_W : padX;
  furnishNook(nookFrom, plan.pad - (nookFrom - padX), plan.comfort, put, errands, padX + 1);

  // ── wing: executive office over the café ─────────────────────────────────
  copy(WING_TOP.x, 0, WING_TOP.w, TOP_ROWS, WING_TOP.x + dx, 0);
  copy(WING.x, TOP_ROWS, WING.w, H0 - TOP_ROWS, WING.x + dx, TOP_ROWS + dy);
  // The hand-drawn café table (a school desk over a rug, office chairs) is
  // replaced by a café table like the others, on its seats. The sideboard
  // beside it stays: the café's mugs are drawn on it (theme coffee.trayTile).
  {
    const tx = CAFE_TABLE.x + dx;
    const ty = CAFE_TABLE.y - 1 + dy; // rows 13–16: stools, table, stools
    for (let yy = ty; yy <= ty + 3; yy++) {
      for (let xx = tx; xx <= tx + 1; xx++) {
        for (const n of ['furniture-below', 'furniture-above', 'collision'] as const) set(n, xx, yy, 0);
        floorColumn(xx, TOP_ROWS + 4, 1, yy);
      }
    }
    cafeTable(tx, ty, cafeSeats);
    // The mug stand beside it (theme coffee.trayTile): the old tiny drawer
    // unit read as a white pad; a small round side table instead.
    set('furniture-below', tx + 2, ty + 2, I(13, 6));
    set('furniture-above', tx + 2, ty + 2, 0);
    set('collision', tx + 2, ty + 2, 1);
    cafeSeats.forEach((name, i) => spawn(name, { x: tx + (i % 2), y: ty + (i < 2 ? 0 : 3) }));
  }
  // Beside the extra bands, above the café: open floor, the outer wall, and
  // two amenity strips a band.
  const wx = WING.x + dx;
  for (let y = TOP_ROWS; y < TOP_ROWS + dy; y++) {
    for (let c = 0; c < WING.w; c++) floorColumn(wx + c, TOP_ROWS + ((y - TOP_ROWS) % BAND_H), 1, y);
    copy(SW - 1, 13, 1, 1, W - 1, y, ['floor', 'walls', 'collision']);
  }
  for (let j = 0; j < plan.bands.length - 1; j++) {
    const oy = j * BAND_H;
    furnishStrip(plush ? 'lounge' : 'cafe', wx + 1, put, errands, cafeTable, j % 2 === 1, oy);
    furnishStrip(plush ? 'library' : 'utility', wx + 5, put, errands, cafeTable, j % 2 === 0, oy);
  }

  // ── the floor: bands of desks, aisles and amenity strips ─────────────────
  const seats: string[] = [];
  const partitions: ObjectJson[] = [];
  let desks = 0;
  const last = plan.bands.length - 1;
  // Seats are numbered bottom band first, front desks then back.
  for (let j = last; j >= 0; j--) {
    const band = plan.bands[j];
    const y0 = TOP_ROWS + j * BAND_H;
    const rows = j === last ? H0 - TOP_ROWS : BAND_H;
    copy(0, TOP_ROWS, 1, rows, 0, y0); // the outer wall
    band.forEach((cell, i) => {
      if (cell.kind === 'desks') {
        copy(DESK_SRC_X, TOP_ROWS, DESK_W, rows, cell.x, y0);
        for (let c = 0; c < DESK_W; c++) floorColumn(cell.x + c, TOP_ROWS, rows, y0);
        // A cubicle panel between neighbouring desks (front and back row).
        if (plan.cubicles && band[i - 1]?.kind === 'desks') {
          partitions.push(object('partition', cell.x, y0 + 1, 0, 3), object('partition', cell.x, y0 + 6, 0, 3));
        }
        desks += 2;
        const a = `pc-${desks - 1}`;
        const b = `pc-${desks}`;
        spawn(a, { x: cell.x + 1, y: y0 + 2 });
        spawn(b, { x: cell.x + 1, y: y0 + 7 });
        seats.push(a, b);
      } else if (cell.kind === 'aisle') {
        copy(4, TOP_ROWS, 1, rows, cell.x, y0, ['walls', 'collision']);
        floorColumn(cell.x, TOP_ROWS, rows, y0);
      } else {
        copy(4, TOP_ROWS, STRIP_W, rows, cell.x, y0, ['walls', 'collision']);
        for (let c = 0; c < STRIP_W; c++) floorColumn(cell.x + c, TOP_ROWS, rows, y0);
        for (let y = y0; y < y0 + BAND_H; y++) {
          for (let c = 0; c < STRIP_W; c++) set('collision', cell.x + c, y, 0);
        }
        // Every other strip of a kind gets its second look.
        const seen = band.slice(0, i).filter((k) => k.kind === cell.kind).length + j;
        furnishStrip(cell.kind, cell.x, put, errands, cafeTable, seen % 2 === 1, y0 - TOP_ROWS);
      }
    });
  }

  // The entrance: a gap in the bottom wall on the aisle nearest the middle
  // (or an amenity strip's walkway column).
  const bottom = plan.bands[last];
  const ways = bottom.filter((c) => c.kind !== 'desks').map((c) => c.x);
  const middle = plan.floorW / 2;
  const doorX = ways.length ? ways.reduce((a, b) => (Math.abs(b - middle) < Math.abs(a - middle) ? b : a)) : 1;
  copy(DOOR_SRC_X, 20, 1, 2, doorX, 20 + dy, ['walls', 'collision']);
  spawn('entrance', { x: doorX, y: 20 + dy });

  // ── coordinates that move with their module ─────────────────────────────
  const place = (t: Tile): Tile | null => {
    if (t.y < TOP_ROWS) {
      if (t.x >= WING_TOP.x) return { x: t.x + dx, y: t.y };
      if (t.x < LEFT_W) return { ...t };
      return t.x < STAFF_ROOM.x + STAFF_ROOM.w && plan.staffRoom ? { ...t } : null;
    }
    if (t.x >= WING.x) return { x: t.x + dx, y: t.y + dy };
    return null; // the open floor is rebuilt
  };
  for (const l of source.layers) {
    if (l.type !== 'objectgroup' || l.name !== 'spawn-points') continue;
    for (const o of l.objects) {
      if (/^pc-\d+$/.test(o.name) || /^cafe-seat-/.test(o.name) || o.name === 'entrance' || /^desk-(team-lead|backend|product|data|project|market)/.test(o.name)) continue;
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
  staffSeatNames.push(...execSeats);

  const layers: LayerJson[] = [];
  let id = 1;
  for (const name of LAYERS) {
    const like = source.layers.find((l) => l.name === name) as TileLayerJson | undefined;
    layers.push({ ...(like ?? {}), id: id++, name, type: 'tilelayer', x: 0, y: 0, width: W, height: H, data: out.get(name)! });
  }
  const objectLayer = (name: string, objects: ObjectJson[]): ObjectLayerJson => ({
    draworder: 'topdown', id: id++, name, opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0, objects,
  });
  layers.push(
    objectLayer('spawn-points', spawns),
    objectLayer('zones', zones),
    objectLayer('partitions', partitions),
    objectLayer('props', props),
  );

  return {
    map: { ...source, width: W, height: H, nextlayerid: id, layers },
    comfort: plan.comfort,
    desks,
    staffRoom: plan.staffRoom,
    primarySeatNames: ['desk-ceo', ...seats],
    staffSeatNames,
    cafeSeatNames: cafeSeats,
    place,
    errands,
    key: keyOf(plan),
  };
}

type Put = (p: Piece, x: number, y: number) => void;
type CafeTable = (x: number, y: number) => void;

/** An amenity strip: 4 tiles wide, rows 11–20 of a band. Column 0 and rows
 *  11, 15 and 20 stay clear as walkways. */
function furnishStrip(kind: Amenity, sx: number, place: Put, out: ExtraErrand[], table: CafeTable, alt = false, oy = 0) {
  const x = (c: number) => sx + c;
  // The rows below are the bottom band's (11–20); `oy` moves them to another.
  const put: Put = (p, px, py) => place(p, px, py + oy);
  const errands = {
    push: (e: ExtraErrand) => out.push({ ...e, stand: { ...e.stand, y: e.stand.y + oy }, fx: { ...e.fx, y: e.fx.y + oy } }),
  };
  if (kind === 'cafe') {
    table(x(1), 12 + oy);
    table(x(1), 16 + oy);
    put(alt ? P.plantWhite : P.plant, x(3), 17);
  } else if (kind === 'lounge' && alt) {
    // A sofa, a rug before it with a round table in the middle and an
    // armchair either side facing it; a lamp, a palm and a plant behind.
    put(P.sofaWhite, x(1), 12);
    put(P.rugRed, x(0), 14);
    put(P.armchairSide, x(1), 15);
    put(P.roundTable, x(2), 15);
    put(P.armchairSideL, x(3), 15);
    put(P.lampBlue, x(1), 17);
    put(P.palm, x(2), 18);
    errands.push({ kind: 'water', stand: { x: x(3), y: 17 }, facing: 'down', fx: { x: x(3), y: 18 } });
  } else if (kind === 'library' && alt) {
    // Bookcases along the top; a reading corner: an armchair and a side table
    // on a rug, under a lamp; a plant.
    put(P.books2, x(1), 12);
    put(P.lamp, x(3), 12);
    put(P.armchair, x(1), 16);
    put(P.roundTable, x(2), 16);
    put(P.shelfBooks, x(2), 18);
    put(P.bush, x(1), 18);
    errands.push({ kind: 'water', stand: { x: x(1), y: 17 }, facing: 'down', fx: { x: x(1), y: 18 } });
  } else if (kind === 'utility' && alt) {
    put(P.vending, x(1), 12);
    put(P.cooler, x(3), 12);
    put(PRINTER_DESK, x(1), 17);
    put(P.cabWood, x(3), 18);
    put(P.plant, x(1), 18);
    errands.push({ kind: 'dispenser', stand: { x: x(3), y: 15 }, facing: 'up', fx: { x: x(3), y: 14 } });
  } else if (kind === 'lounge') {
    // A sofa and a coffee table before it on a rug, two armchairs facing each
    // other across the rug's foot; a lamp and a plant behind.
    put(P.rugBlue, x(1), 13);
    put(P.sofa, x(1), 12);
    put(P.coffeeTable, x(1), 14);
    put(P.armchairSide, x(1), 16);
    put(P.armchairSideL, x(3), 16);
    put(P.lamp, x(1), 17);
    put(P.plantWhite, x(3), 18);
    errands.push({ kind: 'water', stand: { x: x(3), y: 17 }, facing: 'down', fx: { x: x(3), y: 18 } });
  } else if (kind === 'library') {
    // Bookcases and a globe along the top; a fireplace with a reading chair
    // and side table before it; a palm.
    put(P.books, x(1), 12);
    put(P.globe, x(3), 13);
    put(P.armchair, x(1), 16);
    put(P.roundTable, x(2), 16);
    put(P.fireplace, x(2), 17);
    put(P.plantWhite, x(1), 18);
    errands.push({ kind: 'water', stand: { x: x(1), y: 17 }, facing: 'down', fx: { x: x(1), y: 18 } });
  } else {
    put(P.cabGrey, x(1), 12);
    put(P.cabWood, x(2), 12);
    put(P.cooler, x(3), 12);
    put(PRINTER_DESK, x(1), 17);
    put(P.plant, x(3), 18);
    errands.push({ kind: 'dispenser', stand: { x: x(3), y: 15 }, facing: 'up', fx: { x: x(3), y: 14 } });
    errands.push({ kind: 'water', stand: { x: x(3), y: 17 }, facing: 'down', fx: { x: x(3), y: 18 } });
  }
}

/** The nook in the top row: rows 3–7 between the back wall and the
 *  partition, as wide as the floor below leaves. Its back wall and the row
 *  above the partition are lined with furniture end to end (the doorway in
 *  the partition stays clear); the middle row stays a walkway. */
function furnishNook(nx: number, w: number, comfort: Comfort, put: Put, errands: ExtraErrand[], doorX = nx + 1) {
  if (w <= 0) return;
  const plush = comfort === 'luxury' || comfort === 'comfort';
  if (w < 3) {
    put(plush ? P.plantWhite : P.plant, nx, 3);
    return;
  }
  const end = nx + w;
  const door = doorX; // see the partition above
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
  for (let x = nx + 2; x + 2 <= end; x += 6) put(plush ? (x % 4 ? P.picture : P.picture2) : P.whiteboard, x, 0);
  // Back wall (bottom row 4), then the row above the partition (row 7).
  line(plush ? [P.shelfWood, P.palm, P.books, P.lamp, P.shelfBooks] : [P.cabGrey, P.cabWood, P.cooler, PRINTER_DESK, P.cabGrey], 4, () => false);
  const nearDoor = (x: number, p: Piece) => x <= door + 1 && x + p.w - 1 >= door - 1;
  line(plush ? [P.armchair, P.bush, P.lampBlue, P.armchairSide, P.plantWhite] : [P.lowCabGrey, P.bush, P.lowCab, P.plant], 7, nearDoor);
  if (plush && w >= 6) put(P.rugRed, Math.min(nx + 3, end - 4), 5);
}
