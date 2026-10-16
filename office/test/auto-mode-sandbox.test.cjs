/**
 * Auto mode keeps the OS sandbox ON.
 *
 * The app used to spawn every auto-mode agent with no sandbox at all (codex
 * `--dangerously-bypass-approvals-and-sandbox`; Claude with its opt-in sandbox
 * never enabled) for one reason: a hive worker writes to its agent folder under
 * <harnessHome>/hive/agents/<id>/, which sits OUTSIDE the project cwd. That is a
 * path-layout problem. Fix: keep the sandbox and declare those paths writable —
 * codex via `--add-dir`, Claude via `sandbox.filesystem.allowWrite` plus
 * `permissions.additionalDirectories` in the per-session settings file.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager } = loadTs('src/main/hive.ts');
const { autoModeFlagForProvider, codexSandboxFromArgs } = loadTs('src/shared/agentProvider.ts');

function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'md-sandbox-')); }

test('codex auto mode is workspace-write with approvals off, never the full bypass', () => {
  const flag = autoModeFlagForProvider('codex');
  assert.equal(flag, '-a never -s workspace-write');
  assert.ok(!flag.includes('dangerously'));
});

test('a Claude agent gets a native sandbox that still allows its agent dir and the hive root', async () => {
  const home = tmpHome();
  const hive = new HiveManager(() => home);
  const palace = path.join(home, 'palace');
  const inj = await hive.ensureAgent(
    { id: 'jim-1', name: 'Jim', provider: 'claude', cwd: home },
    { extraWritableDirs: [palace] }
  );
  const i = inj.args.indexOf('--settings');
  assert.ok(i >= 0, 'claude spawn carries --settings');
  const settings = JSON.parse(fs.readFileSync(inj.args[i + 1], 'utf8'));
  const agentDir = path.join(home, 'hive', 'agents', 'jim-1');
  const hiveRoot = path.join(home, 'hive');
  assert.equal(settings.sandbox.enabled, true);
  assert.notEqual(settings.sandbox.failIfUnavailable, true, 'Windows must still spawn');
  assert.deepEqual(settings.sandbox.filesystem.allowWrite, [agentDir, hiveRoot, palace]);
  // Both layers, or the agent deadlocks: Edit/Write allowed but `mv … .done/` denied.
  assert.deepEqual(settings.permissions.additionalDirectories, settings.sandbox.filesystem.allowWrite);
  // No bypass of the sandbox anywhere in the injected args.
  assert.ok(!inj.args.some((a) => /dangerously/.test(a)));
});

test('codexSandboxFromArgs reads the sandbox a codex command line asks for', () => {
  assert.equal(codexSandboxFromArgs(['--model', 'gpt-6-sol']), undefined);
  assert.equal(codexSandboxFromArgs(['-a', 'never', '-s', 'workspace-write']), 'workspace-write');
  assert.equal(codexSandboxFromArgs(['--sandbox', 'read-only']), 'read-only');
  assert.equal(codexSandboxFromArgs(['--sandbox=danger-full-access']), 'danger-full-access');
  assert.equal(codexSandboxFromArgs(['--full-auto']), 'workspace-write');
  assert.equal(codexSandboxFromArgs(['--dangerously-bypass-approvals-and-sandbox']), 'danger-full-access');
  assert.equal(codexSandboxFromArgs(['-c', 'sandbox_mode="workspace-write"']), 'workspace-write');
});

/** HOME/USERPROFILE pointed at a temp dir: the codex installer reads and links
 *  into ~/.codex, which must never be the real one in a test. */
function isolatedHome(t) {
  const base = tmpHome();
  const home = path.join(base, 'user');
  fs.mkdirSync(home, { recursive: true });
  const realHome = process.env.HOME;
  const realProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
    if (realProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realProfile;
    fs.rmSync(base, { recursive: true, force: true });
  });
  assert.equal(os.homedir(), home, 'home redirect failed - aborting before touching the real home');
  return path.join(base, 'harness');
}

test('a codex worker in auto mode gets its agent dir and the hive root as --add-dir', async (t) => {
  const harness = isolatedHome(t);
  const hive = new HiveManager(() => harness);
  const inj = await hive.ensureAgent(
    { id: 'jim-1', name: 'Jim', provider: 'codex', cwd: harness },
    { launchArgs: ['--model', 'gpt-6-sol', '-a', 'never', '-s', 'workspace-write'] }
  );
  const dirs = inj.args.flatMap((a, i) => (a === '--add-dir' ? [inj.args[i + 1]] : []));
  assert.deepEqual(dirs, [path.join(harness, 'hive', 'agents', 'jim-1'), path.join(harness, 'hive')]);
});

test('a codex worker outside auto mode gets no --add-dir (codex 0.148 exits on it when read-only)', async (t) => {
  const harness = isolatedHome(t);
  const hive = new HiveManager(() => harness);
  for (const launchArgs of [['--model', 'gpt-6-sol'], ['-s', 'read-only'], undefined]) {
    const inj = await hive.ensureAgent(
      { id: 'jim-1', name: 'Jim', provider: 'codex', cwd: harness },
      launchArgs ? { launchArgs } : {}
    );
    assert.ok(!inj.args.includes('--add-dir'), `no --add-dir for ${JSON.stringify(launchArgs)}`);
  }
});
