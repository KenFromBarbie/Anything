"""modeleval: the Office's shared 3D evaluation service.

Every builder used to load the whole assembled model into its own Python
process to check its part (0.5-1.2 GB each, the same boat many times over).
This keeps evaluated models in ONE background process, reloads only what
changed on disk, and runs the floor's check scripts inside it, one at a time.

    python modeleval.py eval <file.model.json> [--json out.json]
        Summary of the evaluated model (parts, triangles, watertight, volume,
        bounds, mass), from the shared cache.
    python modeleval.py glb <file.model.json> <out.glb>
        Export the evaluated model as a .glb.
    python modeleval.py run <script.py> [args ...]
        Run a check script (float, clearance, render, ...) inside the service.
        In it, `import havik_eval` / `import model_eval` give the shared
        evaluator, and evaluate(path) returns the cached model (a copy you may
        change freely). The script's prints come back here; its exit code too.
    python modeleval.py status | stop

The first command starts the service; it stops itself after 20 idle minutes.
Commands queue: one evaluation or script runs at a time.
"""
import contextlib
import copy
import io
import json
import os
import runpy
import socket
import subprocess
import sys
import threading
import time
import traceback
import types

HOST = "127.0.0.1"
PORT = int(os.environ.get("MODELEVAL_PORT", "47861"))
IDLE_S = 20 * 60
KEEP_MODELS = 4
HERE = os.path.dirname(os.path.abspath(__file__))


# ─── client ──────────────────────────────────────────────────────────────────

def _send(req, timeout=None):
    with socket.create_connection((HOST, PORT), timeout=10) as s:
        s.settimeout(timeout)
        s.sendall(json.dumps(req).encode("utf-8") + b"\n")
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(1 << 20)
            if not chunk:
                break
            buf += chunk
    return json.loads(buf.decode("utf-8"))


def _up():
    try:
        return _send({"cmd": "ping"}, timeout=5).get("ok") is True
    except OSError:
        return False


def _start():
    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x00000200 | 0x08000000  # DETACHED, NEW_GROUP, NO_WINDOW
    subprocess.Popen(
        [sys.executable, os.path.abspath(__file__), "serve"],
        cwd=HERE, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=flags, close_fds=True,
    )
    for _ in range(100):
        time.sleep(0.2)
        if _up():
            return True
    return False


