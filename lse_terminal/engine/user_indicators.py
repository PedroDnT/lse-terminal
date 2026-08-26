"""User-authored indicators: plain .py files in the config directory,
hot-loaded into the same registry as built-ins.

The editing story of the terminal: a user writes the same one-file indicator
a contributor would PR, saves it in-app, and it appears in the picker
immediately. Files live in ``<config>/indicators/*.py`` so they survive
upgrades and are trivially shareable (send someone the file).
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

from lse_terminal.contracts.indicator import REGISTRY
from lse_terminal.engine.config import config_dir

# Brue-language indicator scripts.
BRUE_EXTS = (".brue",)

TEMPLATE = '''"""My indicator. Edit the math, rename it, press Save.

The function receives the candle DataFrame (columns: ts, open, high, low,
close, volume) and must return a Series (one line) or DataFrame (multi-line).
overlay=True draws on the price chart; False gets its own pane.
"""

from lse_terminal import indicator


@indicator("my_indicator", title="My Indicator",
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 500}})
def my_indicator(df, length=20):
    return df["close"].rolling(length).mean()
'''


def indicators_dir() -> Path:
    d = config_dir() / "indicators"
    d.mkdir(parents=True, exist_ok=True)
    return d


class UserIndicators:
    """Loads user indicator files and tracks which registry names each file
    registered, so saves and deletes replace cleanly instead of accreting."""

    def __init__(self):
        self.file_names: dict[str, list[str]] = {}   # filename -> registry names
        self.file_errors: dict[str, str] = {}        # filename -> load error

    def load_all(self) -> None:
        for path in sorted(indicators_dir().glob("*.py")):
            self.load_file(path.name)
        # Brue-language indicators live in the SAME folder: one place for
        # a user's indicators regardless of language. Both extensions load
        # (BRUE_EXTS): a file under the previous extension is a Brue script.
        for path in sorted(p for ext in BRUE_EXTS
                           for p in indicators_dir().glob(f"*{ext}")):
            self.load_file(path.name)

    def load_file(self, filename: str) -> str | None:
        """(Re)load one file. Returns an error string or None on success."""
        path = indicators_dir() / filename
        # Drop whatever this file registered last time, then re-register.
        for name in self.file_names.pop(filename, []):
            REGISTRY.pop(name, None)
        self.file_errors.pop(filename, None)

        before = set(REGISTRY)
        if filename.endswith(BRUE_EXTS):
            # Brue-language indicator (.brue, or the previous extension): the
            # engine package compiles and registers it; script errors surface
            # like Python load errors.
            from lse_terminal.engine import brue_indicators
            try:
                names = brue_indicators.register_brue_source(
                    path.stem, path.read_text())
            except Exception as e:
                err = f"{type(e).__name__}: {e}"
                self.file_errors[filename] = err
                return err
            self.file_names[filename] = names
            return None
        mod_name = f"lse_terminal_user.{path.stem}"
        try:
            source = path.read_text()
            module = types.ModuleType(mod_name)
            module.__file__ = str(path)
            sys.modules[mod_name] = module
            # exec the source directly instead of SourceFileLoader: the loader
            # trusts __pycache__ keyed on (mtime seconds, size), so a rapid
            # save with unchanged length re-runs STALE bytecode. Hot-reload
            # must always execute what is on disk right now.
            exec(compile(source, str(path), "exec"), module.__dict__)
        except Exception as e:
            # Roll back anything a half-executed file managed to register:
            # a broken user file must never leave ghosts in the picker.
            for name in set(REGISTRY) - before:
                REGISTRY.pop(name, None)
            err = f"{type(e).__name__}: {e}"
            self.file_errors[filename] = err
            return err

        self.file_names[filename] = sorted(set(REGISTRY) - before)
        return None

    def save(self, filename: str, source: str) -> str | None:
        if ("/" in filename or "\\" in filename or filename.startswith(".")):
            return "filename must be a plain name ending in .py or .brue"
        if not filename.endswith((".py", ".brue")):
            return "filename must be a plain name ending in .py or .brue"
        (indicators_dir() / filename).write_text(source)
        return self.load_file(filename)

    @staticmethod
    def _plain_name(filename: str) -> bool:
        # One path segment inside the indicators folder, nothing else: the
        # read and delete routes take the name from the URL and pathlib
        # treats a backslash as a separator on Windows, so the same rule
        # save() enforces applies before the folder is ever joined.
        return bool(filename) and "/" not in filename and "\\" not in filename \
            and not filename.startswith(".") and filename.endswith((".py",) + BRUE_EXTS)

    def delete(self, filename: str) -> None:
        if not self._plain_name(filename):
            return
        for name in self.file_names.pop(filename, []):
            REGISTRY.pop(name, None)
        self.file_errors.pop(filename, None)
        path = indicators_dir() / filename
        if path.exists():
            path.unlink()

    def read(self, filename: str) -> str | None:
        if not self._plain_name(filename):
            return None
        path = indicators_dir() / filename
        return path.read_text() if path.exists() else None

    def listing(self) -> list[dict]:
        files = sorted({p.name for p in indicators_dir().glob("*.py")}
                       | {p.name for ext in BRUE_EXTS
                          for p in indicators_dir().glob(f"*{ext}")}
                       | set(self.file_errors))
        return [
            {"file": f, "names": self.file_names.get(f, []),
             "error": self.file_errors.get(f)}
            for f in files
        ]
