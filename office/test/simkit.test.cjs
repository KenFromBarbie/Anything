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

test('the bridge installs simkit into the hive once, and again on a new version', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { BuzzBridge } = require('../src/sidecar/buzz-bridge.cjs');
  const root = fs.mkdtempSync(join(os.tmpdir(), 'hive-'));
  const self = { log: { warn: () => {} } };
  const to = BuzzBridge.prototype.installSimkit.call(self, root);
  assert.equal(to, join(root, 'tools', 'simkit'));
  for (const f of ['README.md', '__init__.py', 'hydro.py', 'aero.py', 'cloth.py', 'glb.py', join('examples', 'boat.py')]) {
    assert.ok(fs.existsSync(join(to, f)), f);
  }
  assert.ok(!fs.existsSync(join(to, '__pycache__')));
  // an agent's stray edit survives until the kit's version changes
  fs.writeFileSync(join(to, 'README.md'), 'edited');
  BuzzBridge.prototype.installSimkit.call(self, root);
  assert.equal(fs.readFileSync(join(to, 'README.md'), 'utf8'), 'edited');
  const init = join(to, '__init__.py');
  fs.writeFileSync(init, fs.readFileSync(init, 'utf8').replace(/__version__ = "[^"]+"/, '__version__ = "0.0.0"'));
  BuzzBridge.prototype.installSimkit.call(self, root);
  assert.notEqual(fs.readFileSync(join(to, 'README.md'), 'utf8'), 'edited');
  fs.rmSync(root, { recursive: true, force: true });
});
