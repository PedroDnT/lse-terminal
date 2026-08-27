"""Local terminal configuration: ~/.config/lse-terminal/config.json.

Env vars win over the file so power users and CI never need the file at all.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


def config_dir() -> Path:
    override = os.environ.get("LSE_TERMINAL_CONFIG_DIR")
    return Path(override).expanduser() if override else Path("~/.config/lse-terminal").expanduser()


def load() -> dict:
    path = config_dir() / "config.json"
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save(cfg: dict) -> None:
    d = config_dir()
    d.mkdir(parents=True, exist_ok=True)
    path = d / "config.json"
    path.write_text(json.dumps(cfg, indent=2) + "\n")
    # The config can hold the API key; keep it out of other local users' reach.
    os.chmod(path, 0o600)


def get_lse_api_key() -> str | None:
    return os.environ.get("LSE_API_KEY") or load().get("lse_api_key") or None


def set_lse_api_key(key: str) -> None:
    cfg = load()
    cfg["lse_api_key"] = key.strip()
    save(cfg)


def get_brapi_token() -> str | None:
    """The user's own brapi.dev token, for the Brazilian intraday source.

    Same shape as the LSE key: env first so CI and power users never need
    the file, then config.json. Absent is a normal state -- the brapi
    provider still answers for that vendor's public sandbox tickers, and
    the b3 provider needs no token at all.
    """
    return os.environ.get("BRAPI_TOKEN") or load().get("brapi_token") or None


def set_brapi_token(token: str) -> None:
    cfg = load()
    cfg["brapi_token"] = token.strip()
    save(cfg)
