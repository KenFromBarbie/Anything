'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { ChangeTracker, lineDelta } = loadTs('src/main/changes.ts');

test('line delta counts added and removed lines', () => {
  assert.deepEqual(lineDelta('a\nb\nc', 'a\nx\nc\nd'), { added: 2, removed: 1 });
  assert.deepEqual(lineDelta('', 'a\nb'), { added: 2, removed: 0 });
});

test('writes and edits are recorded with their before and after', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-changes-'));
  const file = path.join(root, 'work', 'app.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tracker = new ChangeTracker(() => root);
  try {
    // a new file
    await tracker.handle('jim', 'PreToolUse', 'Write', { file_path: file, content: 'one\ntwo\n' });
    fs.writeFileSync(file, 'one\ntwo\n');
    assert.equal(await tracker.handle('jim', 'PostToolUse', 'Write', { file_path: file, content: 'one\ntwo\n' }), true);
    // an edit
    fs.writeFileSync(file, 'one\nTWO\nthree\n');
    assert.equal(await tracker.handle('jim', 'PostToolUse', 'Edit', { file_path: file, old_string: 'two\n', new_string: 'TWO\nthree\n' }), true);
    // an overwrite keeps what was there before
    await tracker.handle('jim', 'PreToolUse', 'Write', { file_path: file, content: 'fresh\n' });
    fs.writeFileSync(file, 'fresh\n');
    await tracker.handle('jim', 'PostToolUse', 'Write', { file_path: file, content: 'fresh\n' });
    // other tools are ignored
    assert.equal(await tracker.handle('jim', 'PostToolUse', 'Read', { file_path: file }), false);

    const log = fs.readFileSync(path.join(root, 'changes', 'jim.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(log.map((c) => c.op), ['created', 'edited', 'written']);
    assert.equal(log[0].hunks[0].new, 'one\ntwo\n');
    assert.deepEqual([log[1].hunks[0].old, log[1].hunks[0].new, log[1].hunks[0].line], ['two\n', 'TWO\nthree\n', 2]);
    assert.equal(log[2].hunks[0].old, 'one\nTWO\nthree\n');
    const s = tracker.summaryOf('jim');
    assert.equal(s.count, 3);
    assert.equal(s.files, 1);
    assert.ok(s.added >= 4 && s.removed >= 1);
    assert.equal(tracker.summaryOf('pam'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
