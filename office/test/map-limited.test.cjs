'use strict';

// The team restore starts agents a few at a time (useRestoreTeam's
// RESTORE_CONCURRENCY): 22 agents spawned at once filled the machine's memory.

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { mapLimited } = loadTs('src/renderer/src/hooks/mapLimited.ts');

test('never runs more than the limit at once, and keeps input order', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimited([5, 1, 4, 2, 3, 0], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n * 3));
    running--;
    return n * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
});

test('an empty list resolves to an empty list', async () => {
  assert.deepEqual(await mapLimited([], 2, async () => 1), []);
});