def client(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cmd = argv[0]
    if cmd == "serve":
        return serve()
    if cmd == "stop":
        if _up():
            _send({"cmd": "stop"}, timeout=10)
        print("stopped")
        return 0
    if not _up() and not _start():
        print("modeleval: could not start the service", file=sys.stderr)
        return 2
    cwd = os.getcwd()
    if cmd == "status":
        r = _send({"cmd": "status"}, timeout=10)
    elif cmd == "eval" and len(argv) >= 2:
        r = _send({"cmd": "eval", "path": os.path.abspath(argv[1])})
        if r.get("ok") and "--json" in argv:
            out = argv[argv.index("--json") + 1]
            with open(out, "w", encoding="utf-8") as fh:
                json.dump(r["summary"], fh, indent=1)
    elif cmd == "glb" and len(argv) >= 3:
        r = _send({"cmd": "glb", "path": os.path.abspath(argv[1]), "out": os.path.abspath(argv[2])})
    elif cmd == "run" and len(argv) >= 2:
        r = _send({"cmd": "run", "script": os.path.abspath(argv[1]), "args": argv[2:], "cwd": cwd})
    else:
        print(__doc__)
        return 2
    if cmd == "run":
        sys.stdout.write(r.get("stdout", ""))
        sys.stderr.write(r.get("stderr", ""))
        if not r.get("ok"):
            sys.stderr.write(r.get("error", "") + "\n")
        return int(r.get("code", 0 if r.get("ok") else 1))
    if cmd == "eval" and r.get("ok"):
        s = r["summary"]
        tris = sum(n["tris"] for n in s["nodes"])
        print(f"nodes: {len(s['nodes'])}  tris: {tris}  ({'cached' if r.get('cached') else 'evaluated'} in {r.get('seconds')} s)")
        for n in s["nodes"]:
            print(f"  {n['name']}: {n['tris']} tris, watertight={n['watertight']}, volume={n['volume_m3']}, bounds={n['bounds']}")
        print("approximations:", s["approximations"])
        print("warnings:", s["warnings"])
        return 0
    print(json.dumps(r, indent=1))
    return 0 if r.get("ok") else 1


# ─── service ─────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_last = [time.time()]
_cache = {}  # path -> {"deps": {file: mtime}, "nodes": [...], "summary": {...}, "at": t}
_me = None   # the evaluator module


def _evaluator():
    global _me
    if _me is None:
        sys.path.insert(0, HERE)
        import model_eval  # noqa: E402
        _me = model_eval
    return _me


def _deps(path, seen=None):
    """Every file the model reads (itself, imported .model.json and meshes)."""
    seen = {} if seen is None else seen
    path = os.path.abspath(path)
    if path in seen:
        return seen
    try:
        seen[path] = os.path.getmtime(path)
    except OSError:
        seen[path] = None
        return seen
    if path.lower().endswith(".model.json"):
        try:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
        except Exception:
            return seen
        for o in doc.get("objects", []):
            src = o.get("src") if o.get("kind") == "import" else None
            if isinstance(src, str) and src:
                _deps(src, seen)
    return seen


def _fresh(entry):
    return all((os.path.getmtime(p) if os.path.exists(p) else None) == m for p, m in entry["deps"].items())


def _model(path):
    """The evaluated model, from the cache while none of its files changed."""
    path = os.path.abspath(path)
    entry = _cache.get(path)
    if entry and _fresh(entry):
        entry["at"] = time.time()
        return entry, True
    me = _evaluator()
    deps = _deps(path)
    nodes = me.evaluate(path)
    entry = {"deps": deps, "nodes": nodes, "summary": me.summary(nodes), "at": time.time()}
    _cache[path] = entry
    while len(_cache) > KEEP_MODELS:
        oldest = min(_cache, key=lambda k: _cache[k]["at"])
        del _cache[oldest]
    return entry, False


def _copy_nodes(nodes):
    out = []
    for nd in nodes:
        c = dict(nd)
        for k, v in nd.items():
            if k == "trimesh":
                c[k] = v.copy()
            elif hasattr(v, "copy") and not isinstance(v, (str, bytes)):
                c[k] = copy.copy(v) if not hasattr(v, "shape") else v.copy()
        out.append(c)
    return out


def _shim():
    """The evaluator as check scripts import it, serving evaluate() from the cache."""
    me = _evaluator()
    mod = types.ModuleType("model_eval")
    mod.__dict__.update({k: v for k, v in me.__dict__.items() if not k.startswith("__")})
    mod.__file__ = me.__file__

    def evaluate(path):
        entry, _ = _model(path)
        return _copy_nodes(entry["nodes"])

    mod.evaluate = evaluate
    return mod


def _run(script, args, cwd):
    shim = _shim()
    before = set(sys.modules)
    saved = (list(sys.argv), os.getcwd(), list(sys.path), sys.modules.get("havik_eval"), sys.modules.get("model_eval"))
    out, err = io.StringIO(), io.StringIO()
    code = 0
    try:
        sys.modules["havik_eval"] = shim
        sys.modules["model_eval"] = shim
        sys.argv = [script] + list(args)
        os.chdir(cwd)
        sys.path.insert(0, os.path.dirname(script))
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                runpy.run_path(script, run_name="__main__")
            except SystemExit as e:
                code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
                if not isinstance(e.code, int) and e.code is not None:
                    print(e.code, file=sys.stderr)
            except BaseException:
                traceback.print_exc()
                code = 1
    finally:
        sys.argv, _, sys.path[:] = saved[0], None, saved[2]
        os.chdir(saved[1])
        for name, mod in (("havik_eval", saved[3]), ("model_eval", saved[4])):
            if mod is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = mod
        # Forget the script's own helper modules, so the next run reads them fresh.
        sdir = os.path.dirname(os.path.abspath(script)).lower()
        for name in set(sys.modules) - before:
            f = getattr(sys.modules.get(name), "__file__", None) or ""
            if f and os.path.abspath(f).lower().startswith(sdir):
                sys.modules.pop(name, None)
    return {"ok": code == 0, "code": code, "stdout": out.getvalue(), "stderr": err.getvalue()}


def _handle(req):
    cmd = req.get("cmd")
    if cmd == "ping":
        return {"ok": True}
    if cmd == "status":
        return {"ok": True, "pid": os.getpid(), "models": [{"path": p, "files": len(e["deps"])} for p, e in _cache.items()]}
    t0 = time.time()
    with _lock:
        if cmd == "eval":
            entry, cached = _model(req["path"])
            return {"ok": True, "cached": cached, "seconds": round(time.time() - t0, 2), "summary": entry["summary"]}
        if cmd == "glb":
            entry, cached = _model(req["path"])
            _evaluator().to_scene(entry["nodes"]).export(req["out"])
            return {"ok": True, "cached": cached, "out": req["out"], "seconds": round(time.time() - t0, 2)}
        if cmd == "run":
            r = _run(req["script"], req.get("args", []), req.get("cwd") or os.getcwd())
            r["seconds"] = round(time.time() - t0, 2)
            return r
    return {"ok": False, "error": f"unknown command {cmd!r}"}


def serve():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind((HOST, PORT))
    except OSError:
        return 0  # already running
    srv.listen(16)
    srv.settimeout(5)

    def conn(c):
        try:
            buf = b""
            while not buf.endswith(b"\n"):
                chunk = c.recv(1 << 20)
                if not chunk:
                    break
                buf += chunk
            req = json.loads(buf.decode("utf-8") or "{}")
            if req.get("cmd") == "stop":
                c.sendall(b'{"ok": true}\n')
                os._exit(0)
            try:
                res = _handle(req)
            except Exception as e:  # never take the service down
                res = {"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]}
            c.sendall(json.dumps(res).encode("utf-8") + b"\n")
        finally:
            _last[0] = time.time()
            c.close()

    while True:
        try:
            c, _ = srv.accept()
        except socket.timeout:
            if time.time() - _last[0] > IDLE_S and not _lock.locked():
                return 0
            continue
        _last[0] = time.time()
        threading.Thread(target=conn, args=(c,), daemon=True).start()


if __name__ == "__main__":
    sys.exit(client(sys.argv[1:]))
