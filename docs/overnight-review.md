# Overnight review: Anything

A running log from an unattended night of testing, fixing and reviewing. Newest notes at the bottom of each section.

## Fixed tonight

| Area | Problem | Fix |
|---|---|---|
| Sign-in | Claude sign-in always ended in "OAuth error: aborted" | The local Claude relay destroyed both sides of a connection on `end`, cutting off any reply followed by a close (the token reply). It now lets `pipe()` pass the end on. Sign-in goes through the relay again; direct connections are cut by the router about half the time. |
| Sign-in | App sign-in windows opened Claude's full-screen `/login` with no diagnostics | They run `claude auth login` with a debug log next to the account. |
| Two accounts | Floor workers on an unsigned account each opened a browser sign-in and were removed seconds later | Workers use the managers' account until theirs is signed in. |
| Two accounts | Workers on a new account stopped at "Do you trust this folder?" | Folder trust is pre-accepted on both the managers' and the workers' accounts. |
| Two accounts | Restarted workers failed with "No conversation found" | Their conversation is copied into the account folder they actually run on. |
| Orchestration | One worker per revision round redid the whole 3D model alone | Rules and a harness check: split by component, all hired at once; the CEO never caps an executive's hires. Executives with a board task assigned to themselves are told to hand it to workers. |
| Live view | Two streams for one model; office bookkeeping (tasks.json, hire requests) shown as streams and "simulations" | 3D work in one model's folder is one stream with every agent listed; office files aren't streams. |
| Live view | 3D stream preview showed a grey "3D scene" box | The model renders live, slowly turning. |
| 3D editor | The agent's "cursor" was a corner tag for 6 s | An arrow and name pinned on the changed part, following the camera. |
| Performance | 15–16 s freezes | Boolean (Cut/Join/Intersect) results are cached by shape instead of recomputed for every view and version. |
| Performance | The 3D engine redrew 60×/s while idle; the background floor ran full rate | Draw on demand (rest when idle or off screen); background floor at 30 fps. |
| Live view | Build scripts for 3D parts were labelled "Making an image", "Running a simulation" or "Designing clothing" from loose words in the script | A script that writes a 3D file is 3D work; explicit simulation/cloth calls still win (loads at the next restart). |
| Live view | My bookkeeping filter also hid real work in the hive's shared folder (caught by `presence.test.cjs`) | `hive/shared` counts as work. |
| Learn | The course plan (syllabus.md) was only visible in the folder | A Plan tab renders it in the course, refreshed every minute. |
| Learn | Lessons could only be HTML or PDF | Editor-built lessons (slides, documents, sheets, 3D) open in the editors; a per-course "My notes" document the tutor reads; the Office's guide builds lessons with the editors. |

## Open findings

- The app exited by itself twice during the day (probably memory pressure: about 1 GB free at the time, the webview at 5 GB).
- Learn courses are global, not per server; the Dutch course shows in Boat Bike as well as Wittenborg.
- The office test suite has 17 environmental failures (path containment under the packaged-app file layout).

## Vision review (head of product, Claude team view)

### What Anything is

A workspace where you run a company of AI agents the way you'd run a small firm. A CEO takes your request, executives split it by area, floor workers do the work, and you watch it happen. Two ideas make it different from other agent tools:

1. **Agents work in your tools, not in a chat box.** The editors (documents, slides, sheets, images, video, sites, 3D) are shared with the agents, so their output is something you can open, change and keep, not a transcript.
2. **You can see the work.** The office floor, live streams and cursors in the editors make a team of agents watchable and steerable, like colleagues in a shared document.

That combination is the product's moat. Most agent products stop at "the agent did it, here's a summary". Anything's bet is that people trust and direct agents better when they can watch them work in familiar tools.

### What's working

- **The chain of command fits real work.** CEO → executives → floor workers gives a natural place for review: executives don't build, they check. Tonight, a multi-part 3D build ran with 6–8 workers in parallel on separate parts once the rules were enforced.
- **Editors as the shared medium** is the right primitive. Live follow, pinned cursors and "Edit in …" turn agent output into a collaborative artifact.
- **Learn** shows how the platform generalises: the same office plans a course, builds lessons and adapts to progress.

### What holds it back (in priority order)

1. **Reliability before features.** Most of tonight's problems were plumbing: sign-ins failing through the relay, a second account missing folder trust, resumed agents losing their conversation, the app freezing or closing under memory pressure. A user who hits two of these in a session stops trusting the agents, however good their work is. A short "boring" list should gate releases: sign-in, account switching, restart/resume, memory ceiling.
2. **Orchestration needs enforcement, not only instructions.** Executives repeatedly fell back to one worker doing everything. Prompt rules plus harness nudges helped. The durable fix is structural: the harness should plan parallel work (component split, assembler, checker) as a first-class object, with the executive filling it in.
3. **Make the agents' tools first-class.** Workers still often build 3D parts with Python scripts that write GLB files, which the editors can only show, not follow. The more of the work goes through editor formats (`.model.json` operations), the better the live view, cursors and undo get. Give agents a proper editor API (operations, not whole-file rewrites), and the "shared document" promise becomes literal.
4. **Resource budget per machine.** Each builder costs about 1.2 GB. The app should know the machine's ceiling and schedule workers (queue, pause, resume) instead of letting the OS swap or the app close.
5. **Multi-account as a product concept.** Separate accounts for managers and workers is a smart way to spread limits. Make it visible: which agent runs on which account, live usage per account, and an automatic switch when one nears its limit.

### Where it could go

- **From "office" to "studio for physical products".** Boat Bike shows the strongest use: research, 3D, simulation, pricing and suppliers in one place, with agents doing the legwork. A focused vertical (product design with 3D, simulation and costing) would sharpen the pitch.
- **Learn as a second pillar.** Adaptive courses built from your own material, with the tutor reading your notes and progress, is a product people will pay for on its own.
- **Replayable work.** Each stream could become a timeline you scrub after the fact (who changed what, when), which turns oversight into review and makes trust cheap.

### Three bets for the next month

1. A release gate of reliability checks (sign-in, resume, memory, account switch), run before every build.
2. Structured parallel plans in the harness (parts, assembler, checker), not only prompt rules.
3. An operations API for the editors, so agents edit like a person does and every change is followable.
