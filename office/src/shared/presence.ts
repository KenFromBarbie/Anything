/**
 * Agent presence, Discord-style: what each agent is doing ("Modeling in 3D"),
 * on what ("boat_trike"), since when ("for 40 min"), the steps it took, and
 * the newest thing it produced (so the app can show it live, like a screen
 * share). Derived from the hook stream's tool calls; dependency-free so the
 * main process, the renderer and tests can all use it.
 */

export type Activity =
  | 'Modeling in 3D'
  | 'Running a simulation'
  | 'Designing clothing'
  | 'Making an image'
  | 'Editing a video'
  | 'Building a site'
  | 'Making slides'
  | 'Writing a document'
  | 'Working on a spreadsheet'
  | 'Writing code'
  | 'Researching'
  | 'Reading'
  | 'Messaging'
  | 'Working';

/** What the app can show live, by file extension. */
export type LiveKind = 'model' | 'image' | 'video' | 'site' | 'pdf' | 'editor' | 'text';

export const LIVE_EXT: Record<string, LiveKind> = {
  glb: 'model', gltf: 'model', obj: 'model', stl: 'model',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video',
  html: 'site', htm: 'site',
  pdf: 'pdf',
  md: 'text', txt: 'text', csv: 'text'
};

export function liveKindOf(path: string): LiveKind | null {
  const p = path.toLowerCase();
  if (/\.(doc|slides|sheet|image|video|model|site)\.json$/.test(p)) return 'editor';
  const ext = p.split('.').pop() ?? '';
  return LIVE_EXT[ext] ?? null;
}

export interface PresenceStep { ts: number; text: string }
export interface PresenceFile { path: string; kind: LiveKind; mtime: number }

export interface Presence {
  activity: Activity;
  /** What it's on: a project folder or file name. */
  detail: string;
  /** When this activity started (epoch ms). */
  since: number;
  /** Last tool call (epoch ms). */
  lastAt: number;
  /** Finished its turn (idle since), or null while working. */
  idleSince: number | null;
  steps: PresenceStep[];
  /** The newest previewable thing it wrote, if any. */
  latest: PresenceFile | null;
  /** Folders it has been writing in (newest first). */
  dirs: string[];
}

/** A strong activity replaces the current one; a weak one (reading,
 *  searching, messaging) only shows when nothing strong is going on. */
const WEAK: Activity[] = ['Reading', 'Messaging', 'Working', 'Researching'];

const base = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
const dirOf = (p: string) => {
  const n = p.replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  return i > 0 ? n.slice(0, i) : n;
};
const stem = (p: string) => base(p).replace(/\.[^.]+(\.json)?$/, '');

function byExtension(path: string): Activity | null {
  const p = path.toLowerCase();
  if (/\.(glb|gltf|obj|stl|blend|fbx)$/.test(p) || /\.model\.json$/.test(p)) return 'Modeling in 3D';
  if (/\.(png|jpe?g|webp|gif|svg|psd)$/.test(p) || /\.image\.json$/.test(p)) return 'Making an image';
  if (/\.(mp4|webm|mov|mkv)$/.test(p) || /\.video\.json$/.test(p)) return 'Editing a video';
  if (/\.(pptx|key)$/.test(p) || /\.slides\.json$/.test(p)) return 'Making slides';
  if (/\.(docx?|pdf|md|rtf)$/.test(p) || /\.doc\.json$/.test(p)) return 'Writing a document';
  if (/\.(xlsx?|csv|ods)$/.test(p) || /\.sheet\.json$/.test(p)) return 'Working on a spreadsheet';
  if (/\.(html?|css)$/.test(p) || /\.site\.json$/.test(p)) return 'Building a site';
  if (/\.(py|ts|tsx|js|jsx|mjs|cjs|rs|go|java|kt|swift|rb|php|c|cc|cpp|h|cs|sh|ps1|sql)$/.test(p)) return 'Writing code';
  return null;
}

