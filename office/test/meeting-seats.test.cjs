'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { findMeetSeats, reachableFrom, inChair } = loadTs('src/renderer/src/scene/office/meetingSeats.ts');

// A boardroom drawn as text: '.' open, anything else blocked (wall '#',
// table 'T', chair 'c'). Chairs above the table (row 1) face down; below
// (row 4) face up.
const MAP = [
  '##########',
  '#.cccc...#',
  '#.TTTTT..#',
  '#.TTTTT..#',
  '#.cccc...#',
  '#........#',
  '####.#####',
];
const walkable = (x, y) => MAP[y]?.[x] === '.';
const zone = { x: 1, y: 1, width: 8, height: 5 };
const door = { x: 4, y: 6 - 1 };

test('a walled-off pocket is not reachable from the door', () => {
  const pocketMap = ['#####', '#.#.#', '#####'];
  const reach = reachableFrom({ x: 1, y: 1 }, (x, y) => pocketMap[y]?.[x] === '.');
  assert.ok(reach.has('1,1'));
  assert.ok(!reach.has('3,1'));
});

test('chairs fill the far side first, each side from the middle out', () => {
  const reach = reachableFrom(door, walkable);
  const seats = findMeetSeats(zone, walkable, reach);
  assert.equal(seats.length, 8);
  assert.deepEqual(seats.slice(0, 4).map((s) => s.face), ['down', 'down', 'down', 'down']);
  assert.deepEqual(seats.slice(4).map((s) => s.face), ['up', 'up', 'up', 'up']);
  const firstXs = seats.slice(0, 2).map((s) => s.tile.x).sort();
  assert.deepEqual(firstXs, [3, 4]);
});

test('every chair is approached from a tile reachable from the door', () => {
  const reach = reachableFrom(door, walkable);
  for (const seat of findMeetSeats(zone, walkable, reach)) {
    assert.ok(reach.has(`${seat.approach.x},${seat.approach.y}`), JSON.stringify(seat));
  }
});

test('a character counts as in the chair by distance, not by its tile', () => {
  const ts = 16;
  const seat = { x: 32, y: 16 };
  assert.ok(inChair({ x: 40, y: 32 }, seat, ts));
  assert.ok(inChair({ x: 40, y: 20 }, seat, ts)); // seated pose reads a tile up
  assert.ok(!inChair({ x: 70, y: 32 }, seat, ts));
});
