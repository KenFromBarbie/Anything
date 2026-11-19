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

_In progress._
