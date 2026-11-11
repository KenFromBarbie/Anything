#!/usr/bin/env node
/**
 * `buzz-feedback`: agents say how an office tool worked for them, so the
 * owner and the office know what to fix or improve.
 *
 *   buzz-feedback --tool simkit --rating works|rough|broken --what "<what happened>" [--fix "<what would help>"]
 *   buzz-feedback --list [--tool simkit]     known problems and fixes so far
 *
 * Kept in <hive>/feedback/tool-feedback.jsonl, with a summary at
 * <hive>/feedback/FEEDBACK.md that agents read before using a tool.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function die(msg) {
  process.stderr.write(`buzz-feedback: ${msg}\n`);
  process.exit(1);
}

function hiveRoot(args) {
  if (process.env.HIVE_ROOT) return process.env.HIVE_ROOT;
  const i = args.indexOf('--config');
  if (i >= 0) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(args[i + 1]), 'config.json'), 'utf8'));
      if (cfg.harnessHome) return path.join(cfg.harnessHome, 'hive');
    } catch { /* fall through */ }
  }
  return null;
}

function opt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const RATINGS = ['works', 'rough', 'broken'];

function readAll(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/** The summary agents and the owner read. */
function summarize(entries) {
  const byTool = new Map();
  for (const e of entries) {
    const t = byTool.get(e.tool) ?? { works: 0, rough: 0, broken: 0, issues: [] };
    t[e.rating] = (t[e.rating] ?? 0) + 1;
    if (e.rating !== 'works') t.issues.push(e);
    byTool.set(e.tool, t);
  }
  const lines = [
    '# Tool feedback',
    '',
    'What agents said about the office\'s tools (newest problems first). Read the section for a tool before you use it: a known problem may already have a workaround.',
    ''
  ];
  const tools = [...byTool.entries()].sort((a, b) => (b[1].broken * 3 + b[1].rough) - (a[1].broken * 3 + a[1].rough));
  for (const [tool, t] of tools) {
    lines.push(`## ${tool} (${t.works} works · ${t.rough} rough · ${t.broken} broken)`);
    for (const e of t.issues.slice(-8).reverse()) {
      lines.push(`- ${e.rating.toUpperCase()} ${e.ts.slice(0, 10)} ${e.agent}: ${e.what}${e.fix ? ` — would help: ${e.fix}` : ''}`);
    }
    if (!t.issues.length) lines.push('- No problems reported.');
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const root = hiveRoot(args);
  if (!root) die('the office folder is not known (HIVE_ROOT is not set)');
  const dir = path.join(root, 'feedback');
  const log = path.join(dir, 'tool-feedback.jsonl');
  if (args.includes('--list')) {
    const tool = opt(args, '--tool');
    const all = readAll(log).filter((e) => !tool || e.tool === tool);
    process.stdout.write(all.length ? summarize(all) + '\n' : 'No feedback yet.\n');
    return;
  }
  const tool = (opt(args, '--tool') ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 40);
  const rating = (opt(args, '--rating') ?? '').trim().toLowerCase();
  const what = (opt(args, '--what') ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const fix = (opt(args, '--fix') ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!tool || !RATINGS.includes(rating) || !what) {
    die('usage: buzz-feedback --tool <name> --rating works|rough|broken --what "<what happened>" [--fix "<what would help>"]');
  }
  fs.mkdirSync(dir, { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    agent: process.env.AGENT_NAME || process.env.AGENT_ID || 'agent',
    agentId: process.env.AGENT_ID || '',
    tool,
    rating,
    what,
    ...(fix ? { fix } : {})
  };
  fs.appendFileSync(log, JSON.stringify(entry) + '\n');
  fs.writeFileSync(path.join(dir, 'FEEDBACK.md'), summarize(readAll(log)));
  process.stdout.write(`Thanks: noted for ${tool} (${rating}).\n`);
}

main();
