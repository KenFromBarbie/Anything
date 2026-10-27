'use strict';
/**
 * Post to Buzz as the calling office agent, via the office's buzz bridge.
 * Agents call it through the generated `buzz-reply` / `buzz-post` wrappers:
 *
 *   buzz-reply --reply-to <event id> --text-file reply.md
 *   buzz-reply --reply-to <event id> --text "short reply"
 *   buzz-reply --reply-to <event id> --in-channel --text-file reply.md  (answer in the channel itself, not the thread)
 *   echo "reply" | buzz-reply --reply-to <event id>
 *   buzz-post --channel general --text-file message.md     (new conversation)
 *   buzz-history --channel general [--limit 100] [--before <unix time>]  (read a channel)
 *   buzz-history --thread <event id>                        (read a thread)
 *
 * The agent is identified by the AGENT_ID the hive gives every agent terminal;
 * agents without a Buzz identity of their own reply as the agent the thread was
 * delivered to. Mention other office agents with @Name in the text.
 *
 * Prints {"ok":true,...} or {"ok":false,"error":...}; exits non-zero on failure.
 */
const fs = require('node:fs');
const http = require('node:http');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(error) {
  process.stdout.write(JSON.stringify({ ok: false, error }) + '\n');
  process.exit(1);
}

async function readText() {
  if (arg('--text') !== undefined) return arg('--text');
  if (arg('--text-file')) return fs.readFileSync(arg('--text-file'), 'utf8');
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

(async () => {
  const replyTo = arg('--reply-to');
  const channel = arg('--channel');
  const configPath = arg('--config');
  const history = process.argv.includes('--history');
  const thread = arg('--thread');
  if (history ? !channel && !thread : !replyTo && !channel) {
    fail(history
      ? '--channel <name> (channel history) or --thread <event id> (a thread) is required'
      : '--reply-to <event id> (reply in a thread) or --channel <name> (new message) is required');
  }
  if (!configPath) fail('--config is required (use the buzz-reply / buzz-post / buzz-history wrapper)');
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { fail('buzz bridge is not running'); }
  const text = history ? '' : (await readText()).trim();
  if (!history && !text) fail('message text is empty');

  const as = process.env.AGENT_ID || undefined;
  const path = history ? '/history' : replyTo ? '/reply' : '/post';
  const inChannel = process.argv.includes('--in-channel');
  const body = JSON.stringify(history
    ? { channel, thread, limit: arg('--limit'), before: arg('--before'), as }
    : replyTo ? { replyTo, text, as, inChannel } : { channel, text, as });
  const req = http.request({
    host: '127.0.0.1',
    port: config.port,
    path,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-md-buzz-token': config.token }
  }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const out = Buffer.concat(chunks).toString('utf8');
      // History reads as plain lines (one message each), not JSON.
      if (history && res.statusCode === 200) {
        try {
          const r = JSON.parse(out);
          const more = r.older ? `\n(older messages: add --before ${r.older})` : '';
          process.stdout.write(`#${r.channel}\n${r.messages.join('\n') || '(no messages)'}${more}\n`);
          process.exit(0);
        } catch { /* print it as it came */ }
      }
      process.stdout.write(out + '\n');
      process.exit(res.statusCode === 200 ? 0 : 1);
    });
  });
  req.on('error', (e) => fail(`buzz bridge unreachable: ${e.message}`));
  req.end(body);
})();
