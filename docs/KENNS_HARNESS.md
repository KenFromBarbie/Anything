# Office merge: Munder Difflin inside Buzz

Combined app = this repo (Buzz `desktop-v0.5.26`, branch `office-merge`) with
Munder Difflin (`v0.5.5`, `../munder-difflin`, branch `sidecar`) hosted as an
**Office** tab.

## Status

| Milestone | State |
|---|---|
| M0 Prereqs | Rust 1.95, pnpm 11.4, just, VS 2022 C++ Build Tools installed. No Docker: services run natively (below). |
| M1 Baseline | Done. Munder Difflin builds + runs. Buzz workspace + desktop build. Relay runs on native Postgres 17 + Garnet (no media storage). |
| M2 Sidecar | Done. Munder main runs headless, unmodified; full UI runs in a browser against it. |
| M3 Office in Buzz | Done. The Agents page is the Office: its floor fills the page (one sidebar entry, one agents row); it stays mounted after first open; host bridge verified; sidecar stops with Buzz. |
| M4 Hive on Buzz | Done and verified live: the owner's @mention in #general reached Michael, who answered in the thread. Also DMs and thread follow-ups; non-owner messages ignored. |
| Studio (ArtCraft) | Built into Buzz's process and building; see "The Studio" below for what is verified. |
| M5 Package | Installers for Windows, macOS and Linux are built by `.github/workflows/build-installers.yml`; the Office runtime is staged by `scripts/stage-office-runtime.mjs` and bundled as `resources/office`. |

## Local services without Docker (dev)

Portable installs in a services folder outside the repo (`KH_SERVICES_DIR`,
default `../kenns-harness-services`). Start everything (detached, skipping
what's already up) with
`powershell -ExecutionPolicy Bypass -File scripts\dev-services.ps1`.

- **Postgres 17.6** (EDB Windows binaries), data in `pgdata`, user `buzz` / db `buzz`, localhost only.
  Start: `pgsql\bin\pg_ctl -D pgdata -l postgres.log start`
- **Garnet 2.2** (Microsoft, Redis-compatible), `garnet\net10.0\GarnetServer.exe --bind 127.0.0.1 --port 6379 --lua -m 256m`
- **Relay**: from the repo root, with `.env` loaded,
  `BUZZ_BIND_ADDR=127.0.0.1:3000 BUZZ_GIT_CONFORMANCE_PROBE=false target/debug/buzz-relay.exe`
  (the probe needs S3; MinIO no longer ships Windows binaries, so media uploads and git hosting are off.)
- One-time: `buzz-admin migrate`, `scripts/seed-local-community.sh`, `scripts/ensure-local-relay-key.sh .env`.

## M4: Buzz bridge (as built)

`src/sidecar/buzz-bridge.cjs` in the office runtime, started by the launcher when
Buzz passes `BUZZ_OFFICE_RELAY_URL` / `BUZZ_OFFICE_OWNER` / `BUZZ_OFFICE_CLI`
(`office.rs`: active workspace relay, signed-in identity, bundled `buzz` CLI).

- Michael gets his own Nostr identity; the key is generated once, stored with
  the sidecar's `safeStorage`, and only ever passed to the `buzz` CLI's own
  environment.
- Polls `buzz feed get --types mentions`. **Only the owner can task Michael**;
  other members' mentions are logged and ignored (Michael runs real agents).
- Accepted mentions get 👀 and go to the god agent through the app's own
  `hive:send` handler, with reply instructions.
- Agents reply with the generated `buzz-reply` wrapper (`md-buzz-reply.cjs`) →
  loopback endpoint (token in `buzz-reply.json`) → `buzz messages send --reply-to`.
  Only threads delivered to Michael can be answered.
- Michael auto-joins `#general`; add him to other channels from Buzz.

Security fix made during M4: the launcher now removes `MD_MASTER_KEY`,
`MD_SIDECAR_TOKEN` and `ELECTRON_RUN_AS_NODE` from `process.env` before
`index.ts` loads, because agent terminals inherit the main process environment.

What reaches Michael (owner only): @mentions in channels, **any DM to Michael**,
and **replies in a thread Michael was asked in or answered in**. Ordinary channel
chat is ignored. DM answers post inline; channel answers post in the thread.
Michael's Buzz name is "Michael" (it was "Michael (Office)" while a stale
identity of the same name existed; see below).

