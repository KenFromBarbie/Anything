// Shell steps show the real command, not the cd/assignment boilerplate; steps carry their tool.
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { commandGist, toolLabel, PresenceTracker } = loadTs('src/shared/presence.ts');

test('the cd and variable boilerplate in front of a command is dropped', () => {
  assert.equal(commandGist('cd "C:/Users/x/Boat Bike/design/v10/v12" && python qa/float.py hull.model.json'), 'python qa/float.py hull.model.json');
  assert.equal(commandGist('S="C:/a b"; W=C:/w; cd "$W" && ls -la'), 'ls -la');
  assert.equal(commandGist('cd "C:/x" && python -I -c "import json; print(1)"'), 'python (inline script)');
  assert.equal(commandGist("cd /tmp && python - <<'EOF'\nprint(1)\nEOF"), 'python (inline script)');
  assert.equal(commandGist('git status'), 'git status');
});

test('steps name the tool they used', () => {
  assert.equal(toolLabel('Bash'), 'Bash');
  assert.equal(toolLabel('mcp__claude-in-chrome__navigate'), 'navigate (claude-in-chrome)');
  const p = new PresenceTracker();
  p.tool('a', 'Bash', { command: 'cd "C:/x" && python run.py' }, 1000);
  assert.equal(p.get('a').steps.at(-1).tool, 'Bash');
  assert.equal(p.get('a').steps.at(-1).text, 'Ran python run.py');
});
