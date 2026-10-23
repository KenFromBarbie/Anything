<p align="center">
  <img src="desktop/src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Anything icon">
</p>

<h1 align="center">Anything</h1>

<p align="center">One desktop app for running a team of AI agents: chat, tasks, research and a studio, with your own Claude, ChatGPT and Gemini accounts.</p>

## What's inside

- **Servers set up for the work**: name a server, say what it's for and attach
  files or links. Claude drafts the permanent staff (managers, IT, HR... whatever
  the work needs), channels named for the work, starter threads and Michael's
  brief; you edit it, and it's all created for you.
- **Office**: Michael, the orchestrator, runs a floor of agents (Claude Code,
  Codex, Gemini). He splits each request between the permanent staff, who sit in
  their own offices and hire floor workers for the tasks, check the results and
  report back. Click any desk's computer to edit the agent there or hire one.
- **Meetings**: a Meeting room voice channel. Call a meeting with chosen agents;
  they take their seats at the table, talk in turn, hand over to each other by
  name, pick their model for the call, and get the notes when it ends.
- **Tasks**: the agents' board and your own task sheet, synced both ways with
  Notion (sign in with Notion; use a new sheet or one you already have).
- **Questions from agents**: what they need from you, asked in the thread the
  work came from, or at the top of your Inbox.
- **Research**: projects as folders. Describe a project (and attach files) and
  Michael researches it in its own chat, saving what he finds into the folder.
  Pin projects and give them covers.
- **Studio** (optional): local creative tools (image editor, 3D stage, video
  editor, frame extractor, storyboard, moodboard), with nothing that spends AI
  credits. Not included in the installers: install it from the Studio page or
  Settings → Studio and pick the tools you want.
- **Office background**: the live Office floor, faded behind every page
  (Settings → Appearance).
- **AI accounts** (Settings): several Claude, ChatGPT and Gemini sign-ins or
  API keys, their usage, and which one the agents run on. Set usage caps per
  account (5 hours, day, week, or % of the plan) that switch the agents to
  another account, freeze them, or warn you; freeze an engine's agents by hand.
- **Your layout**: the server bar at the left or along the top, shown always or
  only on hover (Settings → Appearance).
- Channels, direct messages and agents from Buzz, which this is built on.

## Download

Installers for Windows, macOS (Apple silicon) and Linux (.deb and AppImage)
are on the [Releases](../../releases) page, and every build of `main` attaches
them to its run under [Actions](../../actions/workflows/build-installers.yml).

They aren't code-signed yet:

- **Windows**: SmartScreen may warn; choose *More info → Run anyway*.
- **macOS**: right-click the app and choose *Open* the first time (or run
  `xattr -dr com.apple.quarantine "/Applications/Anything.app"`).
- **Linux**: `sudo apt install ./anything_*.deb`, or make the AppImage
  executable and run it.

The agents need their CLIs installed and signed in on your machine: Claude
Code, Codex and/or Gemini CLI.

## Repository layout

| Path | What |
| --- | --- |
| `desktop/` | The app (Tauri 2: Rust in `src-tauri/`, React in `src/`) |
| `crates/` | Relay, agent runtime, CLI and shared Rust crates |
| `office/` | The Office (agents, floor, hive), run as a sidecar |
| `studio/` | The Studio (ArtCraft), built into the app |
| `docs/ANYTHING.md` | How the pieces fit together, and dev notes |

## Building

See `docs/ANYTHING.md` for development (local services, running the
app) and `.github/workflows/build-installers.yml` for the full release build
on each platform.

## Credits and licenses

Built from [Buzz](https://github.com/block/buzz) (Block, Apache-2.0),
[Munder Difflin](https://github.com/HarnessMD/munder-difflin) (MIT) and
[ArtCraft](https://github.com/storytold/artcraft) (MIT OR Apache-2.0). Each
part keeps its license: `LICENSE` (Apache-2.0) at the root, `office/LICENSE`,
and `studio/LICENSE-MIT` / `studio/LICENSE-APACHE`. Artwork credits are in
[CREDITS.md](CREDITS.md).