Fixes made after the first live run:
- `office.rs`: `office_connect` holds a start lock across check-and-spawn.
  React runs effects twice in development, and two concurrent connects used to
  start two sidecars that each minted a Michael key.
- Bridge key file is created exclusively (`wx`); the profile marker includes the
  pubkey, so a new identity always publishes its profile.
- Michael's pubkey is derived locally with BigInt secp256k1 math. Electron's
  BoringSSL has no secp256k1 curve, so `crypto.createECDH` can't be used.
- Office host `dialog.showMessageBox` uses the dialog plugin's `message`
  command; any failure answers the dialog's cancel choice (see Buzz issue below).
- `OfficeHost` is mounted once in `AppShell`, outside the settings switch, and
  pinned over the main content inset when active, so it keeps running in
  Settings and never reloads.

Behaviour to know: Munder Difflin shows its harness-config picker on every
launch, so Michael starts only when the user opens the Office and confirms.
Messages sent meanwhile are delivered once the bridge starts.

Known limits: a community switch needs an office restart to move the bridge.

## Michael as a Buzz agent (as built)

Michael is one of the owner's managed agents (`commands/agents_office.rs`):

- **Record** in `managed-agents.json` with `backend = Provider { id: "office" }`
  ("managed externally": never auto-started, no local harness), key in the OS
  keyring, `start_on_app_launch = false`.
- **Identity**: created on first Office start (`ensure_office_agent`). The key
  the office minted earlier (`buzz-michael.key`, AES-256-GCM under the master
  key) is adopted, so his pubkey survived the move. Buzz computes the owner's
  NIP-OA auth tag, publishes his kind:0 with it, and flushes the owner's kind
  30177 policy, which makes him discoverable as the owner's agent.
- **Office side**: `office.rs` passes the key and auth tag as
  `BUZZ_OFFICE_AGENT_KEY` / `BUZZ_OFFICE_AGENT_AUTH`; the launcher moves both
  into memory and out of `process.env`. The bridge uses them, sends the auth
  tag on everything it signs (`BUZZ_AUTH_TAG`), and no longer publishes his
  profile (Buzz owns it).
- **Status**: `backend_agent_id` is set while the office runs ("deployed"),
  cleared on stop and at Buzz launch.
- **Agent actions** (`managedAgentControlActions.ts`, tested), where Buzz
  still shows his controls (profile panel, channel members sidebar): Start
  opens the Office; Stop stops the Office (backend `stop_managed_agent` calls
  `office::shutdown`); Delete removes the record without `!shutdown` or a
  provider teardown (recreated from the same key on the next Office start).
  Backend `start_managed_agent` refuses the office record.
