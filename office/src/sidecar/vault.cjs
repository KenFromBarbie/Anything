'use strict';
/**
 * The office's Obsidian vault: `<hive>/vault`, linked markdown notes the
 * agents keep alongside their own memory files.
 *
 *   Home.md                 how the vault is organised (the agents read it)
 *   Agents/<Name>.md        each agent's hub note (theirs to write)
 *   Agents/<Name>/Memory.md mirror of hive/agents/<id>/memory.md (regenerated)
 *   Meetings/               mirror of hive/meetings (regenerated)
 *   Projects/, People/, Topics/, Daily/   the agents' notes
 *   graphify-out/           the knowledge graph graphify builds from it
 *
 * The current memory system is unchanged: memory.md stays each agent's
 * working memory, and is mirrored in so the vault's graph links it with
 * everything else. Mirrors are only rewritten when their source changes.
 */
const fs = require('node:fs');
const { join } = require('node:path');

const MIRROR_NOTE = '<!-- Mirrored by the office from the agent\'s memory.md: edits here are overwritten. -->';

const HOME = `# Office vault

The office's shared, linked notes: an Obsidian vault. Every agent can read
and write it. Open this folder in Obsidian to browse it and see its graph.

## How to write here
- One note per thing worth remembering: a project, a person, a decision, a
  topic, a source. Name the file after it (\`Projects/Marketing deck.md\`).
- Link generously with [[wikilinks]] to the notes it relates to (people,
  projects, meetings, agents). The links are what make the graph useful.
- Start each note with frontmatter: \`tags\`, \`updated\` (a date), and
  \`by\` (your name). Add to a note rather than making a duplicate; search
  first.
- Facts and decisions, not chat logs. Say where something came from (a
  channel, a meeting note, a file).
- Daily notes go in \`Daily/YYYY-MM-DD.md\`, linked to what happened.

## Folders
- [[Agents]]: each agent's hub note, plus a mirror of its working memory
  (\`Agents/<Name>/Memory.md\`, regenerated from memory.md; don't edit it).
- Meetings: notes of finished meetings (mirrored from the hive).
- Projects, People, Topics, Daily: the agents' notes.

## The knowledge graph
graphify builds a graph of this vault into \`graphify-out/\` (graph.html to
view, GRAPH_REPORT.md to read, graph.json to query). Before answering from
memory on something broad, check the report or run \`graphify query "<question>"
--graph graphify-out/graph.json\` from this folder.
`;

const OBSIDIAN_APP = { alwaysUpdateLinks: true, newLinkFormat: 'shortest', useMarkdownLinks: false };
const OBSIDIAN_GRAPH = { showTags: true, showAttachments: false, colorGroups: [
  { query: 'path:Agents', color: { a: 1, rgb: 15105570 } },
  { query: 'path:Meetings', color: { a: 1, rgb: 3447003 } },
  { query: 'path:Projects', color: { a: 1, rgb: 3066993 } },
  { query: 'path:People', color: { a: 1, rgb: 10181046 } }
] };

/** A note's file name from a display name (no path separators or reserved characters). */
function noteName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f#^[\]]/g, '_').trim().slice(0, 80) || 'Unnamed';
}

function writeIfChanged(path, text) {
  try {
    if (fs.readFileSync(path, 'utf8') === text) return false;
  } catch { /* new */ }
  fs.writeFileSync(path + '.tmp', text);
  fs.renameSync(path + '.tmp', path);
  return true;
}

function writeIfMissing(path, text) {
  if (fs.existsSync(path)) return false;
  fs.writeFileSync(path, text);
  return true;
}

/**
 * Make sure the vault exists and its mirrors are current.
 * `agents` is [{ id, name }] for everyone on the floor (Michael included).
 * Returns the vault's path.
 */
function syncVault(hive, agents) {
  const vault = join(hive, 'vault');
  for (const dir of ['', '.obsidian', 'Agents', 'Meetings', 'Projects', 'People', 'Topics', 'Daily']) {
    fs.mkdirSync(join(vault, dir), { recursive: true });
  }
  writeIfMissing(join(vault, 'Home.md'), HOME);
  writeIfMissing(join(vault, '.obsidian', 'app.json'), JSON.stringify(OBSIDIAN_APP, null, 2));
  writeIfMissing(join(vault, '.obsidian', 'graph.json'), JSON.stringify(OBSIDIAN_GRAPH, null, 2));

  const hubs = [];
  for (const agent of agents) {
    const name = noteName(agent.name);
    hubs.push(name);
    fs.mkdirSync(join(vault, 'Agents', name), { recursive: true });
    writeIfMissing(join(vault, 'Agents', `${name}.md`), [
      '---',
      'tags: [agent]',
      `agent-id: ${agent.id}`,
      '---',
      `# ${agent.name}`,
      '',
      `${agent.name}'s hub note: what they own, who they work with, and links to their projects.`,
      '',
      `- Working memory: [[Agents/${name}/Memory|${agent.name}'s memory]]`,
      '- Home: [[Home]]',
      ''
    ].join('\n'));
    let memory = '';
    try { memory = fs.readFileSync(join(hive, 'agents', agent.id, 'memory.md'), 'utf8'); } catch { /* none yet */ }
    writeIfChanged(join(vault, 'Agents', name, 'Memory.md'), [
      '---',
      'tags: [agent-memory, mirror]',
      `agent-id: ${agent.id}`,
      '---',
      MIRROR_NOTE,
      `# ${agent.name}'s memory`,
      '',
      `Back to [[Agents/${name}|${agent.name}]].`,
      '',
      memory.trim() || '_Nothing recorded yet._',
      ''
    ].join('\n'));
  }
  writeIfChanged(join(vault, 'Agents.md'), [
    '# Agents',
    '',
    ...hubs.map((name) => `- [[Agents/${name}|${name}]]`),
    '',
    'Back to [[Home]].',
    ''
  ].join('\n'));

  // Finished meetings' notes (saved in hive/meetings by the bridge).
  let meetings = [];
  try { meetings = fs.readdirSync(join(hive, 'meetings')).filter((f) => f.endsWith('.md')); } catch { /* none */ }
  for (const file of meetings) {
    try {
      const text = fs.readFileSync(join(hive, 'meetings', file), 'utf8');
      writeIfChanged(join(vault, 'Meetings', file), `---\ntags: [meeting, mirror]\n---\n${text}`);
    } catch { /* unreadable: skip */ }
  }
  return vault;
}

module.exports = { syncVault, noteName };
