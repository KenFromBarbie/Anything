/**
 * Agents publish each new iteration of a thing as its own artifact, with the
 * same title (the Studio asks them to). The gallery shows one card per thing,
 * its latest version, and the viewer steps through the rest.
 */

type Versioned = {
  id: string;
  title: string;
  kind: string;
  createdAt: number;
  /** The first version's id, set by the Office when it saw the same title. */
  series?: string;
};

/** A title without its version marks: "Site (v2, sourced)" → "site". */
export function baseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(
      /\s*[([][^)\]]*\b(v\d+|version|edited|updated|revised|final|draft)\b[^)\]]*[)\]]/g,
      "",
    )
    .replace(
      /\s*[-–—:,]?\s*\b(v\d+|version \d+|edited|updated|revised)\s*$/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Which family of artifact: a site and a 3D model with one title are two things. */
function family(kind: string): string {
  return kind === "site" || kind === "html" ? "site" : kind;
}

export function versionKey(item: Versioned): string {
  return `${family(item.kind)}:${baseTitle(item.title) || item.id}`;
}

/**
 * One entry per thing, newest first, each with its versions oldest first.
 * An Office `series` id joins versions whose titles drifted apart.
 */
export function groupVersions<T extends Versioned>(
  items: T[],
): { latest: T; versions: T[] }[] {
  const seriesKey = new Map<string, string>();
  const groups = new Map<string, T[]>();
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  for (const item of sorted) {
    const own = versionKey(item);
    const key = (item.series && seriesKey.get(item.series)) || own;
    seriesKey.set(item.series ?? item.id, key);
    seriesKey.set(item.id, key);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()]
    .map((versions) => ({
      latest: versions[versions.length - 1] as T,
      versions,
    }))
    .sort((a, b) => b.latest.createdAt - a.latest.createdAt);
}
