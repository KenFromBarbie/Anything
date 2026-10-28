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

test("a channel request carries the channel's history, files included, read from the relay", async (t) => {
  const { b, jim, sent, calls } = await withJim(t);
  const earlier = {
    id: 'old-1', kind: 9, pubkey: OWNER, created_at: 500, content: 'The topic is digital funnels',
    tags: [['h', CHANNEL], ['imeta', 'url https://media.test/ch02.pdf', 'name ch 02.pdf']]
  };
  const run = b.run;
  b.run = async (args, input, who) => {
    if (args[0] === 'messages' && args[1] === 'get') { calls.push({ args, as: who.name }); return [earlier]; }
    return run(args, input, who);
  };
  await b.handleEvent(message(OWNER, { mention: jim.pubkey, content: 'make the slides' }), jim);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /Owner: The topic is digital funnels \[file: ch 02\.pdf https:\/\/media\.test\/ch02\.pdf\]/);
  assert.ok(calls.some((c) => c.args[1] === 'get' && c.as === 'Jim'), 'read as the agent itself');

  // And on demand: buzz-history reads any channel by name.
  const [code, body] = await b.historyAs({ channel: '#general', as: 'jim-1' });
  assert.equal(code, 200);
  assert.equal(body.channel, 'general');
  assert.equal(body.older, 500);
  assert.equal(body.messages.length, 1);
  const [missing] = await b.historyAs({ channel: 'nope', as: 'jim-1' });
  assert.equal(missing, 404);
});

test('files shared in a channel are downloaded into the hive for the agent', async (t) => {
  const { b, jim, sent, calls } = await withJim(t);
  const harness = path.join(b.userData, 'harness');
  fs.writeFileSync(path.join(b.userData, 'config.json'), JSON.stringify({ harnessHome: harness }));
  const hash = 'c'.repeat(64);
  const earlier = {
    id: 'old-2', kind: 9, pubkey: OWNER, created_at: 600, tags: [['h', CHANNEL]],
    content: `the brief: [ch 02.pdf](http://localhost:3002/media/${hash}.pdf)`
  };
  const run = b.run;
  b.run = async (args, input, who) => {
    if (args[0] === 'messages' && args[1] === 'get') return [earlier];
    if (args[0] === 'media' && args[1] === 'get') {
      calls.push({ args, as: who.name });
      fs.writeFileSync(args[args.indexOf('--output') + 1], 'pdf bytes');
      return null;
    }
    return run(args, input, who);
  };
  await b.handleEvent(message(OWNER, { mention: jim.pubkey, content: 'read the brief' }), jim);
  const file = path.join(harness, 'hive', 'shared', 'buzz-files', `cccccccc-ch 02.pdf`);
  assert.equal(fs.readFileSync(file, 'utf8'), 'pdf bytes');
  assert.ok(sent[0].body.includes(`- ch 02.pdf: ${file}`));
  // Cached: a second request doesn't download it again.
  await b.handleEvent(message(OWNER, { mention: jim.pubkey, content: 'again' }), jim);
  assert.equal(calls.filter((c) => c.args[0] === 'media').length, 1);
});

function withHive(b) {
  const harness = path.join(b.userData, 'harness');
  fs.mkdirSync(path.join(harness, 'hive'), { recursive: true });
  fs.writeFileSync(path.join(b.userData, 'config.json'), JSON.stringify({ harnessHome: harness }));
  return path.join(harness, 'hive');
}

function captureStdout(fn) {
  const lines = [];
  const write = process.stdout.write;
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  return Promise.resolve().then(fn).finally(() => { process.stdout.write = write; }).then((r) => [r, lines]);
}

test('buzz-show copies the file into the artifacts and tells the app', async (t) => {
  const { b } = await withJim(t);
  const hive = withHive(b);
  const deck = path.join(b.userData, 'deck.pptx');
  fs.writeFileSync(deck, 'slides');
  const [[code, body], lines] = await captureStdout(() => b.showArtifact({ file: deck, title: 'Funnel deck', as: 'jim-1' }));
  assert.equal(code, 200);
  assert.equal(body.kind, 'office');
  assert.equal(body.markdown, `[Funnel deck](buzz://artifact/${body.id})`, 'a link to put in the reply');
  const index = JSON.parse(fs.readFileSync(path.join(hive, 'shared', 'artifacts', 'index.json'), 'utf8'));
  assert.equal(index[0].agent, 'Jim');
  assert.equal(fs.readFileSync(path.join(hive, 'shared', 'artifacts', index[0].file), 'utf8'), 'slides');
  assert.match(lines.join(''), /^MD_OFFICE_ACTION .*"type":"artifact"/);
  const [missing] = await b.showArtifact({ file: path.join(b.userData, 'nope.pdf'), as: 'jim-1' });
  assert.equal(missing, 400);
  const [notWeb] = await b.showArtifact({ url: 'file:///C:/secret', as: 'jim-1' });
  assert.equal(notWeb, 400);
});

test('buzz-browse asks the app and returns its answer', async (t) => {
  const { b } = await withJim(t);
  const [pending, lines] = await captureStdout(() => {
    const p = b.browse({ op: 'read', as: 'jim-1' });
    return { p };
  });
  const asked = JSON.parse(lines.join('').replace('MD_OFFICE_ACTION ', ''));
  assert.equal(asked.op, 'read');
  b.browseResult({ id: asked.id, result: { url: 'https://example.test/', title: 'Example', text: 'Hello' } });
  const [code, body] = await pending.p;
  assert.equal(code, 200);
  assert.equal(body.text, 'Hello');
  const [bad] = await b.browse({ op: 'open', url: 'javascript:alert(1)' });
  assert.equal(bad, 400);
});

