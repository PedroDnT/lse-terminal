"""Compliance harness for third-party (and built-in) providers.

Plugin authors run this against their provider before publishing::

    from lse_terminal.testing import check_provider
    problems = check_provider(MyProvider())
    assert not problems, problems

The same checks gate built-in providers in this repo's test suite, so the
contract can't drift from what the harness enforces.
"""

from __future__ import annotations

from lse_terminal.contracts import CANDLE_COLUMNS, Instrument, Provider


def check_provider(provider: Provider, symbol: str | None = None,
                   timeframe: str | None = None) -> list[str]:
    """Returns a list of human-readable contract violations (empty = compliant)."""
    problems: list[str] = []

    if not provider.name:
        problems.append("provider.name is empty")
    if not provider.timeframes:
        problems.append("provider.timeframes is empty")

    try:
        results = provider.search("", limit=5)
    except Exception as e:
        return problems + [f"search() raised: {e}"]
    if not results:
        return problems + ["search('') returned nothing; a default list is required"]
    for ins in results:
        if not isinstance(ins, Instrument):
            problems.append(f"search() returned non-Instrument: {ins!r}")

    sym = symbol or results[0].symbol
    tf = timeframe or provider.timeframes[0]
    try:
        df = provider.candles(sym, tf, limit=50)
    except Exception as e:
        return problems + [f"candles({sym!r}, {tf!r}) raised: {e}"]

    if list(df.columns) != CANDLE_COLUMNS:
        problems.append(f"candles columns {list(df.columns)} != {CANDLE_COLUMNS}")
        return problems
    if len(df) == 0:
        problems.append(f"candles({sym!r}, {tf!r}) returned zero rows")
        return problems
    if len(df) > 50:
        problems.append(f"limit=50 not respected: got {len(df)} rows")
    ts = df["ts"]
    if not ts.is_monotonic_increasing:
        problems.append("ts is not ascending")
    if ts.duplicated().any():
        problems.append("duplicate ts values")
    if df[["open", "high", "low", "close"]].isna().any().any():
        problems.append("NaN in ohlc")
    bad_hi = (df["high"] + 1e-12 < df[["open", "close"]].max(axis=1)).sum()
    bad_lo = (df["low"] - 1e-12 > df[["open", "close"]].min(axis=1)).sum()
    if bad_hi:
        problems.append(f"{bad_hi} bars with high < max(open, close)")
    if bad_lo:
        problems.append(f"{bad_lo} bars with low > min(open, close)")

    if provider.deterministic:
        df2 = provider.candles(sym, tf, limit=50)
        if not df.equals(df2):
            problems.append("deterministic=True but two identical calls differ")

    return problems
