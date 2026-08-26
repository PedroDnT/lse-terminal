"""Synthetic market data provider.

Exists so the terminal is alive the moment it opens, with no account and no
network: seeded random walks per (symbol, timeframe), stable for the life of
the process, plus a gentle live tick stream continuing each walk. Also the
data source the test suite and the compliance harness run against.
"""

from __future__ import annotations

import asyncio
import math
import time
import zlib

import numpy as np
import pandas as pd

from lse_terminal.contracts import CANDLE_COLUMNS, Instrument, NotSupported, Provider, Quote

_TF_SECONDS = {
    # "tick" is a per-second walk here: demo trades print about once a
    # second, so on synthetic data the tape and 1s bars share a step; the
    # walks still differ (the seed hashes the timeframe label).
    "tick": 1, "1s": 1, "30s": 30,
    "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
}

# symbol -> (name, category, base price, per-bar log-return scale)
_UNIVERSE = {
    "DEMO:BTC": ("Demo Bitcoin", "Crypto", 67000.0, 0.004),
    "DEMO:SPX": ("Demo S&P 500", "Indices", 5600.0, 0.0012),
    "DEMO:EURUSD": ("Demo Euro / Dollar", "Forex", 1.09, 0.0006),
    "DEMO:AAPL": ("Demo Apple", "Stocks", 230.0, 0.0022),
    "DEMO:GOLD": ("Demo Gold", "Commodities", 2400.0, 0.0015),
    "DEMO:VIX": ("Demo Volatility", "Volatility", 14.0, 0.01),
}

# Depth per (symbol, timeframe); every request slices this walk. At least
# 6000 bars, and at least ~120 days of coverage: the manual backtester replays
# from a start date weeks in the past, and a flat 6000 gave 1m only ~4 days,
# leaving "last month" replays with zero bars at their start point.
_MIN_BARS = 6000
_MIN_COVERAGE_S = 120 * 86400


def _history_bars(step: int) -> int:
    # Sub-minute walks cap at ~3 days of coverage: the 120-day rule at a
    # 1-second step would mean a 10M-row frame per (symbol, timeframe),
    # and nobody replays a month of seconds bars.
    coverage = min(_MIN_COVERAGE_S, 3 * 86400) if step < 60 else _MIN_COVERAGE_S
    return max(_MIN_BARS, coverage // step)


class DemoProvider(Provider):
    name = "demo"
    title = "Demo (synthetic)"
    timeframes = list(_TF_SECONDS)
    deterministic = True

    def __init__(self):
        # Walks are anchored at construction time so every candles() call for
        # one process sees one consistent market; genesis aligns to the bar
        # grid so ts values are stable within a bar interval.
        self._anchor = int(time.time())
        self._series: dict[tuple[str, str], pd.DataFrame] = {}
        self._last: dict[str, float] = {}

    # ------------------------------------------------------------------

    def search(self, query: str = "", limit: int = 50) -> list[Instrument]:
        q = query.strip().upper()
        out = []
        for symbol, (name, category, _, _) in _UNIVERSE.items():
            if not q or q in symbol.upper() or q in name.upper():
                out.append(Instrument(symbol=symbol, name=name,
                                      category=category, provider=self.name))
        return out[: max(1, limit)]

    def _walk(self, symbol: str, timeframe: str) -> pd.DataFrame:
        key = (symbol, timeframe)
        if key in self._series:
            return self._series[key]
        if symbol not in _UNIVERSE:
            raise ValueError(f"unknown demo symbol: {symbol}")
        _, _, base, scale = _UNIVERSE[symbol]
        step = _TF_SECONDS[timeframe]
        bars = _history_bars(step)
        end_ts = (self._anchor // step) * step
        ts = np.arange(end_ts - (bars - 1) * step, end_ts + step, step)

        rng = np.random.default_rng(zlib.crc32(f"{symbol}|{timeframe}".encode()))
        # 4 intra-bar sub-steps give honest highs/lows instead of ohlc==close.
        sub = rng.normal(0.0, scale / 2.0, size=(bars, 4))
        # A slow sine drift keeps long walks from wandering to silly prices.
        drift = np.sin(np.linspace(0, 6 * math.pi, bars)) * scale * 0.3
        path = base * np.exp(np.cumsum(sub.sum(axis=1) + drift))
        path = path / path[0] * base

        opens = np.empty(bars)
        opens[0] = base
        opens[1:] = path[:-1]
        intra = opens[:, None] * np.exp(np.cumsum(sub, axis=1))
        highs = np.maximum(intra.max(axis=1), np.maximum(opens, path))
        lows = np.minimum(intra.min(axis=1), np.minimum(opens, path))
        volume = np.abs(rng.normal(1.0, 0.4, bars)) * 1000.0

        df = pd.DataFrame({
            "ts": ts.astype("int64"),
            "open": opens, "high": highs, "low": lows, "close": path,
            "volume": volume.round(2),
        })[CANDLE_COLUMNS]
        self._series[key] = df
        self._last.setdefault(symbol, float(path[-1]))
        return df

    def candles(self, symbol: str, timeframe: str, limit: int = 500,
                start: str | None = None, end: str | None = None) -> pd.DataFrame:
        if timeframe not in _TF_SECONDS:
            raise ValueError(f"unsupported timeframe: {timeframe}")
        df = self._walk(symbol, timeframe)
        if start:
            df = df[df["ts"] >= int(pd.Timestamp(start, tz="UTC").timestamp())]
        if end:
            df = df[df["ts"] <= int(pd.Timestamp(end, tz="UTC").timestamp())]
        # Same law as the hosted data API: a start-anchored query pages
        # FORWARD (oldest N from start), everything else returns the newest N.
        # The frontend's windowed pagination depends on this distinction.
        n = max(1, int(limit))
        df = df.head(n) if start else df.tail(n)
        return df.reset_index(drop=True)

    def quote(self, symbol: str) -> Quote:
        if symbol not in _UNIVERSE:
            raise NotSupported(f"unknown demo symbol: {symbol}")
        self._walk(symbol, "1m")
        return Quote(symbol=symbol, price=self._last[symbol], ts=time.time())

    async def stream(self, symbols: list[str]):
        wanted = [s for s in symbols if s in _UNIVERSE]
        if not wanted:
            return
        rng = np.random.default_rng()
        for s in wanted:
            self._walk(s, "1m")
        while True:
            await asyncio.sleep(float(rng.uniform(0.4, 1.1)))
            s = wanted[int(rng.integers(len(wanted)))]
            scale = _UNIVERSE[s][3]
            self._last[s] *= float(np.exp(rng.normal(0.0, scale / 6.0)))
            yield {"symbol": s, "price": round(self._last[s], 6), "ts": time.time()}
