"""Shared data types passed between providers, the engine, and the UI."""

from __future__ import annotations

from dataclasses import dataclass, field

# The candle DataFrame contract. Every provider returns exactly these columns,
# in this order. `ts` is the bar-open time as integer epoch seconds (UTC);
# epoch integers rather than datetimes because they serialize losslessly and
# are what charting libraries consume directly.
CANDLE_COLUMNS = ["ts", "open", "high", "low", "close", "volume"]


@dataclass
class Instrument:
    """One tradeable/chartable instrument as a provider exposes it."""

    symbol: str
    name: str = ""
    category: str = ""
    provider: str = ""
    # Provider-private extras (dataset hints, exchange codes, ...). The engine
    # passes this back on candle/stream calls but never interprets it.
    meta: dict = field(default_factory=dict)


@dataclass
class Quote:
    """A point-in-time price for one instrument."""

    symbol: str
    price: float
    ts: float
    bid: float | None = None
    ask: float | None = None