/** Refine "Writing code" from what the code is about. */
function byContent(text: string): Activity | null {
  const t = text.toLowerCase();
  if (/simkit.*cloth|cloth\.(drape|tshirt|skirt|body)|sewing|garment|pattern piece/.test(t)) return 'Designing clothing';
  if (/simkit.*(hydro|aero)|hydro\.boat|aero\.(vlm|wind_tunnel|airfoil|aircraft)|wind[_ ]tunnel|cfd|simulat/.test(t)) return 'Running a simulation';
  if (/blender|bpy\.|three\.js|gltfexporter|trimesh|glb\.scene|simkit.*(mesh|glb)|\.glb\b/.test(t)) return 'Modeling in 3D';
  if (/ffmpeg|moviepy|\.mp4\b|\.webm\b/.test(t)) return 'Editing a video';
  if (/python-pptx|pptx/.test(t)) return 'Making slides';
  if (/\bpil\b|from pil|imagemagick|\bconvert .*\.(png|jpg)|matplotlib|\.png\b/.test(t)) return 'Making an image';
  if (/index\.html|vite|next dev|npm (run )?(dev|build)|tailwind/.test(t)) return 'Building a site';
  return null;
}

export interface ToolCall {
  activity: Activity;
  detail?: string;
  step: string;
  /** A file it wrote. */
  wrote?: string;
}

/** What one tool call means. */
export function classify(tool: string, input: unknown): ToolCall {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const file = typeof i.file_path === 'string' ? i.file_path : typeof i.notebook_path === 'string' ? i.notebook_path : '';
  const name = tool.toLowerCase();
  if (['write', 'edit', 'multiedit', 'notebookedit'].includes(name) && file) {
    const content = [i.content, i.new_string, i.new_source].filter((x) => typeof x === 'string').join('\n');
    const ext = byExtension(file);
    const act = ext === 'Writing code' || ext === null ? (byContent(content + ' ' + file) ?? ext ?? 'Working') : ext;
    return { activity: act, detail: projectOf(file), step: `${name === 'write' ? 'Wrote' : 'Edited'} ${base(file)}`, wrote: file };
  }
  if (name === 'bash' || name === 'powershell') {
    const cmd = typeof i.command === 'string' ? i.command : '';
    if (/buzz-(post|reply)|hive.*send/.test(cmd)) return { activity: 'Messaging', step: 'Posted a message' };
    if (/buzz-show/.test(cmd)) {
      const t = /--title\s+"([^"]+)"/.exec(cmd)?.[1];
      return { activity: 'Working', step: `Published ${t ? `“${t}”` : 'a result'}` };
    }
    const act = byContent(cmd) ?? (/\b(python|node|npx|npm|pip|cargo|pytest|bun)\b/.test(cmd) ? 'Writing code' : 'Working');
    const short = cmd.replace(/\s+/g, ' ').trim().slice(0, 80);
    const target = /([\w./\\:-]+\.(py|js|ts|mjs|cjs|sh))\b/.exec(cmd)?.[1];
    // Only a path with a folder names the project (not a bare "run.py").
    return { activity: act, detail: target && /[\/]/.test(target) ? projectOf(target) : undefined, step: `Ran ${short}` };
  }
  if (name === 'websearch') return { activity: 'Researching', step: `Searched “${String(i.query ?? '').slice(0, 60)}”` };
  if (name === 'webfetch') return { activity: 'Researching', step: `Read ${String(i.url ?? 'a page').slice(0, 70)}` };
  if (name === 'read' && file) return { activity: 'Reading', step: `Read ${base(file)}` };
  if (name === 'grep' || name === 'glob') return { activity: 'Reading', step: `Searched the files for ${String(i.pattern ?? '').slice(0, 40)}` };
  if (name === 'task' || name === 'agent') return { activity: 'Working', step: 'Started a helper' };
  return { activity: 'Working', step: `Used ${tool}` };
}

/** The project a file belongs to: its folder (or the file's own name). */
export function projectOf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const dir = parts.length > 1 ? parts[parts.length - 2] : '';
  const generic = /^(src|out|output|outputs|dist|build|scripts|tmp|work|assets|public|images|renders|models)$/i;
  return (dir && !generic.test(dir) ? dir : stem(path)).replace(/[_-]+/g, ' ').slice(0, 60);
}

