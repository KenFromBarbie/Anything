'use strict';
/**
 * Buzz bridge: makes the office's agents members of the Buzz workspace the
 * office is hosted in. Michael (the god agent) always; the rest of the floor
 * once Buzz has given each of them an owner-attested identity.
 *
 *   Buzz @Name mention / DM / thread follow-up ──► hive message to that agent
 *   agent reply helper (buzz-reply)            ──► threaded Buzz reply, signed as the agent
 *   agent post helper (buzz-post)              ──► new message in a channel, signed as the agent
 *
 * All relay traffic goes through Buzz's own CLI (`buzz`), which owns the Nostr
 * protocol and signing. Private keys never leave this process: they are held
 * in memory (Michael's falls back to a safeStorage-encrypted file when Buzz
 * doesn't manage him), handed to the CLI per call through the CLI's
 * environment only, and never placed in agent environments or transcripts.
 *
 * Trust: the office runs real agents on this machine, so only the office owner
 * (BUZZ_OFFICE_OWNER, the Buzz identity hosting the office) can task them.
 * The office's own agents can also reach each other, but only by an explicit
 * @mention and only AGENT_HOP_CAP times per thread. Messages from anyone else
 * are ignored. Agents can only reply into threads an office agent was brought
 * into, and only post as themselves.
 *
 * Env (from Buzz's office.rs):
 *   BUZZ_OFFICE_RELAY_URL  relay HTTP base URL
 *   BUZZ_OFFICE_OWNER      owner pubkey (hex)
 *   BUZZ_OFFICE_CLI        path to the `buzz` CLI
 */
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const { join } = require('node:path');
const { execFile } = require('node:child_process');
const { MeetingVoices, splitAnswer } = require('./meeting-voice.cjs');

// The fallback check of each agent's feed. Messages normally arrive at once:
// the app sees them on its live relay connection and says so (poll-now), and
// an agent's own post wakes the floor straight away. This only catches what
// the app can't see (agents' DMs with each other).
const POLL_MS = 8000;
// The conversation memory survives restarts; written at most this often.
const CONTEXT_SAVE_MS = 2000;
const CLI_TIMEOUT_MS = 30000;
const SEEN_CAP = 1000;
const MAX_REPLY_BYTES = 64 * 1024;
const PROFILE = { name: 'Michael', about: 'Runs the Office: an agent floor (Munder Difflin) hosted in Buzz.' };
const AUTO_JOIN = ['general'];
const GOD = 'god';
/** Agent-authored messages relayed per thread before the bridge stops passing
 *  them on (until the owner speaks in that thread again): two agents that keep
 *  @mentioning each other would otherwise loop forever. */
const AGENT_HOP_CAP = 8;
/** stdout line Buzz's office.rs reads: the floor's agents, so Buzz can give
 *  each one an owner-attested identity (sent back on our stdin). */
const ROSTER_PREFIX = 'MD_OFFICE_ROSTER ';

// ─── secp256k1 public key, in plain BigInt ───────────────────────────────────
// Electron's Node is built on BoringSSL, which has no secp256k1 curve, so
// crypto.createECDH('secp256k1') throws there. Deriving a pubkey is a single
// scalar multiplication per identity, so plain affine arithmetic is fine.
const P = 2n ** 256n - 2n ** 32n - 977n;
const G = [
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n
];
const mod = (a) => ((a % P) + P) % P;
function inv(a) {
  let [r, b, e] = [1n, mod(a), P - 2n]; // Fermat: a^(p-2)
  for (; e > 0n; e >>= 1n, b = mod(b * b)) if (e & 1n) r = mod(r * b);
  return r;
}
function addPoints(p, q) {
  if (!p) return q;
  if (!q) return p;
  const [x1, y1] = p;
  const [x2, y2] = q;
  if (x1 === x2 && mod(y1 + y2) === 0n) return null;
  const l = x1 === x2 ? mod(3n * x1 * x1 * inv(2n * y1)) : mod((y2 - y1) * inv(x2 - x1));
  const x3 = mod(l * l - x1 - x2);
  return [x3, mod(l * (x1 - x3) - y1)];
}
/** Nostr pubkey (BIP-340 x-only): the x coordinate of privateKey·G. */
function pubkeyFor(privateKeyHex) {
  let k = BigInt('0x' + privateKeyHex);
  let acc = null;
  for (let pt = G; k > 0n; k >>= 1n, pt = addPoints(pt, pt)) if (k & 1n) acc = addPoints(acc, pt);
  return acc[0].toString(16).padStart(64, '0');
}

function validScalarHex() {
  const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  for (;;) {
    const b = crypto.randomBytes(32);
    const s = BigInt('0x' + b.toString('hex'));
    if (s !== 0n && s < n) return b.toString('hex');
  }
}

class BuzzBridge {
  constructor({ shim, userData, relayUrl, owner, cli, agent = null, log = console }) {
    this.shim = shim;
    this.userData = userData;
    this.relayUrl = relayUrl;
    this.owner = owner.toLowerCase();
    this.cli = cli;
    this.log = log;
    // When Buzz holds Michael's identity it also owns his profile (published
    // with the owner's auth tag), so the bridge must not overwrite it.
    this.managed = Boolean(agent?.key);
    this.michael = { agentId: GOD, name: PROFILE.name, key: agent?.key ?? null, authTag: agent?.authTag ?? null, pubkey: null };
    /** The floor's other agents, by hive agent id, once Buzz has handed us
     *  their identities (setWorkers). */
    this.workers = new Map();
    this.statePath = join(userData, 'buzz-bridge-state.json');
    this.state = this.loadState();
    this.contextPath = join(userData, 'buzz-bridge-context.json');
    this.loadContext();
    this.rosterSent = null;
    this.polling = false;
    this.timer = null;
    this.server = null;
  }

  get pubkey() { return this.michael.pubkey; }
  identities() { return [this.michael, ...this.workers.values()]; }
  byAgent(agentId) { return agentId === GOD ? this.michael : this.workers.get(agentId); }
  byPubkey(pubkey) { return this.identities().find((i) => i.pubkey === pubkey); }

