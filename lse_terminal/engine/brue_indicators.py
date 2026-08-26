"""Brue-language indicators on the terminal's charts.

An indicator can be WRITTEN IN BRUE: a v2 script with no orders (the
strategy() header is gone from the language), whose plot() calls become
chart lines. Title and panel placement ride as comment pragmas, e.g.

    # title: EMA Ribbon
    # panel: price
    plot(ema(close, 9), title="ema9")
    plot(ema(close, 21), title="ema21")

`# panel: price` overlays the price chart; `# panel: below` renders in its
own pane. Defaults when a pragma is absent: title from the filename,
panel price.

register_brue_source() runs the script through the pure-Python brue engine
(pip package, same conformance-locked engine as the backtester) and
registers it in the terminal's indicator REGISTRY, so Brue indicators sit
in the same picker, render on the same live charts, and recompute on the
same refresh path as the Python ones. Users drop .brue files in the same
folder as their .py indicators; bundled ones ship in
lse_terminal/indicators/brue/.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

import pandas as pd

from lse_terminal.contracts.indicator import REGISTRY, IndicatorSpec

BUNDLED_DIR = Path(__file__).resolve().parent.parent / "indicators" / "brue"

BRUE_TEMPLATE = '''# title: My Brue Indicator
# panel: price

# An indicator is a Brue script with no orders; plot() calls become
# chart lines and title= names them in the legend. The pragmas above set
# the picker name and where it draws (price = on the chart, below = own
# pane). The full Brue language is available: builtins, ifs, functions.
fast = ema(close, 9)
slow = ema(close, 21)
plot(fast, title="fast")
plot(slow, title="slow")
'''

# Registration probes run on a tiny synthetic series purely to discover the
# script's title/overlay/plots; real values come per chart request.
_PROBE_BARS = [[1700000000000 + i * 3600000,
                100 + math.sin(i / 5.0), 100 + math.sin(i / 5.0) + 0.5,
                100 + math.sin(i / 5.0) - 0.5, 100 + math.sin(i / 5.0) + 0.1,
                1000.0]
               for i in range(80)]


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    return s or "brue_indicator"


# Comment pragmas carry the metadata the deleted strategy() header used to:
# `# title: My Name` and `# panel: price|below`. Line-anchored comments so a
# plot(..., title="x") kwarg can never match; first occurrence wins.
_PRAGMA = re.compile(r"^[ \t]*#[ \t]*(title|panel)[ \t]*:[ \t]*(.+?)[ \t]*$",
                     re.MULTILINE)


def _pragmas(source: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in _PRAGMA.finditer(source):
        out.setdefault(m.group(1).lower(), m.group(2))
    return out


def register_brue_source(stem: str, source: str) -> list[str]:
    """Compile-check + probe a Brue indicator script and register it.
    Returns the registry names it claimed. Raises on script errors so the
    caller (user_indicators hot-reload) can surface the message."""
    from brue.api import indicator_series

    probe = indicator_series(source, _PROBE_BARS)
    meta = _pragmas(source)
    title = meta.get("title", stem)
    # v2 headerless scripts always probe overlay=True (the engine default);
    # the panel pragma is the author's word. Absent pragma = price overlay.
    if "panel" in meta:
        overlay = meta["panel"].strip().lower() != "below"
    else:
        overlay = bool(probe["overlay"])
    name = "brue_" + _slug(stem)
    if not probe["plots"]:
        raise ValueError("the script never calls plot(); an indicator needs "
                         "at least one plot(series) to draw")

    def fn(df: pd.DataFrame, _source=source) -> "pd.Series | pd.DataFrame":
        rows = df[["ts", "open", "high", "low", "close", "volume"]].values.tolist()
        r = indicator_series(_source, rows)
        out = pd.DataFrame(r["plots"], index=df.index)
        if out.shape[1] == 1:
            return out.iloc[:, 0]
        return out

    REGISTRY[name] = IndicatorSpec(
        name=name,
        title=title,
        fn=fn,
        params={},  # Brue scripts carry their values inline for now
        overlay=overlay,
        styles={},
    )
    return [name]


def load_bundled() -> dict[str, str]:
    """Register every shipped .brue indicator. Returns {file: error} for
    any that failed; a broken bundled script must never block startup."""
    errors: dict[str, str] = {}
    if not BUNDLED_DIR.is_dir():
        return errors
    for path in sorted(BUNDLED_DIR.glob("*.brue")):
        try:
            register_brue_source(path.stem, path.read_text())
        except Exception as e:
            errors[path.name] = f"{type(e).__name__}: {e}"
    return errors
