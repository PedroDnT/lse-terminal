"""
Compute-environment inspection for the MACHINE LEARNING tab.

Answers two questions for the UI: which optional ML libraries are installed,
and is there a usable GPU. Torch is probed in a short-lived subprocess
because importing it in the server process costs seconds and hundreds of MB
that a user who never opens the ML tab should not pay.
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import threading
from importlib import metadata
from typing import Any, Dict, List, Optional

_gpu_cache: Optional[Dict[str, Any]] = None
_gpu_lock = threading.Lock()

_TORCH_PROBE = (
    "import json\n"
    "try:\n"
    "    import torch\n"
    "    info = {'torch': torch.__version__, 'cuda': torch.cuda.is_available(), 'mps': False}\n"
    "    if info['cuda']:\n"
    "        p = torch.cuda.get_device_properties(0)\n"
    "        info['device'] = torch.cuda.get_device_name(0)\n"
    "        info['vram_mb'] = getattr(p, 'total_memory', 0) // (1024 * 1024)\n"
    "        info['cuda_version'] = torch.version.cuda\n"
    # Apple Silicon: the Mac GPU is torch's MPS backend, not CUDA. getattr
    # guard for torch builds that predate torch.backends.mps. MPS exposes no
    # device name or VRAM figure; unified memory has no fixed VRAM anyway.
    "    else:\n"
    "        mps = getattr(torch.backends, 'mps', None)\n"
    "        if mps is not None and mps.is_available():\n"
    "            info['mps'] = True\n"
    "            info['device'] = 'Apple Silicon GPU (MPS)'\n"
    "except Exception as e:\n"
    "    info = {'torch': None, 'cuda': False, 'error': str(e)[:200]}\n"
    "print(json.dumps(info))\n"
)


def python_argv(script, *args: str) -> List[str]:
    """argv that runs a .py file the way `python script.py <args>` would.

    In a source install sys.executable IS a Python, so handing it the script
    is right. In the FROZEN desktop sidecar sys.executable is the lset app
    itself: handing it a script made argparse exit 2 with "lset: error:
    unrecognized arguments", which is how every Python IDE RUN and ML job
    failed on desktop. The frozen build re-enters
    through cli.py --run-script, which forwards the script's own args and
    runs it under the bundled interpreter (pandas/torch included).
    """
    if getattr(sys, "frozen", False):
        return [sys.executable, "--run-script", str(script), *args]
    return [sys.executable, str(script), *args]


def dep_installed(import_name: str) -> bool:
    # Libraries the user installs from the ML tab land in a directory that
    # was usually EMPTY, often absent, when this process started, and the
    # import system caches that per-directory answer. Without dropping those
    # caches a just-installed package keeps reporting "not installed" until
    # the app is restarted, which is the whole point of the one-click install.
    importlib.invalidate_caches()
    try:
        return importlib.util.find_spec(import_name) is not None
    except (ImportError, ValueError):
        return False


# ── Install records: what the ML tab downloaded, when, how big ────────
# The Libraries panel answers "what did I download and is it in place?" from
# this file plus a live find_spec. Written by the install endpoint on a
# successful pip run; a missing or damaged file just means "no record",
# never an error (keeps the library state intuitive, not alarming).
def installs_path():
    from lse_terminal.engine.config import config_dir
    return config_dir() / "ml" / "installs.json"


def load_installs() -> Dict[str, Dict[str, Any]]:
    try:
        data = json.loads(installs_path().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def record_install(packages: List[str], downloaded_mb: Dict[str, float],
                   versions: Dict[str, Optional[str]],
                   run_mb: float = 0.0, run_packages: int = 0) -> None:
    """One record per requested package: its version, when, its own wheel
    size, and the whole run's figures (everything pip fetched for that
    click, dependencies included, and how many packages that was), so the
    panel can say "0.9 MB, 15 MB with its dependencies"."""
    import time
    recs = load_installs()
    for name in packages:
        recs[name] = {"version": versions.get(name),
                      "at": int(time.time()),
                      "downloaded_mb": round(float(downloaded_mb.get(name, 0.0)), 1),
                      "run_mb": round(float(run_mb), 1),
                      "run_packages": int(run_packages),
                      "with": [p for p in packages if p != name]}
    try:
        path = installs_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(recs, indent=2), encoding="utf-8")
    except OSError:
        pass


def packages_dir_str() -> str:
    """Where the ML tab's installs land (the frozen build's user-packages
    folder), for the panel's 'installed at' line. Source runs install into
    the interpreter's own site-packages, so say that instead."""
    if getattr(sys, "frozen", False):
        from lse_terminal.cli import user_packages_dir
        return str(user_packages_dir())
    return "this Python environment (site-packages)"


