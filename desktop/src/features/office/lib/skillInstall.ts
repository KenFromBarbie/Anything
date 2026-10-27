// Adding skills from a GitHub repository: the owner gives the repo, Michael
// installs it (SkillsSection).

/** `https://github.com/owner/repo` (optionally a subfolder) from what was
 *  typed (a full link, `github.com/owner/repo` or `owner/repo`), or null. */
export function githubRepoUrl(input: string): string | null {
  const text = input
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const match =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)((?:\/tree\/[\w./-]+)?)$/i.exec(
      text,
    ) ?? /^([\w.-]+)\/([\w.-]+)()$/.exec(text);
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2]}${match[3]}`;
}

/** What Michael is asked to do with a repository the owner gave. */
export function installSkillRequest(url: string): string {
  return [
    `[SKILL INSTALL from the owner] Install the skills from ${url} for the office's agents.`,
    "1. Clone it (shallow) to a temp folder and find every skill in it: a folder with a SKILL.md.",
    "2. Read each SKILL.md and any scripts it runs. If a skill would do something harmful or sends data somewhere unexpected, don't install that one and tell the owner why.",
    "3. Copy each skill folder into the user skills folder of each engine the agents use (Claude Code: ~/.claude/skills/<name>; also the OpenCode and Codex skills folders if those are in use). Don't overwrite an existing skill of the same name without telling the owner.",
    "4. Remove the temp clone, then tell the owner in one short message which skills you installed (name and one line each), and anything you skipped.",
  ].join("\n");
}