  // ─── identity ──────────────────────────────────────────────────────────────
  michaelKey() {
    if (this.michael.key) return this.michael.key;
    const file = join(this.userData, 'buzz-michael.key');
    const { safeStorage } = this.shim;
    if (!fs.existsSync(file)) {
      // Exclusive create: if another process minted the key first, keep its
      // key and read it below rather than overwriting it with ours.
      try {
        fs.writeFileSync(file, safeStorage.encryptString(validScalarHex()), { mode: 0o600, flag: 'wx' });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
    this.michael.key = safeStorage.decryptString(fs.readFileSync(file));
    return this.michael.key;
  }

  /** Run the Buzz CLI as one of the office's agents (Michael by default). Only
   *  the variables the CLI needs are passed. */
  run(args, input, who = this.michael) {
    const env = {
      BUZZ_PRIVATE_KEY: who === this.michael ? this.michaelKey() : who.key,
      BUZZ_RELAY_URL: this.relayUrl,
      SystemRoot: process.env.SystemRoot ?? '',
      PATH: process.env.PATH ?? ''
    };
    // Owner attestation (NIP-OA) on everything the agent signs.
    if (who.authTag) env.BUZZ_AUTH_TAG = who.authTag;
    return new Promise((resolve, reject) => {
      const child = execFile(this.cli, args, { env, timeout: CLI_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(`buzz ${args[0]} ${args[1] ?? ''} failed: ${(stderr || err.message).toString().slice(0, 300)}`));
          try { resolve(stdout.trim() ? JSON.parse(stdout) : null); }
          catch { resolve(stdout); }
        });
      if (input !== undefined) child.stdin.end(input); else child.stdin.end();
    });
  }

  // ─── state ─────────────────────────────────────────────────────────────────
  // cursors: per agent, the feed position and the event ids already handled.
  // roots:   per Buzz thread root, where it lives and which agents are in it.
  // threads: any event id an agent can reply to → its thread root.
  // hops:    per thread root, agent-authored messages relayed so far.
  loadState() {
    const fresh = () => ({ since: Math.floor(Date.now() / 1000), seen: [] });
    let s = {};
    try { s = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); } catch { /* first run */ }
    const state = { cursors: s.cursors ?? {}, roots: s.roots ?? {}, threads: {}, hops: s.hops ?? {}, profileFor: s.profileFor ?? '', toldPosting: s.toldPosting ?? [] };
    // Older state files: one cursor (Michael's) and thread entries holding the
    // thread itself (an object, or before that just the channel id).
    if (!state.cursors[GOD]) state.cursors[GOD] = s.since !== undefined ? { since: s.since, seen: s.seen ?? [] } : fresh();
    for (const [id, t] of Object.entries(s.threads ?? {})) {
      if (typeof t === 'string' && !s.roots) {
        state.roots[id] ??= { channel: t, threaded: true, agents: [GOD] };
        state.threads[id] = id;
      } else if (t && typeof t === 'object') {
        state.roots[t.root] ??= { channel: t.channel, threaded: t.threaded, agents: [GOD] };
        state.threads[id] = t.root;
      } else {
        state.threads[id] = t;
      }
    }
    return state;
  }
  /** What was said in conversations and meetings, who attended which
   *  meeting, and which meetings were already summed up for their agents. */
  loadContext() {
    let c = {};
    try { c = JSON.parse(fs.readFileSync(this.contextPath, 'utf8')); } catch { /* first run */ }
    this.conversations = new Map(Object.entries(c.conversations ?? {}));
    this.meetingLog = new Map(Object.entries(c.meetings ?? {}));
    this.meetingAttendees = new Map(Object.entries(c.attendees ?? {}).map(([k, v]) => [k, new Set(v)]));
    this.debriefed = new Set(c.debriefed ?? []);
  }
  saveContextNow() {
    const data = {
      conversations: Object.fromEntries(this.conversations),
      meetings: Object.fromEntries(this.meetingLog),
      attendees: Object.fromEntries([...this.meetingAttendees].map(([k, v]) => [k, [...v]])),
      debriefed: [...this.debriefed].slice(-200),
    };
    try {
      const tmp = this.contextPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.contextPath);
    } catch (e) {
      this.log.warn('[buzz-bridge] could not save conversation memory:', e.message);
    }
  }
  saveContext() {
    if (this.contextTimer) return;
    this.contextTimer = setTimeout(() => { this.contextTimer = null; this.saveContextNow(); }, CONTEXT_SAVE_MS);
    this.contextTimer.unref?.();
  }
  cursor(who) {
    return (this.state.cursors[who.agentId] ??= { since: Math.floor(Date.now() / 1000), seen: [] });
  }
  saveState() {
    for (const c of Object.values(this.state.cursors)) c.seen = c.seen.slice(-SEEN_CAP);
    const ids = Object.keys(this.state.threads);
    for (const id of ids.slice(0, Math.max(0, ids.length - SEEN_CAP * 2))) delete this.state.threads[id];
    const live = new Set(Object.values(this.state.threads));
    for (const root of Object.keys(this.state.roots)) {
      if (!live.has(root)) { delete this.state.roots[root]; delete this.state.hops[root]; }
    }
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.statePath);
  }

  /** The thread an event id belongs to, as { root, channel, threaded, agents }. */
  thread(id) {
    const root = this.state.threads[id] ?? (this.state.roots[id] ? id : undefined);
    const entry = root && this.state.roots[root];
    return entry ? { root, ...entry } : null;
  }
  /** Record that `agentId` is in the thread rooted at `root`, reachable via `eventId`. */
  remember(eventId, root, channel, threaded, agentId) {
    const entry = (this.state.roots[root] ??= { channel, threaded, agents: [] });
    if (!entry.agents.includes(agentId)) entry.agents.push(agentId);
    this.state.threads[eventId] = root;
    this.state.threads[root] = root;
  }

  // ─── lifecycle ─────────────────────────────────────────────────────────────
  async start() {
    this.michael.pubkey = pubkeyFor(this.michaelKey());
    const profileKey = `${this.pubkey}|${PROFILE.name}|${PROFILE.about}|${this.relayUrl}`;
    if (!this.managed && this.state.profileFor !== profileKey) {
      await this.run(['users', 'set-profile', '--name', PROFILE.name, '--about', PROFILE.about]);
      this.state.profileFor = profileKey;
      this.saveState();
    }
    await this.joinDefaultChannels(this.michael);
    await this.startReplyServer();
    this.writePostingGuide();
    this.log.log(`[buzz-bridge] Michael is ${this.pubkey.slice(0, 12)}… on ${this.relayUrl}; owner ${this.owner.slice(0, 12)}…; identity ${this.managed ? 'held by Buzz (owner-attested)' : 'local'}`);
    this.timer = setInterval(() => { void this.poll(); }, POLL_MS);
    void this.poll();
  }

  stop() {
    this.voices?.stopAll();
    if (this.contextTimer) { clearTimeout(this.contextTimer); this.contextTimer = null; this.saveContextNow(); }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.server) this.server.close();
    this.server = null;
  }

  async joinDefaultChannels(who) {
    try {
      const channels = await this.run(['channels', 'list'], undefined, who);
      for (const c of Array.isArray(channels) ? channels : []) {
        if (AUTO_JOIN.includes(c.name)) await this.run(['channels', 'join', '--channel', c.channel_id], undefined, who).catch(() => {});
      }
    } catch (e) {
      this.log.warn(`[buzz-bridge] ${who.name} could not join default channels:`, e.message);
    }
  }

  // ─── the floor's other agents ──────────────────────────────────────────────
  /** The floor's agents other than Michael, from `<harnessHome>/roster.json`;
   *  null while it can't be read (e.g. mid-write). */
  readRoster() {
    try {
      const config = JSON.parse(fs.readFileSync(join(this.userData, 'config.json'), 'utf8'));
      if (!config.harnessHome) return [];
      const roster = JSON.parse(fs.readFileSync(join(config.harnessHome, 'roster.json'), 'utf8'));
      return (Array.isArray(roster.agents) ? roster.agents : [])
        .filter((a) => a && typeof a.id === 'string' && a.id !== GOD && !a.isGod && typeof a.name === 'string' && a.name.trim())
        .map((a) => ({ id: a.id, name: a.name.trim().slice(0, 60) }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return null;
    }
  }

  /** Tell Buzz when the floor's agents change, so it can give each its own
   *  owner-attested identity. Only Buzz-managed offices have anyone listening. */
  reportRoster() {
    if (!this.managed) return;
    const agents = this.readRoster();
    if (!agents) return;
    const line = JSON.stringify({ agents });
    if (line === this.rosterSent) return;
    this.rosterSent = line;
    process.stdout.write(`${ROSTER_PREFIX}${line}\n`);
  }

  /** Identities from Buzz for the floor's agents: [{ id, name, key, authTag }]. */
  async setWorkers(list) {
    const next = new Map();
    for (const w of Array.isArray(list) ? list : []) {
      if (!w || typeof w.id !== 'string' || w.id === GOD || !/^[0-9a-f]{64}$/i.test(String(w.key ?? ''))) continue;
      const known = this.workers.get(w.id);
      next.set(w.id, known && known.key === w.key
        ? { ...known, name: String(w.name ?? known.name) }
        : { agentId: w.id, name: String(w.name ?? w.id), key: w.key, authTag: w.authTag ?? null, pubkey: pubkeyFor(w.key), fresh: true });
    }
    this.workers = next;
    for (const w of next.values()) {
      if (!w.fresh) continue;
      w.fresh = false;
      this.cursor(w); // starts at now: never replay old channel history at a new agent
      await this.joinDefaultChannels(w);
      this.log.log(`[buzz-bridge] ${w.name} (${w.agentId}) is ${w.pubkey.slice(0, 12)}… on Buzz`);
    }
    this.saveState();
    this.writePostingGuide();
  }

  /**
   * How every agent posts in the server's channels, kept in the hive as
   * BUZZ.md (each agent's prompt points there). Agents never hold a relay key:
   * they post through buzz-post / buzz-reply, and the office signs as them.
   * Work that didn't arrive from a channel (Michael's kickoff, a staff task)
   * carries no posting note of its own, which left agents trying the raw CLI.
   * Running agents are told once, too.
   */
  writePostingGuide() {
    if (!this.postWrapperPath) return;
    let root;
    try {
      const config = JSON.parse(fs.readFileSync(join(this.userData, 'config.json'), 'utf8'));
      if (!config.harnessHome) return;
      root = join(config.harnessHome, 'hive');
    } catch {
      return;
    }
    const agents = this.identities().filter((i) => i.pubkey).map((i) => `- @${i.name} (${i.agentId})`);
    const guide = [
      '# Posting in the server\'s channels',
      '',
      'You never need a relay key: the office posts for you, signed as you. Never run the `buzz` CLI yourself and never ask the owner for BUZZ_PRIVATE_KEY.',
      '',
      '## Start a post in a channel (by name or id; you join it if needed)',
      'Write the text to a file, then run:',
      '',
      `    ${this.postCommand()} --channel <name> --text-file "<file>"`,
      '',
      '## Answer a message that was delivered to you from a channel',
      'Use the reply command given in that delivery (it carries --reply-to).',
      '',
      '## Mentions',
      'Write @Name in the text to bring an office agent in. Agents who can post:',
      ...agents,
      '',
      'Floor workers hired for a task have no channel identity: they report to whoever hired them, who posts.',
      '',
    ].join('\n');
    try {
      fs.mkdirSync(root, { recursive: true });
      const file = join(root, 'BUZZ.md');
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (old !== guide) {
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, guide);
        fs.renameSync(tmp, file);
      }
    } catch (e) {
      this.log.warn('[buzz-bridge] could not write BUZZ.md:', e.message);
      return;
    }
    const send = this.shim.ipcMain.handlers.get('hive:send');
    if (!send) return;
    this.state.toldPosting ??= [];
    for (const who of this.identities()) {
      if (!who.pubkey || this.state.toldPosting.includes(who.agentId)) continue;
      this.state.toldPosting.push(who.agentId);
      void Promise.resolve(send({ sender: null, senderFrame: null }, {
        to: who.agentId,
        act: 'inform',
        subject: 'How to post in the server\'s channels',
        body: `[OFFICE NOTE] You can post in the server's channels yourself, no key needed: ${this.postCommand()} --channel <name> --text-file "<file>". The full guide is ${join(root, 'BUZZ.md')}. Never run the buzz CLI directly or ask the owner for BUZZ_PRIVATE_KEY. If you were waiting on channel access, carry on now.`,
        requires_reply: false
      }, 'human')).catch(() => {});
    }
    this.saveState();
  }

  // ─── inbound: Buzz messages → hive ─────────────────────────────────────────
  // `mentions` covers @Name in channels; `activity` covers everything else in
  // channels the agent belongs to, which is how DMs and thread follow-ups arrive.
  /** Check every feed now (the app saw a message go out); if a check is
   *  already running, run another right after it. */
  pollNow() {
    if (this.polling) { this.pollAgain = true; return; }
    void this.poll();
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    this.pollAgain = false;
    try {
      this.reportRoster();
      // Every agent at once: one after another, each CLI round trip added to
      // the wait of everyone polled after it.
      await Promise.all(this.identities().map((who) => this.pollFor(who)));
    } finally {
      this.polling = false;
      if (this.pollAgain) { this.pollAgain = false; setTimeout(() => { void this.poll(); }, 0); }
    }
  }

  async pollFor(who) {
    try {
      await this.refreshDmChannels(who);
      const cur = this.cursor(who);
      const since = Math.max(0, cur.since - 5); // small overlap; `seen` de-dupes
      const feed = await this.run(['feed', 'get', '--types', 'mentions,activity', '--since', String(since), '--limit', '100'], undefined, who);
      const events = (Array.isArray(feed) ? feed : []).sort((a, b) => a.created_at - b.created_at);
      for (const ev of events) {
        if (cur.seen.includes(ev.id)) continue;
        const handled = await this.handleEvent(ev, who);
        if (!handled) break; // hive not ready: retry this one (and later ones) next tick
        cur.seen.push(ev.id);
        cur.since = Math.max(cur.since, ev.created_at);
        this.saveState();
      }
    } catch (e) {
      this.log.warn(`[buzz-bridge] poll failed for ${who.name}:`, e.message);
    }
  }

  /** DM channels show up in `channels list` named "DM". Refreshed every 30 s,
   *  and immediately when a message arrives from a channel we haven't listed
   *  yet (a brand-new DM), so its first message isn't misread as channel chat. */
  async refreshDmChannels(who, force = false) {
    if (!force && who.dmChannels && Date.now() - who.dmCheckedAt < 30000) return;
    const channels = await this.run(['channels', 'list'], undefined, who);
    const list = Array.isArray(channels) ? channels : [];
    who.knownChannels = new Set(list.map((c) => c.channel_id));
    who.dmChannels = new Set(list.filter((c) => c.name === 'DM').map((c) => c.channel_id));
    // Voice calls are channels named "… call" ("… huddle" before the rename);
    // what an agent says there is read aloud.
    who.callChannels = new Set(
      list.filter((c) => /(^|\s)(call|huddle)$/i.test(String(c.name ?? '').trim())).map((c) => c.channel_id)
    );
    // The app's meeting room: its calls get quick answers (see answerInMeeting).
    const meetings = list.filter((c) => /^meeting room call$/i.test(String(c.name ?? '').trim()));
    who.meetingChannels = new Set(meetings.map((c) => c.channel_id));
    // A meeting this agent is in: get its voice ready before anyone asks.
    for (const c of list) {
      if (!who.callChannels.has(c.channel_id)) continue;
      if (c.archived_at) {
        if (this.meetingAttendees.has(c.channel_id)) this.debriefMeeting(c.channel_id);
        continue;
      }
      this.warmMeetingVoice(c.channel_id, who);
    }
    who.dmCheckedAt = Date.now();
  }

  /**
   * Why `who` should act on this message, or null to ignore it:
   *   mention  — p-tags the agent (any channel)
   *   dm       — sent in a DM channel the agent is in
   *   followup — a reply in a thread the agent was asked in or answered in
   */
  classify(ev, who) {
    const channel = ev.tags?.find((t) => t[0] === 'h')?.[1];
    if (!channel) return null;
    if (ev.tags.some((t) => t[0] === 'p' && t[1] === who.pubkey)) return { why: 'mention', channel };
    if (who.dmChannels?.has(channel)) return { why: 'dm', channel };
    for (const t of ev.tags) {
      if (t[0] !== 'e') continue;
      const known = this.thread(t[1]);
      if (known?.agents.includes(who.agentId)) return { why: 'followup', channel, root: known.root };
    }
    return null;
  }

  /** The Buzz thread an event sits in (NIP-10 root marker, else its first e tag). */
  threadRootOf(ev) {
    const es = (ev.tags ?? []).filter((t) => t[0] === 'e');
    return (es.find((t) => t[3] === 'root') ?? es[0])?.[1] ?? null;
  }

  /** Returns false only when the hive can't take the message yet. */
  async handleEvent(ev, who, opts = {}) {
    if (ev.kind !== 9) return true;
    const channel = ev.tags?.find((t) => t[0] === 'h')?.[1];
    if (channel && !who.knownChannels?.has(channel)) await this.refreshDmChannels(who, true);
    if (channel && who.callChannels?.has(channel)) this.noteMeeting(ev, channel);
    if (channel) this.noteConversation(ev, channel);
    if (ev.pubkey === who.pubkey) return true;
    const route = this.classify(ev, who);
    if (!route) return true; // ordinary channel chat, not for this agent
    const sender = ev.pubkey.toLowerCase();
    const fromAgent = sender === this.owner ? null : this.byPubkey(sender);
    const hopRoot = route.root ?? this.threadRootOf(ev) ?? ev.id;
    if (sender === this.owner) {
      delete this.state.hops[hopRoot]; // the owner is back in this thread
    } else if (!fromAgent) {
      this.log.log(`[buzz-bridge] ignored a ${route.why} for ${who.name} from non-owner ${ev.pubkey.slice(0, 12)}…`);
      return true;
    } else {
      // The office's own agents reach each other only by an explicit @mention,
      // and only so many times per thread.
      if (route.why !== 'mention') return true;
      const hops = this.state.hops[hopRoot] ?? 0;
      if (hops >= AGENT_HOP_CAP) {
        this.log.log(`[buzz-bridge] not relaying ${fromAgent.name} → ${who.name}: thread hit ${AGENT_HOP_CAP} agent messages`);
        return true;
      }
      this.state.hops[hopRoot] = hops + 1;
    }
    const send = this.shim.ipcMain.handlers.get('hive:send');
    if (!send) return false;
    // In channels the agent answers in the thread; in a DM it answers inline.
    const threaded = route.why !== 'dm';
    const root = route.root ?? ev.id;
    const inCall = !!channel && who.callChannels?.has(channel);
    // A meeting: a call with several of the office's agents (each transcript
    // p-tags all of them). Only who is asked answers, so they don't all talk
    // at once — and the rest aren't woken at all.
    const attendees = inCall
      ? this.identities().filter((i) => i.pubkey && ev.tags.some((t) => t[0] === 'p' && t[1] === i.pubkey))
      : [];
    let meetingNote = null;
    if (attendees.length > 1 && !fromAgent) {
      const text = String(ev.content ?? '').toLowerCase();
      const escape = (w) => w.replace(/[^a-z0-9 ]/g, (c) => String.fromCharCode(92) + c);
      const word = (w) => new RegExp('(^|[^a-z0-9])' + escape(w) + '([^a-z0-9]|$)').test(text);
      const named = attendees.filter((i) => word(i.name.toLowerCase()));
      const everyone = /(^|[^a-z])(everyone|everybody|all of you|team|guys|y'?all)([^a-z]|$)/.test(text);
      const chair = attendees.find((i) => i === this.michael) ?? attendees[0];
      const answering = named.length ? named : everyone ? attendees : [chair];
      if (!answering.includes(who)) return true; // not asked: stays quiet
      const others = attendees.filter((i) => i !== who).map((i) => i.name).join(', ');
      meetingNote = named.length
        ? `You are in a meeting with ${others}, and you were asked by name: answer for yourself.`
        : everyone
          ? `You are in a meeting with ${others}; the owner asked everyone: give your part in one short sentence.`
          : `You are chairing a meeting with ${others}: the owner did not name anyone, so you answer (or say who should, by name).`;
    }
    // In the meeting room the answer comes fast, from a quick model speaking
    // as the agent; real work it's asked for goes on to the agent itself.
    if (inCall && !fromAgent && !opts.asWork && !opts.noFast) {
      void this.answerInMeeting(ev, who, channel, attendees, meetingNote);
      return true;
    }
    const where = inCall && !opts.asWork
      ? 'a live voice call (what the owner said, transcribed)'
      : route.why === 'dm' ? 'a direct message' : route.why === 'followup' ? 'a follow-up in a Buzz thread you are in' : 'a Buzz channel mention';
    const from = fromAgent ? `from ${fromAgent.name}, one of the office's agents` : 'from the office owner';
    const body = [
      `[BUZZ ${fromAgent ? 'MESSAGE' : 'REQUEST'} — ${where}, ${from}. No one is watching this terminal.]`,
      fromAgent
        ? 'Help with what they ask if it is yours to do; otherwise say so in the thread.'
        : 'Handle it as you would any request from the human: do it yourself or route it to the right agent.',
      ...(inCall && !opts.asWork
        ? [
          'You are in a voice call: your reply is read aloud straight away. Answer in one to three short spoken sentences, plain words only (no markdown, lists, links or code), and reply quickly with --in-channel (in the call, not a thread); do longer work afterwards and say so.'
,
          ...(meetingNote ? [meetingNote] : [])
        ]
        : []),
      'When you have a substantive answer (or need a decision), post it back:',
      '  1. write the reply as markdown to a file',
      `  2. run: ${this.replyCommand()} --reply-to ${ev.id} --text-file "<that file>"`,
      ...(threaded
        ? [
          '     That answers in the thread under the message. For a quick answer to a simple question, or when they ask you to reply in the channel (not a thread), add --in-channel to post in the channel itself.'
        ]
        : []),
      'If you delegate, pass that exact command on so the agent can reply itself. Never post a bare "done".',
      `If this becomes board work, record where it came from on every card you make for it: "buzz": {"replyTo": "${ev.id}"}. Questions for the owner about that work are asked in this thread (the command above), not on the card.`,
      ...this.buzzToolsNote(who),
      '',
      ...((() => {
        const before = channel ? this.conversationBefore(ev, channel) : [];
        return before.length
          ? ['', 'The conversation so far (check whether a colleague already answered or finished it before you act):', ...before]
          : [];
      })()),
      '',
      'The message:',
      ev.content
    ].join('\n');
    const result = await send(
      { sender: null, senderFrame: null },
      {
        to: who.agentId,
        act: 'request',
        subject: `Buzz: ${ev.content.replace(/\s+/g, ' ').slice(0, 70)}`,
        body,
        conversation: `buzz-${root}`,
        requires_reply: true
      },
      'human'
    );
    if (!result?.ok) return false;
    this.remember(ev.id, root, route.channel, threaded, who.agentId);
    this.saveState();
    await this.run(['reactions', 'add', '--event', ev.id, '--emoji', '👀'], undefined, who).catch(() => {});
    this.log.log(`[buzz-bridge] delivered ${route.why} ${ev.id.slice(0, 12)}… to ${who.name}${fromAgent ? ` (from ${fromAgent.name})` : ''}`);
    return true;
  }

  /** The conversation an event belongs to: its thread, else its channel. */
  conversationKey(ev, channel) {
    const known = this.thread(this.threadRootOf(ev) ?? '');
    return `${channel}:${known?.root ?? this.threadRootOf(ev) ?? 'top'}`;
  }

  /** Remember a message (owner's or an agent's) in its conversation. */
  noteConversation(ev, channel) {
    const key = this.conversationKey(ev, channel);
    const log = this.conversations.get(key) ?? [];
    if (log.some((l) => l.id === ev.id)) return;
    const pk = String(ev.pubkey ?? '').toLowerCase();
    const name = pk === this.owner ? 'Owner' : (this.byPubkey(pk)?.name ?? 'Someone');
    log.push({ id: ev.id, at: ev.created_at ?? Math.floor(Date.now() / 1000), name, text: String(ev.content ?? '').slice(0, 800) });
    log.sort((a, b) => a.at - b.at);
    this.conversations.set(key, log.slice(-20));
    if (this.conversations.size > 400) this.conversations.delete(this.conversations.keys().next().value);
    this.saveContext();
  }

  /** What was said before `ev` in its conversation, as lines for an agent. */
  conversationBefore(ev, channel) {
    const log = this.conversations?.get(this.conversationKey(ev, channel)) ?? [];
    return log.filter((l) => l.id !== ev.id && l.at <= (ev.created_at ?? Infinity)).slice(-10)
      .map((l) => `${l.name}: ${l.text.replace(/\s+/g, ' ')}`);
  }

  /** What was said in a meeting (owner and agents), for the quick answers. */
  noteMeeting(ev, channel) {
    const log = this.meetingLog.get(channel) ?? [];
    if (log.some((l) => l.id === ev.id)) return;
    const speaker = ev.pubkey.toLowerCase() === this.owner ? 'Owner' : (this.byPubkey(ev.pubkey.toLowerCase())?.name ?? 'Someone');
    log.push({ id: ev.id, at: ev.created_at, name: speaker, text: String(ev.content ?? '').slice(0, 600) });
    log.sort((a, b) => a.at - b.at);
    this.meetingLog.set(channel, log.slice(-60));
    if (this.meetingLog.size > 50) this.meetingLog.delete(this.meetingLog.keys().next().value);
    this.saveContext();
  }

  /** The meeting voices (quick spoken answers; see meeting-voice.cjs). */
  meetingVoices() {
    if (!this.voices) this.voices = new MeetingVoices({ cwd: this.userData, log: this.log });
    return this.voices;
  }

  /** Start `who`'s voice for a meeting as soon as the meeting is seen, so the
   *  first answer doesn't wait for the CLI to start. */
  warmMeetingVoice(channel, who) {
    this.attend(channel, who);
    this.meetingVoices().voiceFor(channel, who, who === this.michael);
  }

  attend(channel, who) {
    const set = this.meetingAttendees.get(channel) ?? new Set();
    if (set.has(who.agentId)) return;
    set.add(who.agentId);
    this.meetingAttendees.set(channel, set);
    this.saveContext();
  }

  /** The tail of an agent's own memory.md (what its working session has
   *  recorded), so its meeting voice knows what it has been doing. */
  workNotes(who) {
    try {
      const config = JSON.parse(fs.readFileSync(join(this.userData, 'config.json'), 'utf8'));
      if (!config.harnessHome) return '';
      const text = fs.readFileSync(join(config.harnessHome, 'hive', 'agents', who.agentId, 'memory.md'), 'utf8');
      return text.length > 3000 ? '…' + text.slice(-3000) : text;
    } catch {
      return '';
    }
  }

  /** A meeting ended (its call channel archived): hand each agent who was in
   *  it what was said, into its working session, so the work that follows
   *  starts from the meeting rather than from nothing. Once per meeting. */
  debriefMeeting(channel) {
    if (this.debriefed.has(channel)) return;
    this.debriefed.add(channel);
    this.saveContext();
    this.meetingVoices().endMeeting?.(channel);
    const log = this.meetingLog.get(channel) ?? [];
    const who = [...(this.meetingAttendees.get(channel) ?? [])];
    const send = this.shim.ipcMain.handlers.get('hive:send');
    if (!log.length || !who.length || !send) return;
    const transcript = log.map((l) => `${l.name}: ${l.text.replace(/\s+/g, ' ')}`).join('\n');
    for (const agentId of who) {
      void Promise.resolve(send({ sender: null, senderFrame: null }, {
        to: agentId,
        act: 'inform',
        subject: 'Meeting notes',
        body: `[MEETING ENDED — what was said, so your work carries on from it. Record anything you agreed to do in your memory.md; do the tasks you took on.]\n\n${transcript.slice(-6000)}`,
        conversation: `meeting-${channel}`,
        requires_reply: false
      }, 'human')).catch(() => {});
    }
    this.log.log(`[buzz-bridge] meeting ${channel.slice(0, 8)} ended; notes sent to ${who.length} agent(s)`);
  }

  /** Answer the owner in the meeting room as `who`, quickly and aloud.
   *  Answers in a meeting take turns (the chair first when several are
   *  asked), so each one hears the replies just given. */
  answerInMeeting(ev, who, channel, attendees, note, from = 'The owner') {
    if (!this.meetingTurns) this.meetingTurns = new Map();
    const enqueue = () => {
      const prev = this.meetingTurns.get(channel) ?? Promise.resolve();
      const turn = prev
        .then(() => this.answerTurn(ev, who, channel, attendees, note, from))
        .catch((e) => this.log.warn('[buzz-bridge] meeting turn failed:', e?.message ?? e));
      this.meetingTurns.set(channel, turn);
      return turn;
    };
    // The chair queues straight away; the others a moment later, so when
    // several are asked at once the chair speaks first.
    if (who === this.michael) return enqueue();
    return new Promise((r) => setTimeout(r, 400)).then(enqueue);
  }

  async answerTurn(ev, who, channel, attendees, note, from = 'The owner') {
    const voice = this.meetingVoices().voiceFor(channel, who, who === this.michael);
    // What was said since this voice last spoke (others' answers, earlier
    // questions), then the question itself.
    const fresh = (this.meetingLog?.get(channel) ?? [])
      .filter((l) => l.id !== ev.id && !voice.seen.has(l.id));
    for (const l of fresh) voice.seen.add(l.id);
    voice.seen.add(ev.id);
    const others = attendees.filter((i) => i !== who).map((i) => i.name);
    this.attend(channel, who);
    // Its first turn: what the agent's working session has been doing.
    let notes = '';
    if (!voice.briefed) {
      voice.briefed = true;
      const memory = this.workNotes(who);
      if (memory.trim()) notes = `Your own work notes (your memory.md, latest last), so you know what you have been doing:\n${memory}\n---`;
    }
    const turn = [
      ...(notes ? [notes] : []),
      others.length ? `In the meeting: the owner, ${others.join(', ')} and you.` : 'In the meeting: the owner and you.',
      ...(note ? [note] : []),
      ...(fresh.length ? ['Said since your last turn:', ...fresh.slice(-12).map((l) => `${l.name}: ${l.text}`)] : []),
      `${from}, to you now: "${String(ev.content ?? '').slice(0, 1500)}"`,
    ].join('\n');
    let out;
    try {
      out = await voice.ask(turn);
    } catch (e) {
      this.log.warn(`[buzz-bridge] meeting answer for ${who.name} failed (${e.message}); passing it on`);
      await this.handleEvent(ev, who, { noFast: true }).catch(() => {});
      return;
    }
    const { spoken: said, task, next } = splitAnswer(out);
    const spoken = /^\W*pass\W*$/i.test(said) ? '' : said; // nothing to add
    if (spoken) {
      const r = await this.run(['messages', 'send', '--channel', channel, '--content', '-'], spoken, who).catch((e) => {
        this.log.warn(`[buzz-bridge] ${who.name} could not speak in the meeting:`, e.message);
        return null;
      });
      if (r?.event_id) {
        this.pollNow();
        voice.seen.add(r.event_id);
        this.noteMeeting({ id: r.event_id, created_at: Math.floor(Date.now() / 1000), pubkey: who.pubkey, content: spoken }, channel);
        const lower = spoken.toLowerCase();
        const escape = (w) => w.replace(/[^a-z0-9 ]/g, (c) => String.fromCharCode(92) + c);
        const silent = next.map((n) => n.toLowerCase());
        const named = attendees.filter((i) => i !== who
          && (silent.includes(i.name.toLowerCase())
            || new RegExp('(^|[^a-z0-9])' + escape(i.name.toLowerCase()) + '([^a-z0-9]|$)').test(lower)));
        if (named.length) {
          const handed = { id: r.event_id, created_at: Math.floor(Date.now() / 1000), pubkey: who.pubkey, content: spoken, tags: ev.tags };
          for (const next of named) {
            void this.answerInMeeting(handed, next, channel, attendees, `${who.name} handed over to you.`, who.name);
          }
        }
      }
    }
    this.log.log(`[buzz-bridge] ${who.name} answered in the meeting${task ? ' and took a task' : ''}`);
    if (task) {
      const content = `From the meeting (you already said you would do this): ${task}\n\nWhat the owner said: ${ev.content}`;
      await this.handleEvent({ ...ev, content }, who, { asWork: true })
        .catch((e) => this.log.warn('[buzz-bridge] meeting task not delivered:', e.message));
    }
  }

  /** How an agent reaches the rest of the floor through Buzz channels. */
  buzzToolsNote(who) {
    const others = this.identities().filter((i) => i !== who && i.pubkey).map((i) => `@${i.name}`);
    return [
      '',
      `You can post in any channel (by name or id; you join it if needed): ${this.postCommand()} --channel <name> --text-file "<file>"`,
      ...(others.length > 0
        ? [`Other office agents: ${others.join(', ')}. Mention one with @Name in a message to bring them in.`]
        : [])
    ];
  }

  // ─── outbound: agent messages → Buzz ───────────────────────────────────────
  replyCommand() {
    return `"${this.wrapperPath.replace(/\\/g, '/')}"`;
  }
  postCommand() {
    return `"${this.postWrapperPath.replace(/\\/g, '/')}"`;
  }

  /** --mention flags for office agents named as @Name in the text, so they are
   *  notified even where the CLI can't resolve the name uniquely. */
  mentionArgs(text, who) {
    const args = [];
    for (const i of this.identities()) {
      if (i === who || !i.pubkey) continue;
      const name = i.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|\\W)@${name}(?![\\w-])`, 'i').test(text)) args.push('--mention', i.pubkey);
    }
    return args;
  }

  /** Reply into a thread an office agent was brought into: as the calling agent
   *  when it is one of the office's (in a DM, as the agent the DM is with). */
  async replyAs(msg) {
    const replyTo = String(msg.replyTo ?? '');
    const text = String(msg.text ?? '').trim();
    const thread = this.thread(replyTo);
    if (!thread) return [403, { ok: false, error: 'unknown thread: only messages delivered to an office agent can be answered' }];
    if (!text) return [400, { ok: false, error: 'empty reply' }];
    let who = this.byAgent(String(msg.as ?? '')) ?? this.byAgent(thread.agents[0]) ?? this.michael;
    if (!thread.threaded && !thread.agents.includes(who.agentId)) who = this.byAgent(thread.agents[0]) ?? this.michael;
    if (!thread.agents.includes(who.agentId)) {
      await this.run(['channels', 'join', '--channel', thread.channel], undefined, who).catch(() => {});
    }
    const args = ['messages', 'send', '--channel', thread.channel, '--content', '-', ...this.mentionArgs(text, who)];
    // In a channel the answer goes in the thread, unless the agent answers in
    // the channel itself (--in-channel: a quick answer, or when asked to).
    const inChannel = msg.inChannel === true;
    if (thread.threaded && !inChannel) args.push('--reply-to', thread.root);
    const r = await this.run(args, text, who);
    // Replying to the agent's own message counts as a follow-up in this thread.
    if (r?.event_id) {
      this.remember(r.event_id, thread.root, thread.channel, thread.threaded, who.agentId);
      this.saveState();
      this.noteConversation({ id: r.event_id, created_at: Math.floor(Date.now() / 1000), pubkey: who.pubkey,
        content: text, tags: [['h', thread.channel], ['e', thread.root, '', 'root']] }, thread.channel);
      const send = this.shim.ipcMain.handlers.get('hive:send');
      for (const agentId of thread.agents) {
        if (agentId === who.agentId || !send) continue;
        void Promise.resolve(send({ sender: null, senderFrame: null }, {
          to: agentId,
          act: 'inform',
          subject: `${who.name} replied in a thread you're in`,
          body: `[BUZZ UPDATE — ${who.name} replied in a Buzz thread you were also asked in. No reply needed; use it to avoid repeating or redoing their work.]\n\n${text.slice(0, 1500)}`,
          conversation: `buzz-${thread.root}`,
          requires_reply: false
        }, 'human')).catch(() => {});
      }
    }
    if (r?.event_id) this.pollNow();
    return [200, { ok: true, eventId: r?.event_id, as: who.name }];
  }

  /** Start a conversation in a channel (by name or id), as the calling agent. */
  async postAs(msg) {
    const who = this.byAgent(String(msg.as ?? ''));
    if (!who) return [403, { ok: false, error: 'only office agents with a Buzz identity can post (is this agent on the floor?)' }];
    const text = String(msg.text ?? '').trim();
    const wanted = String(msg.channel ?? '').trim().replace(/^#/, '');
    if (!text) return [400, { ok: false, error: 'empty message' }];
    if (!wanted) return [400, { ok: false, error: '--channel <name or id> is required' }];
    const channels = await this.run(['channels', 'list'], undefined, who);
    const list = Array.isArray(channels) ? channels : [];
    const c = list.find((x) => x.channel_id === wanted) ?? list.find((x) => x.name === wanted && x.name !== 'DM');
    if (!c) return [404, { ok: false, error: `no channel "${wanted}"` }];
    await this.run(['channels', 'join', '--channel', c.channel_id], undefined, who).catch(() => {});
    const r = await this.run(['messages', 'send', '--channel', c.channel_id, '--content', '-', ...this.mentionArgs(text, who)], text, who);
    if (r?.event_id) {
      this.remember(r.event_id, r.event_id, c.channel_id, true, who.agentId);
      this.saveState();
    }
    if (r?.event_id) this.pollNow();
    return [200, { ok: true, eventId: r?.event_id, channel: c.name, as: who.name }];
  }

  async startReplyServer() {
    const token = crypto.randomBytes(24).toString('base64url');
    this.server = http.createServer((req, res) => {
      const done = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const route = req.method === 'POST' ? { '/reply': 'reply', '/post': 'post' }[req.url] : undefined;
      if (!route) return done(404, { ok: false, error: 'not found' });
      const given = Buffer.from(String(req.headers['x-md-buzz-token'] ?? ''));
      const want = Buffer.from(token);
      if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return done(401, { ok: false, error: 'unauthorized' });
      let size = 0;
      const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_REPLY_BYTES) req.destroy(); else chunks.push(c); });
      req.on('end', async () => {
        let msg;
        try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return done(400, { ok: false, error: 'invalid JSON' }); }
        try {
          const [code, body] = await (route === 'reply' ? this.replyAs(msg) : this.postAs(msg));
          done(code, body);
        } catch (e) {
          done(502, { ok: false, error: e.message });
        }
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    const config = join(this.userData, 'buzz-reply.json');
    fs.writeFileSync(config, JSON.stringify({ port: this.server.address().port, token }), { mode: 0o600 });
    this.wrapperPath = this.writeWrapper(config, 'buzz-reply');
    this.postWrapperPath = this.writeWrapper(config, 'buzz-post');
  }

  /** Launcher agents call (`buzz-reply`, `buzz-post`); runs the helper on our runtime. */
  writeWrapper(config, name) {
    const bin = join(this.userData, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const helper = join(__dirname, 'md-buzz-reply.cjs');
    if (process.platform === 'win32') {
      const p = join(bin, `${name}.cmd`);
      fs.writeFileSync(p, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${helper}" --config "${config}" %*\r\n`);
      return p;
    }
    const p = join(bin, name);
    fs.writeFileSync(p, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${helper}" --config "${config}" "$@"\n`, { mode: 0o755 });
    return p;
  }
}

/** Start the bridge if the shell configured one. Never throws: the office works without it. */
async function startBuzzBridge(shim, log = console, agent = null) {
  const { BUZZ_OFFICE_RELAY_URL: relayUrl, BUZZ_OFFICE_OWNER: owner, BUZZ_OFFICE_CLI: cli } = process.env;
  if (!relayUrl || !owner || !cli) {
    log.log('[buzz-bridge] not configured (no relay/owner/cli); Michael stays local');
    return null;
  }
  const bridge = new BuzzBridge({ shim, userData: shim.app.getPath('userData'), relayUrl, owner, cli, agent, log });
  try {
    await bridge.start();
    return bridge;
  } catch (e) {
    log.warn('[buzz-bridge] failed to start:', e.message);
    bridge.stop();
    return null;
  }
}

module.exports = { startBuzzBridge, BuzzBridge, pubkeyFor };
