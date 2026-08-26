"""Durable chart workspace: ~/.config/lse-terminal/workspace.json.

Holds everything the user builds up inside the chart - drawings (per symbol),
saved layouts, chart settings, indicator setups, drawing-tool shortcuts and the
watchlist.

Why a file and not browser storage: the terminal is an app people download and
run, so their work has to survive a browser cache clear, a reinstall and a
machine move, and it has to be copyable/backup-able like any other document.
localStorage fails all of those (the shell already ships a cache-buster because
stale browser state caused real bugs).

Layout is one JSON document of independent top-level sections. Each section is
read and written whole; sections never merge across each other, so a corrupt or
unknown section can be dropped without taking the rest of the workspace with it.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from lse_terminal.engine import config

# Sections the API will accept. An allowlist rather than free-form keys so a
# bug (or a malicious page on the same origin) cannot grow the file unbounded
# with junk top-level keys.
SECTIONS = frozenset({
    "settings",            # chart appearance settings
    "settings_templates",  # saved appearance presets
    "drawing_shortcuts",   # keyboard shortcuts for drawing tools
    "watchlist",           # symbols pinned in the sidebar
    "layouts",             # saved chart layouts
    "drawings",            # per-symbol drawings, keyed "provider:symbol"
    "indicators",          # per-symbol indicator configuration
    "tools",               # drawing-tool defaults + favourites
    "backtests",           # saved manual-backtest sessions (bar replay)
    "econcal",             # economic calendar view preferences
    "shell",               # shell session state: active indicators + chart type
    "dataviz",             # data visualisation prefs (palette, last chart type)
})


def path() -> Path:
    return config.config_dir() / "workspace.json"


def load() -> dict:
    try:
        data = json.loads(path().read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    # A hand-edited file that is valid JSON but not an object would break every
    # caller's .get(); treat it as empty rather than raising on every request.
    return data if isinstance(data, dict) else {}


def save(doc: dict) -> None:
    d = config.config_dir()
    d.mkdir(parents=True, exist_ok=True)
    target = path()
    # Atomic replace: a crash or a full disk mid-write must not truncate an
    # existing workspace. Write a sibling temp file, fsync, then rename.
    fd, tmp = tempfile.mkstemp(dir=str(d), prefix=".workspace-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, target)
    except BaseException:
        # Leave the previous file untouched on any failure.
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def get(section: str):
    return load().get(section)


def put(section: str, value) -> None:
    doc = load()
    doc[section] = value
    save(doc)
