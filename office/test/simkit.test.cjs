// The Office's simulation kit (src/sidecar/simkit) against hand-checked
// answers. Needs Python with numpy; skipped where that isn't installed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const python = process.platform === 'win32' ? 'python' : 'python3';
const has = spawnSync(python, ['-c', 'import numpy'], { encoding: 'utf8' }).status === 0;

test('simkit matches hand-checked hydrostatics, aerodynamics and fit', { skip: !has && 'no python + numpy', timeout: 180_000 }, () => {
  const out = spawnSync(python, ['-m', 'simkit.selftest'], {
    cwd: join(__dirname, '..', 'src', 'sidecar'),
    encoding: 'utf8',
  });
  assert.equal(out.stdout.trim(), 'OK', out.stdout + out.stderr);
});
