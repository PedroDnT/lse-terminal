"""The indicator contract: a named pure function over a candle DataFrame.

Adding an indicator is deliberately the smallest possible contribution::

    from lse_terminal.contracts import indicator

    @indicator("sma", title="Simple Moving Average",
               params={"length": {"type": "int", "default": 20, "min": 1, "max": 500}})
    def sma(df, length=20):
        return df["close"].rolling(length).mean()

The decorator registers the function; the engine autogenerates the UI form
from ``params`` and renders the result against the candles' ``ts``.

Return shapes:
- ``pd.Series``: one line.
- ``pd.DataFrame``: one line per column (e.g. MACD returns macd/signal/hist).
  Per-column render hints go in ``styles``: {"hist": {"kind": "histogram"}};
  the default kind is "line".

``overlay=True`` draws on the price scale, ``False`` in its own pane below.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd

_CASTS = {"int": int, "float": float, "bool": bool, "str": str}


@dataclass
class IndicatorSpec:
    name: str
    title: str
    fn: Callable[..., "pd.Series | pd.DataFrame"]
    params: dict = field(default_factory=dict)
    overlay: bool = True
    styles: dict = field(default_factory=dict)


# Global registry filled by the @indicator decorator at import time. Built-ins
# register when lse_terminal.indicators is imported; third-party packages when
# their ``lse_terminal.indicators`` entry point is loaded.
REGISTRY: dict[str, IndicatorSpec] = {}


def indicator(name: str, title: str | None = None, params: dict | None = None,
              overlay: bool = True, styles: dict | None = None):
    # Fail at definition time with a teaching message: AI assistants keep
    # producing params as a LIST of {"name": ...} dicts (seen in the
    # wild), and without this check the file registered fine and only
    # broke later in the settings form, far from the actual mistake.
    if params is not None and not isinstance(params, dict):
        raise TypeError(
            f"@indicator(\"{name}\") params must be a dict keyed by parameter "
            f"name, e.g. params={{\"length\": {{\"type\": \"int\", \"default\": 20, "
            f"\"min\": 1, \"max\": 500}}}}, got {type(params).__name__}")

    def wrap(fn: Callable[..., "pd.Series | pd.DataFrame"]):
        REGISTRY[name] = IndicatorSpec(
            name=name, title=title or name.upper(), fn=fn,
            params=params or {}, overlay=overlay, styles=styles or {},
        )
        return fn
    return wrap


def all_specs() -> list[IndicatorSpec]:
    return sorted(REGISTRY.values(), key=lambda s: s.name)


def compute(name: str, df: pd.DataFrame, **params) -> pd.DataFrame:
    """Run one registered indicator with validated, defaulted params.

    Always returns a DataFrame (a Series result becomes a single column named
    after the indicator), length-aligned to ``df``.
    """
    spec = REGISTRY.get(name)
    if spec is None:
        raise KeyError(f"unknown indicator: {name}")
    clean: dict = {}
    for pname, pdef in spec.params.items():
        raw = params.get(pname, pdef.get("default"))
        if raw is None:
            raise ValueError(f"{name}: missing required param {pname}")
        value = _CASTS.get(pdef.get("type", "float"), float)(raw)
        lo, hi = pdef.get("min"), pdef.get("max")
        if lo is not None and value < lo:
            raise ValueError(f"{name}: {pname}={value} below minimum {lo}")
        if hi is not None and value > hi:
            raise ValueError(f"{name}: {pname}={value} above maximum {hi}")
        clean[pname] = value
    result = spec.fn(df, **clean)
    if isinstance(result, pd.Series):
        result = result.to_frame(name=spec.name)
    if not isinstance(result, pd.DataFrame):
        raise TypeError(f"{name}: returned {type(result).__name__}, "
                        "expected Series or DataFrame")
    if len(result) != len(df):
        raise ValueError(f"{name}: returned {len(result)} rows for {len(df)} bars")
    return result
