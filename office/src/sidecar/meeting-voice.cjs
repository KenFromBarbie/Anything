'use strict';
/**
 * Meeting voices: quick spoken answers in the app's meeting room.
 *
 * An agent's own session runs on its own model (Opus) and is slow to answer
 * out loud, so in a meeting each attendee speaks through a "voice": one warm
 * Claude session on a quicker model (MEETING_MODEL), fed the meeting turn by
 * turn. The Claude CLI takes ~10 s to start, so a voice is started as soon as
 * the meeting is seen and kept for the meeting; after that an answer takes a
 * few seconds, and the voice remembers what was said. Real work the owner asks
 * for is handed back to the agent's own session (a `TASK:` line).
 */
const fs = require('node:fs');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

const MEETING_MODEL = 'claude-sonnet-5-5';
/** A voice nobody has spoken to for this long is stopped (the meeting ended). */
const IDLE_MS = 15 * 60 * 1000;
const ANSWER_TIMEOUT_MS = 60 * 1000;
/** Keys that must never reach the CLI's environment. */
const SECRET_ENV = ['BUZZ_PRIVATE_KEY', 'BUZZ_AUTH_TAG', 'BUZZ_OFFICE_AGENT_KEY', 'BUZZ_OFFICE_AGENT_AUTH', 'MD_MASTER_KEY'];

function claudeBin() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const local = join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return fs.existsSync(local) ? local : 'claude';
}

/** The CLI's environment: the Claude account picked in the app's Settings →
 *  AI accounts (what the agents sign in with), and none of the bridge's keys. */
function claudeEnv() {
  const env = { ...process.env };
  for (const k of SECRET_ENV) delete env[k];
  try {
    const home = JSON.parse(fs.readFileSync(process.env.BUZZ_AI_ACCOUNTS_FILE ?? '', 'utf8'))?.claude;
    if (typeof home === 'string' && home && fs.existsSync(home)) env.CLAUDE_CONFIG_DIR = home;
  } catch {
    // No picked account: the computer's own sign-in.
  }
  return env;
}

function systemPrompt(name, chair) {
  return [
    `You are ${name}, one of the AI agents working in the owner's office${chair ? ' (you run the floor and chair meetings)' : ''}.`,
    'You are in a live voice meeting with the owner and some of your colleagues. Everything you say is read aloud.',
    'Each message gives you what was said since your last turn (including what your colleagues just answered), then what was just said to you (by the owner, or a colleague handing over to you).',
    'To hand over to a colleague, say their name: they speak next and hear you. Only name someone when you mean them to go next.',
    'When you should not say their name aloud (say the owner asked for only the number, or a quiet round), hand over silently instead: end with a last line of its own: NEXT: <name>. That line is never read aloud. Always hand over one way or the other while a back-and-forth the owner asked for is still going; when it is done, hand over to no one.',
    'You hear your colleagues: build on what they said, never repeat it. If they already covered it and you have nothing to add, reply with just: PASS',
    'Reply as yourself in one to three short spoken sentences: plain words, no markdown, lists, links or code. Be direct and natural.',
    'Do not pretend to have done work you have not done. If the owner asks you to actually do something (research, build, write, change something), say briefly that you will, and then on a last line of its own write: TASK: <the task in one line, with what they asked for>.',
  ].join('\n');
}

/** The model each agent answers with in calls (`call-models.json` in the
 *  Office's data folder, by agent pubkey, written by the app's call menu);
 *  MEETING_MODEL when none is picked. */
function callModelFor(dataDir, pubkey) {
  try {
    const picked = JSON.parse(fs.readFileSync(join(dataDir, 'call-models.json'), 'utf8'))?.[pubkey];
    if (typeof picked === 'string' && /^[a-z0-9.\-\[\]]+$/i.test(picked)) return picked;
  } catch {
    // Nothing picked yet.
  }
  return MEETING_MODEL;
}

