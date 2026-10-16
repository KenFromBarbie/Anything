/**
 * The Buzz bridge with several office agents: who can reach whom, and who a
 * message is posted as. The Buzz CLI is stubbed; nothing touches a relay.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { BuzzBridge, pubkeyFor } = require('../src/sidecar/buzz-bridge.cjs');

const OWNER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const MICHAEL_KEY = '1'.repeat(64);
const JIM_KEY = '2'.repeat(64);
const PAM_KEY = '3'.repeat(64);
const CHANNEL = 'chan-general';

function bridge(t) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-buzz-bridge-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const sent = [];
  const handlers = new Map([['hive:send', async (_e, msg) => { sent.push(msg); return { ok: true }; }]]);
  const b = new BuzzBridge({
    shim: { ipcMain: { handlers } },
    userData,
    relayUrl: 'http://relay.test',
    owner: OWNER,
    cli: 'buzz',
    agent: { key: MICHAEL_KEY, authTag: 'tag-michael' },
    log: { log() {}, warn() {} }
  });
  const calls = [];
  let nextEvent = 0;
  b.run = async (args, input, who = b.michael) => {
    calls.push({ args, input, as: who.name });
    if (args[0] === 'channels' && args[1] === 'list') return [{ channel_id: CHANNEL, name: 'general' }];
    if (args[0] === 'messages' && args[1] === 'send') return { event_id: `posted-${++nextEvent}` };
    return null;
  };
  b.michael.pubkey = pubkeyFor(MICHAEL_KEY);
  b.wrapperPath = path.join(userData, 'bin', 'buzz-reply.cmd');
  b.postWrapperPath = path.join(userData, 'bin', 'buzz-post.cmd');
  return { b, sent, calls };
}

let seq = 0;
function message(from, { mention, replyTo, content = 'hello' } = {}) {
  const tags = [['h', CHANNEL]];
  if (mention) tags.push(['p', mention]);
  if (replyTo) tags.push(['e', replyTo, '', 'root']);
  return { id: `ev-${++seq}`, kind: 9, pubkey: from, created_at: 1000 + seq, tags, content };
}

async function withJim(t) {
  const ctx = bridge(t);
  await ctx.b.setWorkers([{ id: 'jim-1', name: 'Jim', key: JIM_KEY, authTag: 'tag-jim' }]);
  const jim = ctx.b.byAgent('jim-1');
  for (const who of ctx.b.identities()) await ctx.b.refreshDmChannels(who);
  return { ...ctx, jim };
}

test('a floor agent gets an identity and joins #general as itself', async (t) => {
  const { b, jim, calls } = await withJim(t);
  assert.equal(jim.pubkey, pubkeyFor(JIM_KEY));
  assert.equal(b.byPubkey(jim.pubkey), jim);
  assert.ok(calls.some((c) => c.args[0] === 'channels' && c.args[1] === 'join' && c.as === 'Jim'));
});

test("the owner's @mention of a floor agent reaches that agent's inbox", async (t) => {
  const { b, jim, sent } = await withJim(t);
  assert.equal(await b.handleEvent(message(OWNER, { mention: jim.pubkey }), jim), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'jim-1');
  assert.match(sent[0].body, /from the office owner/);
  assert.match(sent[0].body, /@Michael/, 'tells the agent who else is on Buzz');
});

test('a stranger cannot task an office agent', async (t) => {
  const { b, jim, sent } = await withJim(t);
  await b.handleEvent(message(STRANGER, { mention: jim.pubkey }), jim);
  await b.handleEvent(message(STRANGER, { mention: b.michael.pubkey }), b.michael);
  assert.equal(sent.length, 0);
});

test('office agents reach each other by @mention only, up to the hop cap', async (t) => {
  const { b, jim, sent } = await withJim(t);
  // Michael asks Jim in a thread.
  const ask = message(b.michael.pubkey, { mention: jim.pubkey });
  await b.handleEvent(ask, jim);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /from Michael, one of the office's agents/);
  // Michael posting in Jim's thread without mentioning him is not relayed.
  await b.handleEvent(message(b.michael.pubkey, { replyTo: ask.id }), jim);
  assert.equal(sent.length, 1);
  // Mentions keep coming in the same thread: relayed up to the cap, then dropped.
  for (let i = 0; i < 12; i++) await b.handleEvent(message(b.michael.pubkey, { mention: jim.pubkey, replyTo: ask.id }), jim);
  assert.equal(sent.length, 8, 'eight agent messages per thread');
  // The owner speaking in the thread lets the agents carry on.
  await b.handleEvent(message(OWNER, { replyTo: ask.id }), jim);
  await b.handleEvent(message(b.michael.pubkey, { mention: jim.pubkey, replyTo: ask.id }), jim);
  assert.equal(sent.length, 10);
});

test('a delegated agent replies in the thread as itself, not as Michael', async (t) => {
  const { b, calls } = await withJim(t);
  const ask = message(OWNER, { mention: b.michael.pubkey });
  await b.handleEvent(ask, b.michael);
  const [code, body] = await b.replyAs({ replyTo: ask.id, text: 'On it. @Michael FYI', as: 'jim-1' });
  assert.equal(code, 200);
  assert.equal(body.as, 'Jim');
  const send = calls.find((c) => c.args[0] === 'messages' && c.args[1] === 'send');
  assert.equal(send.as, 'Jim');
  assert.deepEqual(send.args.slice(send.args.indexOf('--reply-to'), send.args.indexOf('--reply-to') + 2), ['--reply-to', ask.id]);
  assert.ok(send.args.includes('--mention') && send.args.includes(b.michael.pubkey), '@Michael is notified');
  // Jim is now in that thread: the owner's follow-up reaches him too.
  assert.ok(b.thread(ask.id).agents.includes('jim-1'));
});

test('an agent without a Buzz identity replies as the agent the thread was delivered to', async (t) => {
  const { b, calls } = await withJim(t);
  const ask = message(OWNER, { mention: b.michael.pubkey });
  await b.handleEvent(ask, b.michael);
  const [code, body] = await b.replyAs({ replyTo: ask.id, text: 'done: see PR', as: 'pam-9' });
  assert.equal(code, 200);
  assert.equal(body.as, 'Michael');
  assert.equal(calls.filter((c) => c.args[1] === 'send').at(-1).as, 'Michael');
});

test('replies only go to threads an office agent was brought into', async (t) => {
  const { b } = await withJim(t);
  const [code] = await b.replyAs({ replyTo: 'never-delivered', text: 'hi', as: 'jim-1' });
  assert.equal(code, 403);
});

test('buzz-post starts a channel conversation as the calling agent, and only for office agents', async (t) => {
  const { b, calls } = await withJim(t);
  const [denied] = await b.postAs({ channel: 'general', text: 'hi', as: 'not-on-the-floor' });
  assert.equal(denied, 403);
  const [code, body] = await b.postAs({ channel: '#general', text: '@Michael the build is green', as: 'jim-1' });
  assert.equal(code, 200);
  assert.equal(body.as, 'Jim');
  const send = calls.filter((c) => c.args[1] === 'send').at(-1);
  assert.equal(send.as, 'Jim');
  assert.ok(send.args.includes(CHANNEL));
  assert.ok(send.args.includes(b.michael.pubkey));
  // Its own new thread: a reply from the owner there reaches Jim.
  assert.ok(b.thread(body.eventId).agents.includes('jim-1'));
});

test('the floor is reported to Buzz once per change, Michael excluded', async (t) => {
  const { b } = bridge(t);
  const harness = path.join(b.userData, 'harness');
  fs.mkdirSync(harness);
  fs.writeFileSync(path.join(b.userData, 'config.json'), JSON.stringify({ harnessHome: harness }));
  const roster = { agents: [{ id: 'god', name: 'Michael', isGod: true }, { id: 'jim-1', name: 'Jim' }] };
  fs.writeFileSync(path.join(harness, 'roster.json'), JSON.stringify(roster));
  const lines = [];
  const write = process.stdout.write;
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  try {
    b.reportRoster();
    b.reportRoster();
    roster.agents.push({ id: 'pam-2', name: 'Pam' });
    fs.writeFileSync(path.join(harness, 'roster.json'), JSON.stringify(roster));
    b.reportRoster();
  } finally {
    process.stdout.write = write;
  }
  assert.deepEqual(lines, [
    'MD_OFFICE_ROSTER {"agents":[{"id":"jim-1","name":"Jim"}]}\n',
    'MD_OFFICE_ROSTER {"agents":[{"id":"jim-1","name":"Jim"},{"id":"pam-2","name":"Pam"}]}\n'
  ]);
});

test('identities from Buzz replace the floor; departed agents stop being served', async (t) => {
  const { b } = await withJim(t);
  await b.setWorkers([{ id: 'pam-2', name: 'Pam', key: PAM_KEY, authTag: 'tag-pam' }]);
  assert.equal(b.byAgent('jim-1'), undefined);
  assert.equal(b.byAgent('pam-2').pubkey, pubkeyFor(PAM_KEY));
  await b.setWorkers([{ id: 'bad', name: 'Bad', key: 'not-a-key' }]);
  assert.equal(b.workers.size, 0, 'malformed identities are ignored');
});
