#!/usr/bin/env node
/**
 * `buzz-composio`: agents use the owner's Composio apps (Gmail, GitHub, Slack,
 * Notion, …) through the office's loopback integration broker. The agent never
 * holds the Composio API key: it sends its per-agent capability token
 * (MD_BROKER_TOKEN, a handle, not a secret) to MD_BROKER_URL, and the broker
 * adds the key the owner saved in Settings → Integrations.
 *
 *   buzz-composio apps                       connected apps (toolkit, status)
 *   buzz-composio search <words> [--app x]   find tools
 *   buzz-composio schema <TOOL_SLUG>         a tool's inputs
 *   buzz-composio run <TOOL_SLUG> '<json>'   run it (or --args-file <file>)
 */
'use strict';

const fs = require('node:fs');

const INTEGRATION = process.env.MD_COMPOSIO_ID || 'composio';
const API = '/api/v3.1';

function die(msg, code = 1) {
  process.stderr.write(`buzz-composio: ${msg}\n`);
  process.exit(code);
}

async function call(method, path, body) {
  const base = process.env.MD_BROKER_URL;
  const token = process.env.MD_BROKER_TOKEN;
  if (!base || !token) {
    die('Composio isn\'t available to you: the owner hasn\'t turned it on in the office\'s Settings → Integrations (or you were started before they did).');
  }
  const res = await fetch(`${base}/i/${encodeURIComponent(INTEGRATION)}${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const why = json?.error?.message || json?.error || json?.message || text.slice(0, 400);
    if (res.status === 403 || res.status === 404 && /integration/.test(String(why))) {
      die(`Composio is turned off or not set up (${typeof why === 'string' ? why : JSON.stringify(why)}). Ask the owner to add it in Settings → Integrations.`);
    }
    die(`${res.status}: ${typeof why === 'string' ? why : JSON.stringify(why)}`);
  }
  return json;
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

async function accounts() {
  const r = await call('GET', '/connected_accounts?limit=200');
  return Array.isArray(r.items) ? r.items : [];
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args.shift();
  if (!cmd || cmd === 'help' || cmd === '--help') {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 12).join('\n').replace(/^ \*\s?/gm, '') + '\n');
    return;
  }
  if (cmd === 'apps') {
    const items = await accounts();
    if (!items.length) {
      console.log('No apps connected yet. The owner connects apps in their Composio dashboard (composio.dev).');
      return;
    }
    for (const a of items) console.log(`${a.toolkit?.slug ?? '?'}\t${a.status ?? ''}\t${a.id}`);
    return;
  }
  if (cmd === 'search') {
    const app = flag(args, '--app');
    const q = args.join(' ').trim();
    const params = new URLSearchParams({ limit: '25' });
    if (q) params.set('query', q);
    if (app) params.set('toolkit_slug', app.toLowerCase());
    const r = await call('GET', `/tools?${params}`);
    const items = Array.isArray(r.items) ? r.items : [];
    if (!items.length) return console.log('No tools found.');
    for (const t of items) {
      console.log(`${t.slug}\t${t.toolkit?.slug ?? ''}\t${String(t.description ?? t.name ?? '').replace(/\s+/g, ' ').slice(0, 140)}`);
    }
    return;
  }
  if (cmd === 'schema') {
    const slug = args[0];
    if (!slug) die('usage: buzz-composio schema <TOOL_SLUG>');
    const t = await call('GET', `/tools/${encodeURIComponent(slug)}`);
    console.log(JSON.stringify({ slug: t.slug, toolkit: t.toolkit?.slug, description: t.description, input_parameters: t.input_parameters }, null, 2));
    return;
  }
  if (cmd === 'run') {
    const file = flag(args, '--args-file');
    const account = flag(args, '--account');
    const slug = args.shift();
    if (!slug) die('usage: buzz-composio run <TOOL_SLUG> \'<json arguments>\' (or --args-file <file>)');
    let argsJson = {};
    const raw = file ? fs.readFileSync(file, 'utf8') : args.join(' ').trim();
    if (raw) {
      try { argsJson = JSON.parse(raw); } catch (e) { die(`the arguments aren't valid JSON: ${e.message}`); }
    }
    // Use the owner's connected account for the tool's app.
    const tool = await call('GET', `/tools/${encodeURIComponent(slug)}`);
    const toolkit = tool.toolkit?.slug;
    const items = await accounts();
    const acct = account
      ? items.find((a) => a.id === account)
      : items.find((a) => a.toolkit?.slug === toolkit && a.status === 'ACTIVE');
    if (!acct && !account) {
      die(`${toolkit ?? 'that app'} isn't connected. Ask the owner to connect it in their Composio dashboard, then try again.`);
    }
    const body = { arguments: argsJson, connected_account_id: acct?.id ?? account };
    if (acct?.user_id) body.user_id = acct.user_id;
    const r = await call('POST', `/tools/execute/${encodeURIComponent(slug)}`, body);
    console.log(JSON.stringify(r.successful === false ? { successful: false, error: r.error } : r.data ?? r, null, 2));
    if (r.successful === false) process.exit(2);
    return;
  }
  die(`unknown command "${cmd}" (apps, search, schema, run)`);
}

main().catch((e) => die(e?.message || String(e)));