test('the vault mirrors each agent\'s memory and keeps their own notes', async (t) => {
  const { b } = await withJim(t);
  const hive = withHive(b);
  fs.writeFileSync(path.join(b.userData, 'harness', 'roster.json'), JSON.stringify({ agents: [{ id: 'jim-1', name: 'Jim' }] }));
  fs.mkdirSync(path.join(hive, 'agents', 'jim-1'), { recursive: true });
  fs.writeFileSync(path.join(hive, 'agents', 'jim-1', 'memory.md'), 'Owner prefers short decks.');
  const vault = b.syncVaultNow();
  assert.ok(fs.existsSync(path.join(vault, '.obsidian', 'app.json')), 'an Obsidian vault');
  assert.match(fs.readFileSync(path.join(vault, 'Agents', 'Jim', 'Memory.md'), 'utf8'), /Owner prefers short decks/);
  // The hub note is the agent's: a later sync leaves their edits alone.
  fs.writeFileSync(path.join(vault, 'Agents', 'Jim.md'), '# Jim\nOwns [[Projects/Deck]].');
  fs.writeFileSync(path.join(hive, 'agents', 'jim-1', 'memory.md'), 'Owner prefers decks of ten slides.');
  b.syncVaultNow();
  assert.match(fs.readFileSync(path.join(vault, 'Agents', 'Jim.md'), 'utf8'), /Owns \[\[Projects\/Deck\]\]/);
  assert.match(fs.readFileSync(path.join(vault, 'Agents', 'Jim', 'Memory.md'), 'utf8'), /ten slides/);
  assert.match(fs.readFileSync(path.join(vault, 'Agents.md'), 'utf8'), /\[\[Agents\/Michael\|Michael\]\]/);
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

function dmBridge(t) {
  const ctx = bridge(t);
  const run = ctx.b.run;
  ctx.b.run = async (args, input, who) => {
    if (args[0] === 'channels' && args[1] === 'list') return [{ channel_id: 'dm-1', name: 'DM' }, { channel_id: CHANNEL, name: 'general' }];
    return run(args, input, who);
  };
  return ctx;
}

function dm(from, { mention, replyTo, content = 'hi' } = {}) {
  const ev = message(from, { mention, replyTo, content });
  ev.tags[0] = ['h', 'dm-1'];
  return ev;
}

const sendArgs = (calls) => calls.filter((c) => c.args[0] === 'messages' && c.args[1] === 'send').at(-1).args;

test('a DM is answered inline, even though it tags the agent', async (t) => {
  const { b, calls } = dmBridge(t);
  await b.refreshDmChannels(b.michael);
  const ask = dm(OWNER, { mention: b.michael.pubkey });
  assert.equal(b.classify(ask, b.michael).why, 'dm');
  await b.handleEvent(ask, b.michael);
  const [code] = await b.replyAs({ replyTo: ask.id, text: 'Sure, done.' });
  assert.equal(code, 200);
  assert.ok(!sendArgs(calls).includes('--reply-to'), 'inline, not in a thread');
});

test('a long DM answer, or one to a message in a DM thread, goes in the thread', async (t) => {
  const { b, calls } = dmBridge(t);
  await b.refreshDmChannels(b.michael);
  const ask = dm(OWNER);
  await b.handleEvent(ask, b.michael);
  await b.replyAs({ replyTo: ask.id, text: 'x'.repeat(2000) });
  assert.deepEqual(sendArgs(calls).slice(-2), ['--reply-to', ask.id]);

  const inThread = dm(OWNER, { replyTo: 'root-1' });
  await b.handleEvent(inThread, b.michael);
  await b.replyAs({ replyTo: inThread.id, text: 'short' });
  assert.deepEqual(sendArgs(calls).slice(-2), ['--reply-to', 'root-1']);
});

test('a meeting that ended is read by Michael and saved, once', async (t) => {
  const { b, sent } = await withJim(t);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-hive-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(b.userData, 'config.json'), JSON.stringify({ harnessHome: home }));
  const call = 'call-1';
  const jim = b.byAgent('jim-1');
  b.attend(call, jim);
  b.noteMeeting({ id: 'm1', created_at: 1000, pubkey: OWNER, content: 'Jim, draft the menu by Friday.' }, call);
  b.noteMeeting({ id: 'm2', created_at: 1001, pubkey: jim.pubkey, content: 'Will do.' }, call);
  // The call channel is no longer in Jim's list: the meeting is over.
  await b.refreshDmChannels(jim, true);
  const toMichael = sent.filter((m) => m.to === b.michael.agentId && /meeting ended/i.test(m.subject));
  assert.equal(toMichael.length, 1);
  assert.equal(toMichael[0].act, 'request');
  assert.match(toMichael[0].body, /draft the menu/);
  assert.ok(sent.some((m) => m.to === 'jim-1' && m.subject === 'Meeting notes'));
  assert.equal(fs.readdirSync(path.join(home, 'hive', 'meetings')).length, 1);
  await b.refreshDmChannels(jim, true);
  assert.equal(sent.filter((m) => m.to === b.michael.agentId && /meeting ended/i.test(m.subject)).length, 1, 'once');
});