- **Agents and Office pages** (sidebar: Inbox, Tasks, Ask Me, Agents, Office, Studio). The
  **Agents** page (`OfficeAgentsPage`) shows the selected agent's panel
  (Michael's Command Center: terminal, monitor, tasks, ask me, …) at full width
  plus the agent strip (Michael · BOSS, Jim, "add agent"); the **Office** page
  (`OfficeFloorPage`, route `/office`) shows the title bar and the floor. Both
  are the same live Office frame (`OfficeHost`, mounted once in AppShell, active
  on either page, pinned over the page's content area); each page sets its part
  (`useShowOfficePart`), Buzz posts `{type:"view"}`, and the Office
  (`host/buzzHost.ts` in the office runtime) hides the other part with CSS, so
  terminals and the delivery loop keep running. Buzz's card grid, teams section
  and the earlier "Hire into the Office" bridge are gone; `AgentsScreen` loads
  `OfficeAgentsPage` instead of `AgentsView` (left in the tree, unused, to keep
  upstream merges simple). Opening either page starts the Office.
- **Sections and adding agents**: the selected agent's panel tabs are Buzz's
  own section navigation on the Agents page, under the agent's name: Michael's
  Command Center (terminal & monitor — one section, the monitor under the
  terminal — triggers, memory, graph, activity, skills, workers) or a worker's
  panel (terminal, git, messages, traces). **Tasks** and **Ask Me** (the
  agents' questions) are sidebar pages of their own, above Agents (`/tasks`,
  `/ask-me`), both Buzz's own UI (see "Tasks, Notion and the Agents page in
  Buzz's UI" below). When the Office asks for either (the floor's task board,
  a question) Buzz opens the page (`navigate`). The Office reports them (`panel-state`, from `CommandCenterPanel` /
  `AgentDetailPanel`), hides its own tab bars when hosted, and opens what Buzz
  asks for (`panel-tab`; a Command Center section while a worker is selected
  brings Michael's panel back). Agents are added from the Agents page's
  **Add agent** button (`add-agent` opens the Office's Add Agent form) or from
  any channel's members panel: **New Office agent for this channel** opens the
  same form and, once the hired agent gets its Buzz identity, adds it to that
  channel (`officeChannelHire`; nothing is hired until the form is confirmed).
  Existing Office agents are added to channels with Buzz's normal member
  search. Commands queue until the Office is up (`officeLink`). The Office also
  posts `roster-changed`, and Buzz refreshes its agent list so status and
  membership are current.
- **One theme**: Buzz sends its resolved theme (`{type:"theme"}`: content
  background, foreground, card, muted, border, primary, font, dark flag) on
  load and whenever `<html>` changes; the Office maps it onto its `--cth-*`
  tokens (surfaces, ink ramp, Buzz's font everywhere, the yellow brand accent
  as a tint of Buzz's primary), follows light/dark including terminals and new
  agents' session theme, and rounds its panels/buttons/badges. Its own theme
  toggle is hidden when hosted. The pixel-art floor and characters keep their
  look. Standalone Munder is unchanged.
- **Lost with Buzz's grid**: agent snapshot import (its only entry point was
  that page), the teams UI, and `tests/e2e/agents.spec.ts`, which targets the
  grid and will fail until it's rewritten for the Office page.
  (`office_status` in `office.rs` is no longer used by the frontend.)

## Floor agents in Buzz channels (as built)

Every agent hired on the Office floor (not just Michael) gets its own
owner-attested Buzz identity, so it shows up as one of the owner's agents,
can be @mentioned in channels, and posts as itself.

- **Handshake, no keys on disk**: the bridge reads `<harnessHome>/roster.json`
  each poll and, when the floor changes, prints
  `MD_OFFICE_ROSTER {"agents":[{"id","name"}]}` on the sidecar's stdout
  (Michael excluded). `office.rs` parses it, `ensure_office_workers`
  (`commands/agents_office.rs`) creates a record per new agent (backend
  `office`, `config.officeAgentId` = floor id; key in the keyring; profile with
  the owner's auth tag; owner policy flushed) and marks floor agents deployed.
  The identities go back as one JSON line on the sidecar's stdin
  (`{"type":"office-agents",...}`); the launcher hands them to
  `bridge.setWorkers`. Records of agents that leave the floor are kept (same
  identity if they come back) and read as not deployed.
- **Routing** (`buzz-bridge.cjs`): each identity polls its own feed. @mentions,
  DMs and follow-ups in threads the agent is in go to that agent's hive inbox.
  The owner can task any office agent; office agents can reach each other only
  by an explicit @mention, at most 8 agent messages per thread until the owner
  speaks in it again (stops two agents looping); anyone else is ignored. New
  agents join #general and start reading from "now".
- **Posting**: `buzz-reply --reply-to <id>` replies in a thread an office agent
  was brought into, as the calling agent (`AGENT_ID` from the hive); agents
  without a Buzz identity reply as the agent the thread was delivered to, and
  DMs are answered by the agent the DM is with. `buzz-post --channel <name>`
  starts a conversation as the calling agent (office agents only). `@Name` of
  another office agent in the text adds an explicit mention. Each delivered
  message lists the other office agents and both commands.
- **Controls**: a floor agent's Start/Stop open the Office (Stop never stops
  the Office for everyone; the backend refuses it). Deleting removes only its
  Buzz identity; it gets a new one while it is still on the floor.
- Bridge state moved to per-agent cursors plus thread roots; older state files
  migrate on load. Tests: `munder-difflin/test/buzz-bridge-agents.test.cjs`
  (routing, hop cap, who posts) and the worker cases in
  `managedAgentControlActions.test.mjs`.

### Codex agents on the floor

Codex 0.148 refuses to start when given `--add-dir` while its sandbox is
read-only ("Error adding directories ... effective permissions do not allow
additional writable roots", exit 1). Munder added the hive folders with
`--add-dir` on every Codex spawn, so with auto mode off (no `-s` flag) in an
untrusted folder every Codex worker died at launch. Fix in
`munder-difflin/src/main/hive.ts`: the dirs are added only when the command
line itself asks for `workspace-write` (`codexSandboxFromArgs` in
`shared/agentProvider.ts`, fed the spawn's argv as `launchArgs`). Outside auto
mode Codex keeps its own default and asks before writing, like a Claude worker.
Tests in `test/auto-mode-sandbox.test.cjs`.

## The Studio: ArtCraft inside Buzz (as built)

[ArtCraft](https://github.com/storytold/artcraft) (AI image, video and 3D
creation; Tauri 2, MIT/Apache-2.0) is compiled into Buzz's own process and
shown as the **Studio** sidebar page. Source: `studio/` (imported from
`main` at 8abde75, with the changes below).

How it fits:
- **Rust**: `buzz-desktop` depends on ArtCraft's desktop crate
  (`artcraft_app_lib`). `desktop/src-tauri/src/studio.rs` calls
  `artcraft_app_lib::install` (ArtCraft's http/upload plugins and state; Buzz
  already registers dialog/opener), routes ArtCraft's 63 command names
  (`COMMANDS`) to `artcraft_app_lib::invoke_handler()` and everything else to
  Buzz's handler (no name collisions), and calls `Startup::start_embedded` in
  Buzz's setup (ArtCraft's background threads, no window of its own; failures
  are logged, not fatal).
- **UI**: ArtCraft's view is a native child webview (label `artcraft`) of
  Buzz's main window, created on first visit by the `studio_place` command and
  laid over the Studio page's content area; hidden, not destroyed, when you
  leave. Its frontend is built by `just studio-web` into
  `desktop/public/studio-app/` (served from Buzz's own origin, so ArtCraft's
  commands are allowed; `ARTCRAFT_BASE=/studio-app/`).
- **Capability**: `capabilities/studio.json` grants ArtCraft's plugin
  permissions to the `artcraft` webview only (no window controls).

Changes in the ArtCraft checkout:
- `sqlite_tasks` ported from sqlx 0.7 to rusqlite 0.40 (Buzz's version): only
  one `libsqlite3-sys` may link in a build. Same public API; one table, version
  tracked with `PRAGMA user_version`; databases made by the sqlx build open
  as-is. Round-trip tests in `sqlite_tasks/tests/roundtrip.rs` (pass).
- `enums`/`tokens`: the optional MySQL `database` feature (backend services
  only) no longer pulls sqlx 0.7, whose optional SQLite dependency conflicted
  even when unused.
- Embedded mode (`core/embedding.rs`): `install`/`Startup`/`invoke_handler`/
  `COMMANDS` split out of `run()` (standalone `run()` uses the same pieces);
  window size/position code is skipped when embedded (Buzz's window shares the
  "main" label); the cookie-sync thread runs without a window; logout clears
  cookies on the `artcraft` webview. Frontend: `IsEmbeddedInHost()` hides the
  minimize/maximize/close buttons; file drops listen on the view.
- `wreq`/`wreq-util` pinned exactly (`=6.0.0-rc.28`, `=3.0.0-rc.10`): later
  pre-releases changed the cookie API.
- Vite: `ARTCRAFT_BASE` serves it under a subpath and prefixes code's absolute
  public paths (`"/resources/..."`).

Build notes (Windows):
- BoringSSL (via `wreq`) needs CMake (VS-bundled), libclang
  (`pip install --user libclang` with the system Python; set `LIBCLANG_PATH`
  to its `clang/native` dir) and no NASM: `.cargo/config.toml` points cmake-rs
  at `desktop/src-tauri/boringssl-no-asm.cmake`, which sets `OPENSSL_NO_ASM`
  and switches -MD to -MT (Buzz links the static CRT because sherpa-onnx ships
  /MT libraries; mixing them fails with LNK2038).
- After changing that toolchain file, `cargo clean -p boring-sys2` (cmake-rs
  keeps its configure cache).
- `ARTCRAFT_BASE` under Git Bash: the recipe sets `MSYS2_ENV_CONV_EXCL`, or
  MSYS rewrites `/studio-app/` into a Windows path.

Open items: release builds would inject Buzz's strict CSP into ArtCraft's
pages (it needs `unsafe-eval` and its service domains), so packaging needs a
CSP decision or a custom protocol for the Studio; Buzz's own overlays
(dialogs, search) can't draw over the native Studio view; ArtCraft's features
need its own account (storyteller.ai login) or provider logins/API keys.

### Buzz starter agents removed

Stock Buzz can't remove its built-in starter team: built-in personas and the
built-in Welcome Team are re-seeded on every load, can't be deleted, and the
team blocks deactivating its personas. This build adds a reversible opt-out
(`managed_agents/starter_agents.rs`, `commands/agents_starter.rs`):

- `remove_starter_agents` deletes the Fizz/Honey/Pollen instances through the
  normal `delete_managed_agent` path (runtime stopped, keyring entry removed,
  relay tombstone), then writes `<app data>/agents/starter-agents-removed`.
- While that marker exists, `load_personas`, `load_teams` and
  `load_teams_readonly` drop `builtin:fizz`, `builtin:honey`, `builtin:bumble`
  and `builtin-team:welcome` after the built-in merge.
- `restore_starter_agents` deletes the marker; the next load re-seeds the
  personas and team (their agents aren't recreated; start them from the page).
- Applied to the local profile on 2026-10-09. No UI button yet. Unit tests were
  written but not kept: the test build didn't fit in the remaining disk space.

### Pre-existing Buzz issue found

With `tauri-plugin-dialog` 2.7.1, `window.confirm` in Buzz's own window is the
plugin's async override and calls `plugin:dialog|confirm`, a command 2.7.1 no
longer has. Every `window.confirm` in Buzz therefore returns a Promise (truthy)
and logs `dialog.confirm not allowed`: confirm-guarded actions proceed without
asking, and closing the window while agents run is cancelled. Not fixed here.

## Tasks, Notion and the Agents page in Buzz's UI (as built)

The Tasks, Ask Me and Agents pages, and the Add/Edit agent dialogs, are Buzz
components over the Office's data, not the Office's own UI, and so are all
of Michael's sections (models & budgets, triggers with history, memory,
graph, activity, skills, workers; `ui/sections/*`). Only an agent's live
terminal, a worker's git/messages/traces sections, the IDE and the Office's
full Add Agent form ("More options in the Office…": import a hire file,
resume a session, custom command) still render in the Office frame.

- **Office API** (`host/buzzApi.ts` in the office runtime): Buzz sends
  `{type:"api", id, op, args}` and gets `{type:"api-result", id, ok, value |
  error}` (`callOffice` in `officeLink`). Operations do what the Office's own
  controls do: `tasks.list/add/patch/delete`, `dispatch` (to Michael, with an
  optional suggested agent), `agents.select`, `agent.message` (queue),
  `agent.queue.remove`, `agent.control/pause/halt/steer`, `agent.hold` (1:1),
  `agent.ide`, `agent.openTerminal`, `agent.archive`, `floor.delivery` /
  `floor.delivery.set`, `askme.answer` / `askme.dismiss`, `hire.options`,
  `hire.chooseFolder`, `agents.hire`, `agent.details`, `agent.update`, and for
  the sections (`host/buzzSectionsApi.ts`): `cth` (an allowlist of the
  Office's own preload calls: memory, log, board, workers, skills, missions,
  context/webhook/org triggers, trigger history, issues), `telemetry`,
  `floor.settings`, `floor.setAgentCap`, `models.options`, `agent.restart`
  (the monitor's restart, now shared as `components/agentRestart.ts`),
  `floor.setGodEngine`, `agents.archived(.remove)`, `triggers.webhooks.save/
  delete`, `triggers.org.set` (both keep the Office's store mirrors in step)
  and `graph.data`. Nothing hands Buzz the whole harness config. The Office pushes a snapshot of its
  agents (`{type:"state"}`: status, action, engine, context, queue, tool calls,
  1:1) on change, throttled; Buzz reads it with `useOfficeAgents`.
- **Inside Buzz the Office opens the current hive directly** (no launch
  picker), so Michael boots and the delivery loop runs without visiting a page.
- **Tasks page** (`features/tasks`): the agents' board (To do / Doing /
  Blocked / Done; cards open a task dialog to edit, move, reassign or delete;
  drag between columns; quick add), the **Dispatch** card (work for the floor
  goes to Michael, moved here from the Office's monitor), and **My tasks**, the
  owner's own sheet. Agent ids show as names (retired agents by their id's
  name, Michael for `god`).
- **Notion** (`src-tauri/src/notion.rs`, `features/tasks/lib`): the owner
  pastes an internal integration's secret into Buzz (Connect Notion); Buzz
  keeps it in the OS keyring and makes every call itself (`notion_request`
  reaches only `users/me`, `search`, `databases[/id[/query]]`, `pages[/id]`,
  GET/POST/PATCH). Buzz creates two databases under a page the owner picks:
  **Office tasks** (Name, Status, Assignee, Description, Task ID) and **My
  tasks** (Name, Status, Due, Notes). The board syncs both ways
  (`notionSyncPlan` decides, `notionSync` applies, `NotionSyncRunner` in
  AppShell runs it every 30 s while the Office is up and after board edits):
  new tasks get rows, rows added in Notion become tasks, a change on one side
  updates the other, the board wins when both changed, and a task removed from
  the board archives its row (Notion's trash). Rows deleted in Notion never
  delete tasks. Bookkeeping (`notion-sync.json`) and the database ids
  (`notion.json`) live in the app data dir; Disconnect forgets the secret and
  both files. My tasks is read and written live (add, done, status, due,
  notes, trash with undo).
- **Ask Me** (`features/tasks/ui/AskMePage`): blocked tasks with an open
  question, newest first (the Office's rules, `lib/askMe`), each with the
  question, earlier answers, what it's holding up, and Respond / Dismiss.
  Answering records it on the task and tells Michael; drafts survive leaving
  the page.
- **Add / Edit agent** (`ui/agents/AgentFormDialog`): name, look on the floor,
  color, engine and model, folder (recent or chosen) and own git worktree,
  role and goal. Hiring runs the Office's own spawn path (`agents.hire`);
  editing saves like the Office's Edit form (engine changes apply on the next
  restart). Channel "New Office agent" opens this dialog too.
- **Agents page** (`OfficeAgentsPage`, `ui/agents/*`): agent cards (status,
  current action, engine, context), then the selected agent's header and
  controls: Michael's floor-wide **Auto delivery** switch and **IDE**; a
  worker's **Block tools**, **Stop after this step**, **1:1**, **IDE**, and a
  menu to edit (Buzz's dialog), open a system terminal, or archive
  (confirmed in Buzz). Under
  the section nav, the Terminal section is the live terminal (Office frame,
  on Buzz's surface color), Buzz's **queue composer** (queued messages with
  remove; Steer now for workers) and, for Michael, the **Monitor** (every
  agent's status, action, queue, tool calls, context). Hosted, the Office
  hides its agent strip, panel headers, control strip, composer and monitor.
  While one of its full-window overlays is open (its full Add Agent form, the
  IDE, Settings, a fullscreen terminal) it tells Buzz (`overlay`) and gets the
  whole page. Model switching of a running agent, token budgets and restarts
  are Michael's **Models & budgets** section (the Office's monitor).

## Notion sign-in, AI accounts and Research (as built)

- **Notion through account sign-in.** Tasks talks to Notion's hosted MCP
  (`https://mcp.notion.com/mcp`) instead of an integration token.
  `src-tauri/src/notion_mcp.rs` discovers OAuth (RFC 9728/8414), registers a
  public client, runs PKCE S256 with a loopback callback on
  `127.0.0.1:47615/notion/callback`, and keeps the client and tokens in the OS
  keyring (`notion.mcp.client`, `notion.mcp.tokens`). `notion_mcp_call` is
  allowlisted to the Notion tools Tasks uses. Both the agents' board sync and
  "My tasks" go through it (`features/tasks/lib/notion.ts`); databases are
  referenced by data source URL (`collection://…`). Removing a task sets its
  Status to Archived rather than deleting the page. **To verify after the first
  sign-in:** the exact argument shapes for create-pages, update-page, dates and
  create-database (read them from `notion_mcp_tools`).
- **AI accounts (Settings → AI accounts).** `src-tauri/src/ai_accounts.rs` keeps
  extra Claude Code, Codex and Gemini CLI sign-ins, each in its own home
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME` under
  `<app data>/ai-accounts/<engine>/<id>`). Adding one opens a terminal running
  the CLI's login. "Use for agents" writes `active.json`; the Office reads it
  via `BUZZ_AI_ACCOUNTS_FILE` (`src/main/aiAccounts.ts`), and agents pick the
  account up when they restart. Usage comes from each CLI's local logs: Claude
  transcripts (token counts; Claude doesn't expose plan limits), Codex rollout
  `token_count` events (including limit percentages), Gemini chat files.
  Removing an account sends its folder to the Recycle Bin. Only key names,
  email and plan are read from credential files, never token values.
- **Research (sidebar, above Studio).** `src-tauri/src/research.rs` keeps a
  registry of project folders (`<app data>/research.json`, new projects under
  `~/Research` by default, changeable). Starting a project from the page's chat
  box makes the folder with a README, opens a private channel, adds Michael and
  posts the brief mentioning him, so he researches there and saves findings in
  the folder. Projects can be pinned (they also appear under Research in the
  sidebar), given a cover image (copied to `.buzz/cover.*` in the folder),
  renamed, re-briefed, opened in Explorer, and taken off the list (the folder
  stays). UI: `features/research/`.

## Architecture (as built)

- **Shell:** Buzz desktop (Tauri + React 19).
- **Office backend:** Munder Difflin's Electron main process, **unmodified**
  (`out/main/index.js`), run as a sidecar by `src/sidecar/launcher.cjs`, which
  routes every `require('electron')` to `src/sidecar/electron-shim.cjs`.
  Runtime is Electron in Node mode (`ELECTRON_RUN_AS_NODE=1`) so the
  Electron-ABI `node-pty` / `better-sqlite3` builds load as-is.
- **Transport:** `src/sidecar/server.cjs` — loopback-only WebSocket, per-launch
  token (constant-time compare). Wire format in `src/sidecar/wire.cjs`.
- **Office UI:** Munder's renderer + preload, **unmodified**, built with
  `sidecar.web.vite.config.ts`, which swaps `electron` for
  `src/sidecar-web/electron-renderer-shim.ts`. Output goes to
  `desktop/public/office-app/` (`just office-web`).
- **Hosting:** `desktop/src/features/office/ui/OfficeScreen.tsx` loads the UI in
  a same-origin iframe. Connection details ride in the URL fragment. Native
  capabilities (file pickers, links, notifications) come back to Buzz over
  `postMessage` and run via Tauri plugins (`officeHostCalls.ts`).
- **Lifecycle:** `desktop/src-tauri/src/office.rs`. Started lazily on first
  Office open (`office_connect`), stopped from Buzz's shutdown path by closing
  the sidecar's stdin; hard kill after 6 s.
- **Secrets:** sidecar `safeStorage` = AES-256-GCM keyed by a 32-byte master key
  Buzz keeps in the OS keyring (`office.master-key`), passed as `MD_MASTER_KEY`.

### Changes from the original plan

- **No React 18 → 19 port.** The Office UI runs isolated in an iframe with its
  own React 18 bundle, so neither app's styles, stores or React version collide.
- **No backend fork.** The Electron stand-in replaces porting 12 Electron-coupled
  files; the 5,400-line `index.ts` is untouched.

### Electron API mapping

| Electron | Sidecar behaviour |
|---|---|
| `app.*` | paths from `MD_USER_DATA`, quit sequence emulated |
| `ipcMain` | handlers dispatched from WebSocket `invoke` / `send` / `sync` |
| `BrowserWindow`, `webContents` | virtual windows; `send()` buffered until a UI attaches |
| `safeStorage` | AES-256-GCM with `MD_MASTER_KEY` |
| `shell`, `dialog`, `Notification` | forwarded to the UI host |
| `dialog.showMessageBoxSync` | answers the dialog's own `cancelId` (non-destructive) |
| `clipboard` | OS clipboard via PowerShell / pbcopy / xclip |
| `powerMonitor`, `powerSaveBlocker`, `screen`, `Menu` | inert stand-ins |
| `ipcRenderer.sendSync` (3 calls) | answered from a cache primed at boot, refreshed per read |

## Running it (dev)

```bash
# once, in ../munder-difflin (see Windows notes)
npm ci --ignore-scripts && npx electron-rebuild -f && npm run build
# Office UI into Buzz
just office-web
# Buzz desktop
cargo build --manifest-path desktop/src-tauri/Cargo.toml
(cd desktop && ./node_modules/.bin/vite --port 1420 --strictPort) &
BUZZ_OFFICE_DIR=../munder-difflin desktop/src-tauri/target/debug/buzz-desktop.exe
```

## Windows build notes

- `NoDefaultCurrentDirectoryInExePath=1` (set by some agent shells) breaks
  node-pty's winpty `GetCommitHash.bat` step. Unset it for native builds.
- Node 24 native builds need the VS **ClangCL** component; Electron builds don't.
  Skipping Node-ABI builds (`--ignore-scripts`) avoids it.
- node-pty requires VS **Spectre-mitigated libs**. Dev builds patch
  `SpectreMitigation` off in `node_modules/node-pty` (local only). **Install the
  Spectre libs component before release builds.**
- Electron's `install.js` left a half-extracted `dist/`; extracting the cached
  zip manually and writing `path.txt` fixed it.
- `audiopus_sys` needs CMake; VS Build Tools ships one under
  `Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin` (add to PATH).
- Bash-based `just` recipes need Git Bash's `cygpath`: run `just` from Git Bash.

## Remaining milestones

- **M4 Hive on Buzz:** each office agent gets a Nostr keypair and is a workspace
  member; hive messages travel as Buzz DMs / channel events; @Michael in a
  channel routes to the god agent; local git hive kept as audit trail.
- **M5 Package + verify:** bundle the office runtime under `resources/office`
  (Electron runtime, `out/`, `src/sidecar/`, prod `node_modules`) and
  `public/office-app`; Windows installer; end-to-end test.

## Licensing

Repo stays Apache-2.0. Munder Difflin code keeps its MIT notice. Office tilesets
are LimeZu "Modern Interiors" (credit required, see Munder's `LICENSE-ASSETS`
and `src/renderer/src/assets/ATTRIBUTION.md`); M5 must ship that credit.
