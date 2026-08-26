"""Notebooks: infinite-canvas research documents.

~/.config/lse-terminal/notebooks/<id>.json, one file per notebook, with the
images they contain kept beside them under notebooks/assets/.

Why a directory of files and not a workspace.json section: a notebook holds a
person's thinking, it grows without bound (a canvas has no page), and it is
the kind of thing people copy, mail and back up on its own. One document per
file means a corrupt or hand-edited notebook loses that notebook and nothing
else, and a canvas that has grown to megabytes of ink never has to be read or
rewritten just because some unrelated chart setting changed.

The document shape is the canvas itself, deliberately dumb: a list of blocks,
each with a position, a size and a payload. The engine does not interpret
blocks (it never renders them), so a new block type is a frontend change with
no migration here.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

from lse_terminal.engine import config

# Image bytes only, and only formats a browser will render inline. An asset
# name is generated here and never taken from the client, so an upload cannot
# choose its own extension, escape the folder, or land as .html/.svg (both are
# script-bearing on a same-origin page).
ASSET_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
MAX_ASSET_BYTES = 12 * 1024 * 1024
# A canvas is unbounded by design, but a single POST that big is a bug or an
# attack, not a notebook: 40 MB is thousands of blocks and thousands of ink
# strokes with the image bytes living outside the document as assets.
MAX_DOC_BYTES = 40 * 1024 * 1024

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
_ASSET_RE = re.compile(r"^[a-f0-9]{32}\.(png|jpg|gif|webp)$")


def dir_() -> Path:
    return config.config_dir() / "notebooks"


def assets_dir() -> Path:
    return dir_() / "assets"


def _path(nid: str) -> Path:
    # Every id that reaches the filesystem is matched against the allowlist
    # first, so "../../config.json" is a 404 rather than a path traversal.
    if not _ID_RE.match(nid or ""):
        raise KeyError(nid)
    return dir_() / f"{nid}.json"


def new_id(name: str) -> str:
    """A readable, collision-free id: the slugged name plus a short suffix."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:40]
    return f"{slug or 'notebook'}-{uuid.uuid4().hex[:6]}"


def _atomic_write(target: Path, text: str) -> None:
    """Same durability contract as workspace.py: a crash or a full disk mid
    write must never truncate the notebook that was already there."""
    d = target.parent
    d.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(d), prefix=".nb-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read(nid: str) -> dict:
    doc = json.loads(_path(nid).read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        raise ValueError("notebook file is not an object")
    doc["id"] = nid
    doc.setdefault("blocks", [])
    return doc


def write(nid: str, doc: dict) -> dict:
    doc = dict(doc or {})
    doc["id"] = nid
    doc["updated_at"] = time.time()
    if not doc.get("created_at"):
        # A client that saves without echoing created_at back must not reset
        # the notebook's age; the file on disk is the authority for it.
        try:
            doc["created_at"] = read(nid).get("created_at") or doc["updated_at"]
        except (KeyError, OSError, ValueError, json.JSONDecodeError):
            doc["created_at"] = doc["updated_at"]
    doc.setdefault("name", "Untitled")
    doc.setdefault("blocks", [])
    _atomic_write(_path(nid), json.dumps(doc, indent=1) + "\n")
    return doc


def create(name: str = "Untitled", folder: str = "") -> dict:
    nid = new_id(name)
    while _path(nid).exists():          # slug collision on the same second
        nid = new_id(name)
    return write(nid, {"name": name or "Untitled", "folder": folder or "",
                       "blocks": [], "view": {"x": 0, "y": 0, "zoom": 1}})


def delete(nid: str) -> None:
    """Delete the notebook, then any asset no other notebook still refers to.

    Assets are shared-by-value (the same image dropped twice is stored once),
    so they are swept by reference count rather than owned by one document.
    """
    _path(nid).unlink(missing_ok=True)
    keep = set()
    for doc in _iter_docs():
        for b in doc.get("blocks", []) or []:
            src = (b or {}).get("src") or ""
            if src:
                keep.add(src.rsplit("/", 1)[-1])
    if not assets_dir().is_dir():
        return
    for f in assets_dir().iterdir():
        if f.is_file() and f.name not in keep:
            try:
                f.unlink()
            except OSError:
                pass


def _iter_docs():
    d = dir_()
    if not d.is_dir():
        return
    for f in sorted(d.glob("*.json")):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue        # one unreadable notebook must not hide the rest
        if isinstance(doc, dict):
            doc["id"] = f.stem
            yield doc


def listing() -> list[dict]:
    """Rail rows: metadata only. The blocks stay on disk until one is opened,
    so a sidebar refresh never loads every canvas in the library."""
    out = []
    for doc in _iter_docs():
        blocks = doc.get("blocks") or []
        out.append({
            "id": doc["id"],
            "name": doc.get("name") or doc["id"],
            "folder": doc.get("folder") or "",
            "blocks": len(blocks) if isinstance(blocks, list) else 0,
            "updated_at": doc.get("updated_at") or 0,
            "created_at": doc.get("created_at") or 0,
        })
    out.sort(key=lambda r: r["updated_at"], reverse=True)
    return out


def save_asset(raw: bytes, mime: str) -> str:
    """Store image bytes under a content-addressed name and return it.

    Content addressing is what makes the same screenshot pasted into five
    notebooks cost one copy on disk, and it makes an upload idempotent: a
    re-paste of the same image reuses the file already there.
    """
    import hashlib

    ext = ASSET_TYPES.get((mime or "").split(";")[0].strip().lower())
    if ext is None:
        raise ValueError(f"unsupported image type: {mime!r}")
    if not raw or len(raw) > MAX_ASSET_BYTES:
        raise ValueError(f"image must be 1 byte to {MAX_ASSET_BYTES // (1024 * 1024)} MB")
    name = hashlib.md5(raw).hexdigest() + ext
    d = assets_dir()
    d.mkdir(parents=True, exist_ok=True)
    f = d / name
    if not f.exists():
        f.write_bytes(raw)
    return name


def asset_path(name: str) -> Path:
    if not _ASSET_RE.match(name or ""):
        raise KeyError(name)
    return assets_dir() / name
