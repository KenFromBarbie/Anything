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
const { syncVault } = require('./vault.cjs');

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
const PROFILE = { name: 'Michael', about: 'Runs the Office: splits your requests between the staff and brings back one answer.' };
const AUTO_JOIN = ['general'];
const GOD = 'god';
/** A DM reply longer than this (characters) is posted as a thread under the
 *  message instead of inline. */
const LONG_DM_REPLY = 1200;

/** Agent-authored messages relayed per thread before the bridge stops passing
 *  them on (until the owner speaks in that thread again): two agents that keep
 *  @mentioning each other would otherwise loop forever. */
const AGENT_HOP_CAP = 8;
/** Channel history handed to an agent with each delivery (messages), and the
 *  most `buzz-history` returns in one call. */
const HISTORY_ON_DELIVERY = 25;
const HISTORY_MAX = 100;
/** Characters of history text per delivery / per message. */
const HISTORY_CHARS = 12000;
const HISTORY_MESSAGE_CHARS = 1200;
/** Shared files downloaded for an agent per delivery / history read. */
const MAX_FILES_PER_DELIVERY = 10;
/** stdout line Buzz's office.rs reads: the floor's agents, so Buzz can give
 *  each one an owner-attested identity (sent back on our stdin). */
const ROSTER_PREFIX = 'MD_OFFICE_ROSTER ';
/** Things for the app to do for an agent (show an artifact, drive the
 *  Browser), one JSON line each on stdout; browser results come back on stdin. */