class MeetingVoice {
  constructor({ name, chair, cwd, log, model }) {
    this.name = name;
    this.model = model;
    this.log = log;
    this.queue = Promise.resolve();
    this.waiting = null;
    this.buffer = '';
    this.lastUsed = Date.now();
    this.seen = new Set(); // meeting lines this voice has been told
    this.child = spawn(claudeBin(), [
      '-p', '--model', model,
      '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--no-session-persistence', '--effort', 'low', '--disable-slash-commands',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--append-system-prompt', systemPrompt(name, chair),
    ], { cwd, env: claudeEnv(), windowsHide: true });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.stderr.on('data', () => {});
    this.child.on('exit', () => {
      this.dead = true;
      this.settle(new Error('the meeting voice stopped'));
    });
    this.child.on('error', (e) => {
      this.dead = true;
      this.settle(e);
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.type === 'result') {
        this.settle(m.is_error ? new Error(String(m.result ?? 'error')) : null, String(m.result ?? ''));
      }
    }
  }

  settle(err, value) {
    const w = this.waiting;
    if (!w) return;
    this.waiting = null;
    clearTimeout(w.timer);
    if (err) w.reject(err);
    else w.resolve(value);
  }

  /** One turn: `text` in, the spoken answer out. Turns run one at a time. */
  ask(text) {
    this.lastUsed = Date.now();
    const turn = this.queue.then(() => new Promise((resolve, reject) => {
      if (this.dead) { reject(new Error('the meeting voice stopped')); return; }
      const timer = setTimeout(() => this.settle(new Error('the meeting voice took too long')), ANSWER_TIMEOUT_MS);
      this.waiting = { resolve, reject, timer };
      this.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
    }));
    this.queue = turn.catch(() => {});
    return turn;
  }

  stop() {
    this.dead = true;
    try { this.child.stdin.end(); } catch { /* gone */ }
    try { this.child.kill(); } catch { /* gone */ }
  }
}

/** Every meeting voice, by meeting channel and agent. */
class MeetingVoices {
  constructor({ cwd, log }) {
    this.cwd = cwd;
    this.log = log;
    this.voices = new Map();
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref?.();
  }

  key(channel, agentId) { return `${channel}:${agentId}`; }

  /** The voice for `who` in this meeting, started if it isn't running. */
  voiceFor(channel, who, chair) {
    const key = this.key(channel, who.agentId);
    const model = callModelFor(this.cwd, who.pubkey);
    let voice = this.voices.get(key);
    // A model picked during the call takes over from the next answer on.
    if (voice && !voice.dead && voice.model !== model) {
      voice.stop();
      voice = null;
    }
    if (!voice || voice.dead) {
      voice = new MeetingVoice({ name: who.name, chair, cwd: this.cwd, log: this.log, model });
      this.voices.set(key, voice);
    }
    return voice;
  }

  sweep() {
    for (const [key, voice] of this.voices) {
      if (voice.dead || Date.now() - voice.lastUsed > IDLE_MS) {
        voice.stop();
        this.voices.delete(key);
      }
    }
  }

  stopAll() {
    clearInterval(this.sweeper);
    for (const voice of this.voices.values()) voice.stop();
    this.voices.clear();
  }
}

/** Split an answer into what's said aloud, the task it hands on, and who it
 *  silently hands over to (`NEXT:` lines, never read aloud). */
function splitAnswer(out) {
  const lines = String(out ?? '').split(/\r?\n/);
  let task = '';
  const next = [];
  const spokenLines = [];
  for (const line of lines) {
    if (/^\s*TASK:/i.test(line)) task = line.replace(/^\s*TASK:\s*/i, '').trim();
    else if (/^\s*NEXT:/i.test(line)) next.push(...line.replace(/^\s*NEXT:\s*/i, '').split(/[,&]| and /i).map((n) => n.trim()).filter(Boolean));
    else spokenLines.push(line);
  }
  const spoken = spokenLines.join(' ').replace(/\s+/g, ' ').trim();
  return { spoken, task, next };
}

module.exports = { MeetingVoices, splitAnswer, MEETING_MODEL };
