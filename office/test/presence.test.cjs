'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { PresenceTracker, classify, sinceLabel, liveKindOf } = loadTs('src/shared/presence.ts');

const T0 = 1_000_000;
const min = 60_000;

test('a 3D job reads as "Modeling in 3D" on its project, and keeps its clock', () => {
  const p = new PresenceTracker();
  p.tool('a', 'Write', { file_path: '/hive/shared/boat_trike/build_hull.py', content: 'from simkit import mesh, glb\nscene = glb.Scene()' }, T0);
  let s = p.get('a');
  assert.equal(s.activity, 'Modeling in 3D');
  assert.equal(s.detail, 'boat trike');
  // Reading and running the script don't reset "for N min".
  p.tool('a', 'Read', { file_path: '/hive/shared/boat_trike/notes.md' }, T0 + 10 * min);
  p.tool('a', 'Bash', { command: 'python build_hull.py' }, T0 + 20 * min);
  s = p.get('a');
  assert.equal(s.activity, 'Modeling in 3D');
  assert.equal(sinceLabel(s.since, T0 + 40 * min), 'for 40 min');
  assert.deepEqual(s.dirs, ['/hive/shared/boat_trike']);
  assert.equal(s.steps.at(-1).text, 'Ran python build_hull.py');
});

test('a produced .glb becomes the live view; a .py never outranks it', () => {
  const p = new PresenceTracker();
  p.tool('a', 'Bash', { command: 'python run.py' }, T0);
  p.tool('a', 'Write', { file_path: '/w/out/run.py', content: 'print(1)' }, T0 + 1000);
  p.produced('a', { path: '/w/out/hull.glb', kind: 'model', mtime: T0 + 2000 });
  assert.equal(p.get('a').latest.path, '/w/out/hull.glb');
  assert.equal(p.get('a').activity, 'Modeling in 3D');
  p.produced('a', { path: '/w/out/notes.md', kind: 'text', mtime: T0 + 1500 });
  assert.equal(p.get('a').latest.path, '/w/out/hull.glb');
});

test('classification by tool', () => {
  assert.equal(classify('WebSearch', { query: 'boat stability' }).activity, 'Researching');
  assert.equal(classify('Bash', { command: 'python -c "from simkit import hydro; hydro.Boat"' }).activity, 'Running a simulation');
  assert.equal(classify('Write', { file_path: 'x/pattern.py', content: 'cloth.drape(body, tshirt)' }).activity, 'Designing clothing');
  assert.equal(classify('Write', { file_path: 'site/index.html', content: '<h1>' }).activity, 'Building a site');
  assert.equal(classify('Bash', { command: 'buzz-post --channel general --text-file a.txt' }).activity, 'Messaging');
  assert.equal(liveKindOf('a/b.model.json'), 'editor');
  assert.equal(liveKindOf('a/b.GLB'), 'model');
});

test('idle keeps the last activity; a long gap restarts the clock', () => {
  const p = new PresenceTracker();
  p.tool('a', 'Write', { file_path: '/w/deck/build.py', content: 'from pptx import Presentation' }, T0);
  p.idle('a', T0 + min);
  assert.equal(p.get('a').idleSince, T0 + min);
  p.tool('a', 'Write', { file_path: '/w/deck/build.py', content: 'python-pptx' }, T0 + 30 * min);
  assert.equal(p.get('a').idleSince, null);
  assert.equal(p.get('a').since, T0 + 30 * min);
});