const ACTION_PREFIX = 'MD_OFFICE_ACTION ';
const BROWSE_TIMEOUT_MS = 60000;
const ARTIFACTS_KEPT = 500;
/** How often the vault's mirrors (agents' memory, meetings) are refreshed. */
const VAULT_SYNC_MS = 3 * 60_000;
/** What the app's viewer does with a file, by extension. */
const ARTIFACT_KINDS = {
  pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio',
  html: 'html', htm: 'html', md: 'text', txt: 'text', csv: 'text', json: 'text',
  pptx: 'office', ppt: 'office', docx: 'office', doc: 'office', xlsx: 'office', xls: 'office', odp: 'office', odt: 'office'
};

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
    const state = { cursors: s.cursors ?? {}, roots: s.roots ?? {}, threads: {}, hops: s.hops ?? {}, profileFor: s.profileFor ?? '', toldPosting: s.toldPosting ?? [], toldHistory: s.toldHistory ?? [], toldDesk: s.toldDesk ?? [], toldDesk2: s.toldDesk2 ?? [], toldVault: s.toldVault ?? [] };
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
    this.vaultTimer = setInterval(() => this.syncVaultNow(), VAULT_SYNC_MS);
    this.vaultTimer.unref?.();
    void this.poll();
  }

  /** Keep the office's Obsidian vault (vault.cjs) and its mirrors current. */
  syncVaultNow() {
    const hive = this.hiveDir();
    if (!hive) return null;
    try {
      const floor = [{ id: GOD, name: this.michael.name }, ...(this.readRoster() ?? [])];
      return syncVault(hive, floor);
    } catch (e) {
      this.log.warn('[buzz-bridge] could not update the vault:', e.message);
      return null;
    }
  }

  stop() {
    this.voices?.stopAll();
    if (this.contextTimer) { clearTimeout(this.contextTimer); this.contextTimer = null; this.saveContextNow(); }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.vaultTimer) clearInterval(this.vaultTimer);
    this.vaultTimer = null;
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
    const vault = this.syncVaultNow();
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
      '## Read a channel\'s message history',
      'Before acting on a channel request, read what was said there (files and links the owner shared earlier are listed too):',
      '',
      `    ${this.historyCommand()} --channel <name> [--limit ${HISTORY_MAX}] [--before <older from the last call>]`,
      `    ${this.historyCommand()} --thread <event id>`,
      '',
      '## Show the owner what you made (the app’s Artifacts page)',
      'Decks, documents, videos, images, PDFs or a site you built: publish each finished piece (and each new version) so the owner sees it in the app. Make a PDF of any PPTX/DOCX and pass it as --preview so it can be viewed in the app.',
      'It prints a markdown link (`[Title](buzz://artifact/<id>)`): always put that link in your reply or post about the work, so the owner opens it straight from the chat.',
      '',
      `    ${this.showCommand()} --file "<path>" --title "<what it is>" [--preview "<pdf>"] [--note "<one line>"]`,
      `    ${this.showCommand()} --url <http address> --title "<what it is>"`,
      '',
      '## The app’s Browser',
      'Open a page in the app for the owner to look at (a site you built, a reference), and read back its text and links to check it:',
      '',
      `    ${this.browseCommand()} --open <url>`,
      `    ${this.browseCommand()} --read          (what the Browser shows now: address, title, text, links)`,
      `    ${this.browseCommand()} --back | --reload`,
      '',
      ...(vault
        ? [
          '## The office vault (shared, linked memory)',
          `${vault} is an Obsidian vault every agent shares. Keep your own memory.md as before; also write what the office should remember (projects, people, decisions, sources) as linked notes there, with [[wikilinks]]. Read ${join(vault, 'Home.md')} first for how it is organised.`,
          'Its knowledge graph (graphify) is in graphify-out/: read GRAPH_REPORT.md, or query it with `graphify query "<question>" --graph graphify-out/graph.json` run in the vault.',
          ''
        ]
        : []),
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
    this.state.toldHistory ??= [];
    for (const who of this.identities()) {
      if (!who.pubkey || this.state.toldHistory.includes(who.agentId)) continue;
      this.state.toldHistory.push(who.agentId);
      void Promise.resolve(send({ sender: null, senderFrame: null }, {
        to: who.agentId,
        act: 'inform',
        subject: 'How to read a channel\'s history',
        body: `[OFFICE NOTE] You can read any channel's message history, including files and links shared there: ${this.historyCommand()} --channel <name> (or --thread <event id>). Channel requests now come with the recent messages before them too. The guide is ${join(root, 'BUZZ.md')}.`,
        requires_reply: false
      }, 'human')).catch(() => {});
    }
    this.state.toldVault ??= [];
    for (const who of this.identities()) {
      if (!vault || !who.pubkey || this.state.toldVault.includes(who.agentId)) continue;
      this.state.toldVault.push(who.agentId);
      void Promise.resolve(send({ sender: null, senderFrame: null }, {
        to: who.agentId,
        act: 'inform',
        subject: 'The office vault',
        body: `[OFFICE NOTE] The office now has a shared Obsidian vault: ${vault}. Keep your memory.md as before (it is mirrored into the vault); also record what the office should remember as linked notes there with [[wikilinks]]. Read ${join(vault, 'Home.md')} for how it is organised. Its knowledge graph (graphify) is in graphify-out/.`,
        requires_reply: false
      }, 'human')).catch(() => {});
    }
    // (toldDesk2: the note now asks for the artifact's link in replies.)
    this.state.toldDesk2 ??= [];
    for (const who of this.identities()) {
      if (!who.pubkey || this.state.toldDesk2.includes(who.agentId)) continue;
      this.state.toldDesk2.push(who.agentId);
      void Promise.resolve(send({ sender: null, senderFrame: null }, {
        to: who.agentId,
        act: 'inform',
        subject: 'Show your work in the app',
        body: `[OFFICE NOTE] Publish what you make for the owner (decks, documents, videos, images, sites) to the app's Artifacts page: ${this.showCommand()} --file "<path>" --title "<what it is>" (with --preview "<pdf>" for a PPTX/DOCX). It prints a markdown link: put it in your reply when you finish, so the owner can open the artifact from the chat. Open pages in the app's Browser for the owner and read them back: ${this.browseCommand()} --open <url> / --read. Details in ${join(root, 'BUZZ.md')}.`,
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
    // A meeting this agent was in that's gone from its list has ended: the
    // list leaves archived channels out, so an ended call never shows up as
    // archived here, and waiting for that meant nobody got the notes.
    // (Only from a list that came back: a failed one would end every meeting.)
    if (Array.isArray(channels)) {
      for (const [channel, attendees] of this.meetingAttendees) {
        if (attendees.has(who.agentId) && !who.knownChannels.has(channel)) this.debriefMeeting(channel);
      }
    }
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
    // A DM first: its messages p-tag the agent too, and a mention is answered
    // in a thread, where a DM is a conversation answered inline (unless the
    // owner wrote inside a thread there).
    if (who.dmChannels?.has(channel)) {
      const inThread = this.threadRootOf(ev);
      return inThread ? { why: 'dm', channel, root: inThread, inThread: true } : { why: 'dm', channel };
    }
    if (ev.tags.some((t) => t[0] === 'p' && t[1] === who.pubkey)) return { why: 'mention', channel };
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
    // In channels the agent answers in the thread; in a DM it answers inline
    // (in its thread when the owner wrote in one; long answers get a thread).
    const threaded = route.why !== 'dm' || route.inThread === true;
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
      : route.why === 'dm' ? 'a direct message' : route.why === 'followup' ? 'a follow-up in a channel thread you are in' : 'a channel mention';
    const from = fromAgent ? `from ${fromAgent.name}, one of the office's agents` : 'from the office owner';
    const body = [
      `[CHANNEL ${fromAgent ? 'MESSAGE' : 'REQUEST'} — ${where}, ${from}. No one is watching this terminal.]`,
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
      `When you made something for this (a deck, document, video, image, site), publish each piece with ${this.showCommand()} --file "<path>" --title "<what it is>" and put the markdown link it prints in your reply, so the owner can open it from the chat.`,
      `If this becomes board work, record where it came from on every card you make for it: "buzz": {"replyTo": "${ev.id}"}. Questions for the owner about that work are asked in this thread (the command above), not on the card.`,
      ...this.buzzToolsNote(who),
      '',
      ...(await (async () => {
        // The channel's (or thread's) own history, read from the relay; what
        // the bridge saw itself if that fails.
        const before = channel
          ? (await this.historyBefore(ev, channel, who).catch(() => null)) ?? this.conversationBefore(ev, channel)
          : [];
        return before.length
          ? ['', `Earlier in this ${this.threadRootOf(ev) ? 'thread' : 'channel'} (oldest first; check whether a colleague already answered or finished it before you act). For more: ${this.historyCommand()} --channel ${channel}`, ...before]
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
        subject: `Channel: ${ev.content.replace(/\s+/g, ' ').slice(0, 70)}`,
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

  /** The messages before `ev` in its thread (when it's in one), else in its
   *  channel, read from the relay as `who`: lines for the delivery. */
  async historyBefore(ev, channel, who) {
    const root = this.threadRootOf(ev);
    const events = root
      ? await this.run(['messages', 'thread', '--channel', channel, '--event', ev.id, '--limit', String(HISTORY_MAX)], undefined, who)
      : await this.run(['messages', 'get', '--channel', channel, '--limit', String(HISTORY_ON_DELIVERY + 1),
        '--before', String(ev.created_at ?? Math.floor(Date.now() / 1000))], undefined, who);
    if (!Array.isArray(events)) return null;
    const before = events.filter((e) => e.id !== ev.id && (e.created_at ?? 0) <= (ev.created_at ?? Infinity)).slice(-HISTORY_ON_DELIVERY);
    return [...this.historyLines(before), ...await this.fileLines([...before, ev], who)];
  }

  /** Channel events as readable lines, oldest first: when, who, what (and any
   *  files), cut to HISTORY_CHARS from the newest end. */
  historyLines(events) {
    const lines = [...events]
      .filter((e) => String(e.content ?? '').trim() || e.tags?.some((t) => t[0] === 'imeta'))
      .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))
      .map((e) => {
        const pk = String(e.pubkey ?? '').toLowerCase();
        const name = pk === this.owner ? 'Owner' : (this.byPubkey(pk)?.name ?? `Member ${pk.slice(0, 8)}`);
        const when = new Date((e.created_at ?? 0) * 1000).toISOString().slice(0, 16).replace('T', ' ');
        const reply = e.tags?.some((t) => t[0] === 'e') ? ' (in a thread)' : '';
        const files = (e.tags ?? []).filter((t) => t[0] === 'imeta').map((t) => {
          const part = (key) => t.find((p) => typeof p === 'string' && p.startsWith(key + ' '))?.slice(key.length + 1);
          return `[file: ${part('name') ?? part('alt') ?? 'attachment'} ${part('url') ?? ''}]`.replace(' ]', ']');
        });
        let text = String(e.content ?? '').replace(/\s+/g, ' ').trim();
        if (text.length > HISTORY_MESSAGE_CHARS) text = text.slice(0, HISTORY_MESSAGE_CHARS) + '…';
        return `[${when} UTC] ${name}${reply}: ${[text, ...files].filter(Boolean).join(' ')}`;
      });
    let total = 0;
    const kept = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      total += lines[i].length + 1;
      if (total > HISTORY_CHARS) break;
      kept.unshift(lines[i]);
    }
    return kept;
  }

  /** Files shared in these events, as { name, url }: attachments (imeta tags)
   *  and links to the relay's own media in the text. */
  sharedFiles(events) {
    const files = new Map();
    for (const e of events) {
      for (const t of e.tags ?? []) {
        if (t[0] !== 'imeta') continue;
        const part = (key) => t.find((p) => typeof p === 'string' && p.startsWith(key + ' '))?.slice(key.length + 1);
        const url = part('url');
        if (url && !files.has(url)) files.set(url, { url, name: part('name') ?? part('alt') ?? url.split('/').pop() });
      }
      const link = /\[([^\]]*)\]\((https?:\/\/[^)\s]+\/media\/[0-9a-f]{64}(?:\.[a-z0-9]+)?)\)|(https?:\/\/[^\s)<>]+\/media\/[0-9a-f]{64}(?:\.[a-z0-9]+)?)/gi;
      for (const m of String(e.content ?? '').matchAll(link)) {
        const url = m[2] ?? m[3];
        if (!files.has(url)) files.set(url, { url, name: m[1] || url.split('/').pop() });
      }
    }
    return [...files.values()];
  }

  /** Download shared files into the hive (`shared/buzz-files`), where every
   *  agent can open them: the media store needs a signed request agents can't
   *  make. Cached by content hash. Returns [{ name, path }] for those fetched. */
  async downloadFiles(files, who) {
    let dir;
    try {
      const config = JSON.parse(fs.readFileSync(join(this.userData, 'config.json'), 'utf8'));
      if (!config.harnessHome) return [];
      dir = join(config.harnessHome, 'hive', 'shared', 'buzz-files');
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return [];
    }
    const out = [];
    for (const f of files.slice(-MAX_FILES_PER_DELIVERY)) {
      const hash = /\/media\/([0-9a-f]{64})/i.exec(f.url)?.[1];
      if (!hash) continue;
      const ext = /\.[a-z0-9]+$/i.exec(f.url)?.[0] ?? '';
      let safe = String(f.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || hash.slice(0, 12);
      if (ext && !safe.toLowerCase().endsWith(ext.toLowerCase())) safe += ext;
      const path = join(dir, `${hash.slice(0, 8)}-${safe}`);
      try {
        if (!fs.existsSync(path)) {
          await this.run(['media', 'get', f.url, '--output', path + '.part'], undefined, who);
          fs.renameSync(path + '.part', path);
        }
        out.push({ name: f.name, path });
      } catch (e) {
        try { fs.rmSync(path + '.part', { force: true }); } catch { /* nothing to clean */ }
        this.log.warn(`[buzz-bridge] could not download ${f.name}: ${e.message}`);
      }
    }
    return out;
  }

  /** Lines listing the files shared in `events`, downloaded for the agent. */
  async fileLines(events, who) {
    const files = await this.downloadFiles(this.sharedFiles(events), who);
    return files.length
      ? ['', 'Files shared here, downloaded for you (open them from these paths; the links above need a key you don\'t have):',
        ...files.map((f) => `- ${f.name}: ${f.path}`)]
      : [];
  }

  /** A channel's (or a thread's) message history, for `buzz-history`, read as
   *  the calling agent (Michael for floor workers without an identity). */
  async historyAs(msg) {
    const who = this.byAgent(String(msg.as ?? '')) ?? this.michael;
    const wanted = String(msg.channel ?? '').trim().replace(/^#/, '');
    const threadOf = String(msg.thread ?? '').trim();
    const limit = Math.min(HISTORY_MAX, Math.max(1, Number(msg.limit) || 50));
    let channelId = threadOf ? this.thread(threadOf)?.channel : undefined;
    let name = channelId;
    if (!channelId) {
      if (!wanted) return [400, { ok: false, error: '--channel <name or id> (or --thread <event id>) is required' }];
      const channels = await this.run(['channels', 'list'], undefined, who);
      const list = Array.isArray(channels) ? channels : [];
      const c = list.find((x) => x.channel_id === wanted) ?? list.find((x) => x.name === wanted && x.name !== 'DM');
      if (!c) return [404, { ok: false, error: `no channel "${wanted}"` }];
      channelId = c.channel_id;
      name = c.name;
    }
    const before = Number(msg.before) || undefined;
    const events = threadOf
      ? await this.run(['messages', 'thread', '--channel', channelId, '--event', threadOf, '--limit', String(limit)], undefined, who)
      : await this.run(['messages', 'get', '--channel', channelId, '--limit', String(limit),
        ...(before ? ['--before', String(before)] : [])], undefined, who);
    const list = Array.isArray(events) ? events : [];
    const oldest = Math.min(...list.map((e) => e.created_at ?? Infinity));
    return [200, {
      ok: true,
      channel: name,
      // Pass as --before to page further back.
      ...(Number.isFinite(oldest) && !threadOf ? { older: oldest } : {}),
      messages: [...this.historyLines(list), ...await this.fileLines(list, who)]
    }];
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
    if (!log.length || !send) return;
    const transcript = log.map((l) => `${l.name}: ${l.text.replace(/\s+/g, ' ')}`).join('\n');
    const saved = this.saveMeetingNotes(channel, log, transcript);
    // Michael runs the floor: he reads every meeting, whether he was in it or
    // not, and sees to it that what was agreed gets done.
    if (this.michael) {
      void Promise.resolve(send({ sender: null, senderFrame: null }, {
        to: this.michael.agentId,
        act: 'request',
        subject: 'A meeting ended: follow up',
        body: [
          '[MEETING ENDED — read what was said and follow up. No one is watching this terminal.]',
          '1. Record the decisions and who took on what in your memory.md.',
          '2. Every task agreed in the meeting needs an owner: put it on the board and hand it to the right agent (or do it yourself), unless whoever took it on already has.',
          '3. Post a short summary for the owner (decisions, who does what, what is still open) in the channel the work belongs to, or the general channel.',
          saved ? `The notes are saved at ${saved}.` : '',
          '',
          'What was said:',
          transcript.slice(-8000)
        ].filter(Boolean).join('\n'),
        conversation: `meeting-${channel}`,
        requires_reply: false
      }, 'human')).catch(() => {});
    }
    for (const agentId of who) {
      if (agentId === this.michael?.agentId) continue;
      void Promise.resolve(send({ sender: null, senderFrame: null }, {
        to: agentId,
        act: 'inform',
        subject: 'Meeting notes',
        body: `[MEETING ENDED — what was said, so your work carries on from it. Record anything you agreed to do in your memory.md; do the tasks you took on.]\n\n${transcript.slice(-6000)}`,
        conversation: `meeting-${channel}`,
        requires_reply: false
      }, 'human')).catch(() => {});
    }
    this.log.log(`[buzz-bridge] meeting ${channel.slice(0, 8)} ended; notes to Michael and ${who.length} attendee(s)`);
  }

  /** Keep a meeting's notes in the hive (`hive/meetings/<when>.md`), where the
   *  agents can read them again; returns the file, or null. */
  saveMeetingNotes(channel, log, transcript) {
    try {
      const config = JSON.parse(fs.readFileSync(join(this.userData, 'config.json'), 'utf8'));
      if (!config.harnessHome) return null;
      const dir = join(config.harnessHome, 'hive', 'meetings');
      fs.mkdirSync(dir, { recursive: true });
      const started = new Date((log[0]?.at ?? Date.now() / 1000) * 1000);
      const stamp = started.toISOString().slice(0, 16).replace(/[T:]/g, '-');
      const file = join(dir, `${stamp}-${channel.slice(0, 8)}.md`);
      const people = [...new Set(log.map((l) => l.name))].join(', ');
      fs.writeFileSync(file, `# Meeting, ${started.toLocaleString()}\n\nWho spoke: ${people}\n\n${transcript}\n`);
      return file;
    } catch (e) {
      this.log.warn('[buzz-bridge] saving meeting notes failed:', e?.message ?? e);
      return null;
    }
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
      `When you make something for the owner (a deck, document, video, image, a site), show it in the app's Artifacts page: ${this.showCommand()} --file "<path>" --title "<what it is>" (add --preview "<pdf>" for a PPTX/DOCX; --url <address> for a site).`,
      `Open a web page in the app's Browser for the owner, or read back what it shows: ${this.browseCommand()} --open <url> | --read | --back | --reload`,
      `You can read any channel's history (newest 50; --limit up to ${HISTORY_MAX}, --before <older> pages back, --thread <event id> reads a thread): ${this.historyCommand()} --channel <name>`,
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
  historyCommand() {
    return `"${String(this.historyWrapperPath ?? 'buzz-history').replace(/\\/g, '/')}"`;
  }
  showCommand() {
    return `"${String(this.showWrapperPath ?? 'buzz-show').replace(/\\/g, '/')}"`;
  }
  browseCommand() {
    return `"${String(this.browseWrapperPath ?? 'buzz-browse').replace(/\\/g, '/')}"`;
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
    // A DM answer is inline, like a chat; a long one goes in a thread under
    // the message so the conversation stays readable.
    else if (!thread.threaded && text.length > LONG_DM_REPLY) args.push('--reply-to', thread.root);
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
          body: `[CHANNEL UPDATE — ${who.name} replied in a channel thread you were also asked in. No reply needed; use it to avoid repeating or redoing their work.]\n\n${text.slice(0, 1500)}`,
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
    if (!who) return [403, { ok: false, error: 'only office agents with a channel identity can post (is this agent on the floor?)' }];
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

  /** The hive folder (`<harnessHome>/hive`), or null before setup. */
  hiveDir() {
    try {
      const config = JSON.parse(fs.readFileSync(join(this.userData, 'config.json'), 'utf8'));
      return config.harnessHome ? join(config.harnessHome, 'hive') : null;
    } catch {
      return null;
    }
  }

  /** Who an agent is, for the owner: its channel name, else its hive id. */
  agentName(agentId) {
    return this.byAgent(agentId)?.name ?? this.readRoster()?.find((a) => a.id === agentId)?.name ?? (agentId || 'An agent');
  }

  /** `buzz-show`: publish something an agent made to the app's Artifacts page.
   *  A file is copied into `shared/artifacts/<id>/` (so later edits to the
   *  working copy don't change what was shown); a URL is listed as a site. */
  async showArtifact(msg) {
    const hive = this.hiveDir();
    if (!hive) return [503, { ok: false, error: 'the Office is not set up yet' }];
    const file = String(msg.file ?? '').trim();
    const url = String(msg.url ?? '').trim();
    if (!file && !url) return [400, { ok: false, error: '--file <path> or --url <address> is required' }];
    if (url && !/^https?:\/\//i.test(url)) return [400, { ok: false, error: 'only http(s) addresses can be shown' }];
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const root = join(hive, 'shared', 'artifacts');
    const entry = {
      id,
      title: String(msg.title ?? '').trim().slice(0, 140),
      note: String(msg.note ?? '').trim().slice(0, 1000),
      agentId: String(msg.as ?? ''),
      agent: this.agentName(String(msg.as ?? '')),
      createdAt: Date.now()
    };
    const copy = (from, label) => {
      const src = require('node:path').resolve(from);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new Error(`no file at ${src} (${label})`);
      const name = require('node:path').basename(src);
      fs.mkdirSync(join(root, id), { recursive: true });
      fs.copyFileSync(src, join(root, id, name));
      return `${id}/${name}`;
    };
    try {
      if (file) {
        entry.file = copy(file, '--file');
        const ext = entry.file.split('.').pop().toLowerCase();
        entry.kind = ARTIFACT_KINDS[ext] ?? 'file';
        if (msg.preview) entry.preview = copy(String(msg.preview), '--preview');
      } else {
        entry.url = url;
        entry.kind = 'site';
      }
    } catch (e) {
      return [400, { ok: false, error: e.message }];
    }
    entry.title ||= (entry.file ? entry.file.split('/').pop() : url);
    const indexPath = join(root, 'index.json');
    let list = [];
    try { list = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { /* first one */ }
    if (!Array.isArray(list)) list = [];
    list.push(entry);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(indexPath + '.tmp', JSON.stringify(list.slice(-ARTIFACTS_KEPT), null, 2));
    fs.renameSync(indexPath + '.tmp', indexPath);
    process.stdout.write(`${ACTION_PREFIX}${JSON.stringify({ type: 'artifact', artifact: entry })}\n`);
    const link = `buzz://artifact/${id}`;
    return [200, {
      ok: true, id, title: entry.title, kind: entry.kind, link,
      // What the agent should put in its reply: the owner clicks it in chat.
      markdown: `[${entry.title.replace(/[[\]]/g, '')}](${link})`
    }];
  }

  /** `buzz-browse`: open a page in the app's Browser for the owner, or read
   *  back what it shows. The app does it and answers on our stdin. */
  async browse(msg) {
    const op = String(msg.op ?? 'open');
    if (!['open', 'read', 'back', 'reload'].includes(op)) return [400, { ok: false, error: `unknown action "${op}"` }];
    const url = String(msg.url ?? '').trim();
    if (op === 'open' && !/^https?:\/\//i.test(url)) return [400, { ok: false, error: '--open needs an http(s) address' }];
    const id = crypto.randomBytes(8).toString('hex');
    this.browsing ??= new Map();
    const result = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.browsing.delete(id);
        resolve({ ok: false, error: 'the app did not answer (is Anything open?)' });
      }, BROWSE_TIMEOUT_MS);
      timer.unref?.();
      this.browsing.set(id, (r) => { clearTimeout(timer); resolve(r); });
    });
    process.stdout.write(`${ACTION_PREFIX}${JSON.stringify({ type: 'browse', id, op, url, agent: this.agentName(String(msg.as ?? '')) })}\n`);
    const r = await result;
    return [r.ok === false ? 502 : 200, r];
  }

  /** The app's answer to a browse request (from the launcher's stdin). */
  browseResult(msg) {
    const done = this.browsing?.get(String(msg.id ?? ''));
    if (!done) return;
    this.browsing.delete(String(msg.id));
    done(msg.error ? { ok: false, error: String(msg.error) } : { ok: true, ...(msg.result ?? {}) });
  }

  async startReplyServer() {
    const token = crypto.randomBytes(24).toString('base64url');
    this.server = http.createServer((req, res) => {
      const done = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const route = req.method === 'POST' ? { '/reply': 'reply', '/post': 'post', '/history': 'history', '/show': 'show', '/browse': 'browse' }[req.url] : undefined;
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
          const handler = { reply: this.replyAs, post: this.postAs, history: this.historyAs, show: this.showArtifact, browse: this.browse }[route];
          const [code, body] = await handler.call(this, msg);
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
    this.historyWrapperPath = this.writeWrapper(config, 'buzz-history', '--history');
    this.showWrapperPath = this.writeWrapper(config, 'buzz-show', '--show');
    this.browseWrapperPath = this.writeWrapper(config, 'buzz-browse', '--browse');
  }

  /** Launcher agents call (`buzz-reply`, `buzz-post`, `buzz-history`); runs the
   *  helper on our runtime. */
  writeWrapper(config, name, mode = '') {
    const bin = join(this.userData, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const helper = join(__dirname, 'md-buzz-reply.cjs');
    const flag = mode ? ` ${mode}` : '';
    if (process.platform === 'win32') {
      const p = join(bin, `${name}.cmd`);
      fs.writeFileSync(p, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${helper}" --config "${config}"${flag} %*\r\n`);
      return p;
    }
    const p = join(bin, name);
    fs.writeFileSync(p, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${helper}" --config "${config}"${flag} "$@"\n`, { mode: 0o755 });
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
