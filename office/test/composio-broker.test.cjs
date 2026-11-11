'use strict';

// buzz-composio → loopback broker → (fake) Composio: the agent's command works
// with only a capability token, the key is added by the broker, and an agent
// granted '*' reaches an integration the owner enabled later.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const { IntegrationBroker } = loadTs('src/main/integrationBroker.ts');

const SECRET = 'test-composio-key-123';
const CLI = path.join(__dirname, '..', 'src', 'sidecar', 'md-composio.cjs');

function fakeComposio() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body });
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/api/v3.1/connected_accounts')) {
        return res.end(JSON.stringify({ items: [{ id: 'ca_1', status: 'ACTIVE', user_id: 'owner', toolkit: { slug: 'gmail' } }] }));
      }
      if (req.url === '/api/v3.1/tools/GMAIL_FETCH_EMAILS') {
        return res.end(JSON.stringify({ slug: 'GMAIL_FETCH_EMAILS', toolkit: { slug: 'gmail' }, input_parameters: {} }));
      }
      if (req.url === '/api/v3.1/tools/execute/GMAIL_FETCH_EMAILS') {
        return res.end(JSON.stringify({ successful: true, data: { messages: 2 }, error: null }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, port: server.address().port })));
}

function run(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr })
    );
  });
}

test('buzz-composio runs a tool through the broker without the key', async () => {
  const up = await fakeComposio();
  let enabled = false;
  const rec = () => ({
    id: 'composio', label: 'Composio', kind: 'custom-rest', baseUrl: `http://127.0.0.1:${up.port}`,
    authType: 'header', authHeader: 'x-api-key', secretRef: 'int:composio', enabled, createdAt: 0, updatedAt: 0
  });
  const broker = new IntegrationBroker({
    getRecord: (id) => (id === 'composio' ? rec() : undefined),
    getSecret: (ref) => (ref === 'int:composio' ? SECRET : undefined)
  });
  const started = await broker.start();
  assert.ok(started.ok);
  // Granted before the owner turned Composio on.
  const token = broker.grant('agent-1', ['*']);
  const env = { MD_BROKER_URL: broker.url(), MD_BROKER_TOKEN: token };
  try {
    const off = await run(['apps'], env);
    assert.notEqual(off.code, 0, 'disabled integration is refused');

    enabled = true;
    const apps = await run(['apps'], env);
    assert.equal(apps.code, 0, apps.stderr);
    assert.match(apps.stdout, /gmail\tACTIVE\tca_1/);

    const out = await run(['run', 'GMAIL_FETCH_EMAILS', '{"max_results":2}'], env);
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), { messages: 2 });
    const exec = up.seen.find((s) => s.url === '/api/v3.1/tools/execute/GMAIL_FETCH_EMAILS');
    assert.deepEqual(JSON.parse(exec.body), { arguments: { max_results: 2 }, connected_account_id: 'ca_1', user_id: 'owner' });
    assert.ok(up.seen.filter((s) => s.key).every((s) => s.key === SECRET), 'the broker adds the key upstream');
    assert.ok(!out.stdout.includes(SECRET) && !apps.stdout.includes(SECRET), 'the agent never sees the key');

    const bad = await run(['apps'], { MD_BROKER_URL: broker.url(), MD_BROKER_TOKEN: 'nope' });
    assert.notEqual(bad.code, 0, 'a wrong token is refused');
  } finally {
    broker.stop();
    up.server.close();
  }
});
