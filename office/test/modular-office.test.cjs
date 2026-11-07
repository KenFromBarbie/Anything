'use strict';

// The office is built to the team's size (scene/office/modularOffice.ts).
// Whatever the headcount, everyone must have a desk, and every place people
// walk to (desks, errands, the task boards, the café) must be reachable from
// the entrance.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { buildModularOffice, comfortFor, officeLayoutKey } = loadTs('src/renderer/src/scene/office/modularOffice.ts');
const source = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/assets/maps/office.tmj'), 'utf8'),
);

const TEAMS = [
  { workers: 0, staff: 0 },
  { workers: 2, staff: 0 },
  { workers: 5, staff: 2 },
  { workers: 9, staff: 3 },
  { workers: 14, staff: 4 },
  { workers: 30, staff: 4 },
];

function inspect(office) {
  const { map } = office;
  const layer = (name) => map.layers.find((l) => l.name === name);
  const collision = layer('collision').data;
  const walkable = (x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height && !collision[y * map.width + x];
  const spawns = new Map(layer('spawn-points').objects.map((o) => [o.name, { x: o.x / 16, y: o.y / 16 }]));
  const reach = new Set();
  const start = spawns.get('entrance');
  const queue = [start];
  reach.add(`${start.x},${start.y}`);
  while (queue.length) {
    const { x, y } = queue.shift();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = `${nx},${ny}`;
      if (!reach.has(k) && walkable(nx, ny)) { reach.add(k); queue.push({ x: nx, y: ny }); }
    }
  }
  const reachable = (t) => reach.has(`${t.x},${t.y}`);
  const nextToReach = (t) => [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]].some(([dx, dy]) => reachable({ x: t.x + dx, y: t.y + dy }));
  return { map, layer, spawns, walkable, reachable, nextToReach };
}

for (const team of TEAMS) {
  test(`an office for ${team.workers} (${team.staff} staff) seats everyone and keeps them reachable`, () => {
    const office = buildModularOffice(source, team);
    const { map, layer, spawns, walkable, reachable, nextToReach } = inspect(office);
    for (const l of map.layers) {
      if (l.type === 'tilelayer') assert.equal(l.data.length, map.width * map.height, l.name);
    }
    const desks = office.primarySeatNames.length - 1 + office.staffSeatNames.length;
    assert.ok(desks >= team.workers, `${desks} desks for ${team.workers} people`);
    for (const name of [...office.primarySeatNames, ...office.staffSeatNames]) {
      const seat = spawns.get(name);
      assert.ok(seat, `seat ${name} is on the map`);
      // A desk is reached from the chair below it.
      assert.ok(nextToReach({ x: seat.x, y: seat.y + 1 }), `${name} can be reached`);
    }
    for (const e of office.errands) {
      assert.ok(walkable(e.stand.x, e.stand.y) && reachable(e.stand), `${e.kind} errand stand ${JSON.stringify(e.stand)}`);
      assert.equal(Math.abs(e.stand.x - e.fx.x) + Math.abs(e.stand.y - e.fx.y), 1, `${e.kind} errand is beside its prop`);
    }
    // OfficeFloor's task-board stands are fixed tiles under the boards.
    for (const t of [{ x: 8, y: 11 }, { x: 9, y: 11 }, { x: 12, y: 11 }]) assert.ok(reachable(t), `board stand ${t.x},${t.y}`);
    for (const name of ['cafe-seat-1', 'cafe-stand-coffee', 'cafe-stand-vending']) {
      assert.ok(spawns.get(name) && nextToReach(spawns.get(name)), `${name} can be reached`);
    }
    const coffee = office.place({ x: 26, y: 20 });
    assert.ok(reachable(coffee), 'the coffee machine stand');
    assert.ok(layer('zones').objects.some((z) => z.name === 'boardroom'));
    assert.ok(layer('zones').objects.some((z) => z.name === 'cafeteria'));
  });
}

test('the office grows with the team and gets plainer', () => {
  const widths = TEAMS.map((t) => buildModularOffice(source, t).map.width);
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] >= widths[i - 1], widths.join(' '));
  assert.ok(widths[0] < source.width, 'a small team gets a smaller office than the hand-drawn one');
  assert.deepEqual([1, 5, 10, 16].map(comfortFor), ['luxury', 'comfort', 'standard', 'lean']);
});

test('the layout key changes only when the layout does', () => {
  assert.equal(officeLayoutKey({ workers: 0, staff: 0 }), officeLayoutKey({ workers: 1, staff: 0 }));
  assert.notEqual(officeLayoutKey({ workers: 2, staff: 0 }), officeLayoutKey({ workers: 12, staff: 0 }));
  assert.equal(officeLayoutKey({ workers: 7, staff: 2 }), buildModularOffice(source, { workers: 7, staff: 2 }).key);
});

test('the floor is made wide enough to fill the view, with amenities', () => {
  const narrow = buildModularOffice(source, { workers: 2, staff: 0 });
  const wide = buildModularOffice(source, { workers: 2, staff: 0, viewAspect: 1.8 });
  // Visible part: height less the edge tile each side, as wide as the view.
  assert.ok((wide.map.width - 2) / (wide.map.height - 2) >= 1.8, `${wide.map.width} wide`);
  assert.ok(wide.map.width > narrow.map.width);
  assert.equal(wide.primarySeatNames.length, narrow.primarySeatNames.length, 'the extra width is not desks');
});

test('a large team gets more bands of desks, not an ever wider floor', () => {
  for (const workers of [20, 40, 60]) {
    const office = buildModularOffice(source, { workers, staff: 4, viewAspect: 1.8 });
    const { map, spawns, nextToReach } = inspect(office);
    const shape = (map.width - 2) / (map.height - 2);
    assert.ok(shape <= 2.3, `${workers} people: ${map.width}x${map.height}`);
    assert.ok(office.primarySeatNames.length - 1 + office.staffSeatNames.length >= workers);
    for (const name of office.primarySeatNames) {
      const seat = spawns.get(name);
      assert.ok(nextToReach({ x: seat.x, y: seat.y + 1 }), `${workers} people: ${name} can be reached`);
    }
  }
  assert.ok(buildModularOffice(source, { workers: 40, staff: 4, viewAspect: 1.8 }).map.height > source.height);
});

test('every open-floor desk but a few walkway columns sits in a cubicle', () => {
  const office = buildModularOffice(source, { workers: 20, staff: 0, viewAspect: 1.8 });
  const walls = office.map.layers.find((l) => l.name === 'walls').data;
  const { map, spawns } = inspect(office);
  let walled = 0;
  for (const name of office.primarySeatNames.slice(1)) {
    const { x, y } = spawns.get(name);
    if (walls[y * map.width + (x - 2)]) walled++;
  }
  assert.ok(walled >= (office.primarySeatNames.length - 1) / 2, `${walled} cubicles`);
});