def dep_status(models: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Per-pip-package install status across the whole catalog: installed
    flag + version, the models the package unlocks, and the install record
    (when, how many MB were downloaded) when the ML tab did the install."""
    seen: Dict[str, str] = {}
    unlocks: Dict[str, List[str]] = {}
    for m in models:
        for pip_name, import_name in zip(m.get("deps", []), m.get("dep_imports", [])):
            seen[pip_name] = import_name
            unlocks.setdefault(pip_name, []).append(m.get("name") or m.get("key"))
    recs = load_installs()
    out: Dict[str, Dict[str, Any]] = {}
    for pip_name, import_name in seen.items():
        installed = dep_installed(import_name)
        version = None
        if installed:
            try:
                version = metadata.version(pip_name)
            except Exception:
                version = "unknown"
        rec = recs.get(pip_name) or {}
        out[pip_name] = {"installed": installed, "version": version,
                         "models": unlocks.get(pip_name, []),
                         "installed_at": rec.get("at") if installed else None,
                         "downloaded_mb": rec.get("downloaded_mb") if installed else None,
                         "run_mb": rec.get("run_mb") if installed else None,
                         "run_packages": rec.get("run_packages") if installed else None}
    return out


# pip's own progress lines, turned into something a person can read while
# a library downloads. PIP_PROGRESS_BAR is off, so the stream is one line
# per step: "Collecting torch", "Downloading torch-2.13.0-cp311-win_amd64.whl
# (122.0 MB)", "Using cached ...", "Installing collected packages: ...",
# "Successfully installed ...".
_RE_DL = re.compile(r"(Downloading|Using cached)\s+(?P<file>\S+?\.(?:whl|tar\.gz|zip))\s+\((?P<size>[\d.]+)\s*(?P<unit>[kKMG]B)\)")
_RE_COLLECT = re.compile(r"^\s*Collecting\s+(?P<pkg>[A-Za-z0-9_.\-]+)")
_RE_INSTALLING = re.compile(r"^\s*Installing collected packages:\s*(?P<pkgs>.+)$")
_RE_DONE = re.compile(r"^\s*Successfully installed\s+(?P<pkgs>.+)$")


def norm_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_pip_line(line: str) -> Optional[Dict[str, Any]]:
    """One pip line -> {stage, package, version, size_mb, cached} or None."""
    m = _RE_DL.search(line)
    if m:
        fname = m.group("file").rsplit("/", 1)[-1]
        base = fname.split(".whl")[0].split(".tar.gz")[0].split(".zip")[0]
        parts = base.split("-")
        pkg = parts[0]
        ver = parts[1] if len(parts) > 1 else ""
        size = float(m.group("size"))
        unit = m.group("unit").lower()
        mb = size / 1024.0 if unit == "kb" else size * 1024.0 if unit == "gb" else size
        return {"stage": "download", "package": norm_name(pkg), "version": ver,
                "size_mb": round(mb, 1), "cached": m.group(1) == "Using cached"}
    m = _RE_COLLECT.match(line)
    if m:
        return {"stage": "collect", "package": norm_name(m.group("pkg"))}
    m = _RE_INSTALLING.match(line)
    if m:
        pkgs = [p.strip() for p in m.group("pkgs").split(",") if p.strip()]
        return {"stage": "install", "count": len(pkgs)}
    m = _RE_DONE.match(line)
    if m:
        return {"stage": "done", "packages": m.group("pkgs").split()}
    return None


def gpu_info(refresh: bool = False) -> Dict[str, Any]:
    """CUDA availability via a torch subprocess probe; cached after first call."""
    global _gpu_cache
    with _gpu_lock:
        if _gpu_cache is not None and not refresh:
            return _gpu_cache
        if not dep_installed("torch"):
            _gpu_cache = {"torch": None, "cuda": False}
            return _gpu_cache
        try:
            proc = subprocess.run(
                [sys.executable, "-c", _TORCH_PROBE],
                capture_output=True, text=True, timeout=60,
            )
            _gpu_cache = json.loads(proc.stdout.strip().splitlines()[-1])
        except Exception as e:
            _gpu_cache = {"torch": "unknown", "cuda": False, "error": str(e)[:200]}
        return _gpu_cache


def allowed_packages(models: List[Dict[str, Any]]) -> Dict[str, str]:
    """pip name -> import name union over the catalog; the install endpoint's allowlist."""
    allowed: Dict[str, str] = {}
    for m in models:
        for pip_name, import_name in zip(m.get("deps", []), m.get("dep_imports", [])):
            allowed[pip_name] = import_name
    return allowed