const STEPS = 30;
/** After this much quiet the activity's clock restarts. */
const QUIET_MS = 15 * 60_000;

export class PresenceTracker {
  private byAgent = new Map<string, Presence>();

  get(agentId: string): Presence | undefined {
    return this.byAgent.get(agentId);
  }

  all(): Record<string, Presence> {
    return Object.fromEntries(this.byAgent);
  }

  /** A tool call starting (PreToolUse). */
  tool(agentId: string, tool: string, input: unknown, now = Date.now()): Presence {
    const c = classify(tool, input);
    let p = this.byAgent.get(agentId);
    const stale = !p || now - p.lastAt > QUIET_MS;
    if (!p || stale) {
      p = { activity: c.activity, detail: c.detail ?? '', since: now, lastAt: now, idleSince: null, steps: p?.steps ?? [], latest: p?.latest ?? null, dirs: p?.dirs ?? [] };
    } else {
      const strongNow = !WEAK.includes(c.activity);
      const strongBefore = !WEAK.includes(p.activity);
      if (c.activity !== p.activity && (strongNow || !strongBefore)) {
        // "Writing code" inside a 3D/sim/clothing job doesn't change the job.
        const keep = c.activity === 'Writing code' && ['Modeling in 3D', 'Running a simulation', 'Designing clothing', 'Building a site', 'Making an image', 'Editing a video', 'Making slides'].includes(p.activity);
        if (!keep) {
          p = { ...p, activity: c.activity, since: now };
          if (c.detail) p.detail = c.detail;
        }
      } else if (c.detail && strongNow) {
        p = { ...p, detail: c.detail };
      }
    }
    p = { ...p, lastAt: now, idleSince: null, steps: [...p.steps, { ts: now, text: c.step }].slice(-STEPS) };
    if (c.wrote) {
      const d = dirOf(c.wrote);
      p.dirs = [d, ...p.dirs.filter((x) => x !== d)].slice(0, 6);
      const kind = liveKindOf(c.wrote);
      if (kind) p.latest = { path: c.wrote, kind, mtime: now };
    }
    this.byAgent.set(agentId, p);
    return p;
  }

  /** A file it produced some other way (a script's output). */
  produced(agentId: string, file: PresenceFile): Presence | undefined {
    const p = this.byAgent.get(agentId);
    if (!p) return undefined;
    if (p.latest && p.latest.path === file.path && p.latest.mtime >= file.mtime) return p;
    const better = !p.latest || file.mtime >= p.latest.mtime || rank(file.kind) > rank(p.latest.kind);
    if (!better) return p;
    const next = { ...p, latest: file, steps: [...p.steps, { ts: file.mtime, text: `Made ${base(file.path)}` }].slice(-STEPS) };
    if (p.activity === 'Writing code' || p.activity === 'Working') {
      const act = file.kind === 'model' ? 'Modeling in 3D' : file.kind === 'image' ? 'Making an image' : file.kind === 'video' ? 'Editing a video' : file.kind === 'site' ? 'Building a site' : null;
      if (act) Object.assign(next, { activity: act, since: p.since });
    }
    this.byAgent.set(agentId, next);
    return next;
  }

  /** Its turn ended (Stop). */
  idle(agentId: string, now = Date.now()): Presence | undefined {
    const p = this.byAgent.get(agentId);
    if (!p) return undefined;
    const next = { ...p, idleSince: p.idleSince ?? now };
    this.byAgent.set(agentId, next);
    return next;
  }

  forget(agentId: string): void {
    this.byAgent.delete(agentId);
  }
}

/** A finished picture of the work outranks its source (a .glb over a .py). */
function rank(k: LiveKind): number {
  return { model: 6, video: 5, site: 4, image: 3, editor: 3, pdf: 2, text: 1 }[k] ?? 0;
}

/** "for 40 min" */
export function sinceLabel(since: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - since) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `for ${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `for ${h} h${r ? ` ${r} min` : ''}`;
}
