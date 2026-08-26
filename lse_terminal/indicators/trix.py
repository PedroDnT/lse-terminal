import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _ema_sma_seed(a, period):
    # EMA convention: NaN warm-up, SMA seed at period-1, then
    # the standard recursion. pandas ewm seeds from the first value instead.
    n = len(a)
    out = np.full(n, np.nan)
    if n < period:
        return out
    mult = 2.0 / (period + 1)
    e = a[:period].mean()
    out[period - 1] = e
    for i in range(period, n):
        e = (a[i] - e) * mult + e
        out[i] = e
    return out


def _compact_ema_scatter(a, period):
    # Signal convention: EMA over the compacted valid values, scattered
    # back onto the valid positions in order.
    idx = np.flatnonzero(~np.isnan(a))
    out = np.full(len(a), np.nan)
    if idx.size:
        out[idx] = _ema_sma_seed(a[idx], period)
    return out


@indicator("trix", title="TRIX", overlay=False,
           params={"length": {"type": "int", "default": 15, "min": 1, "max": 200},
                   "signal": {"type": "int", "default": 9, "min": 1, "max": 200}})
def trix(df, length=15, signal=9):
    c = df["close"].to_numpy(dtype=float)
    n = len(c)
    # Chained EMAs compact (dropping the NaN warm-up) between passes,
    # so each pass shortens the array; the tail stays aligned to the input.
    e1 = _ema_sma_seed(c, length)
    e2 = _ema_sma_seed(e1[~np.isnan(e1)], length)
    e3 = _ema_sma_seed(e2[~np.isnan(e2)], length)
    start = n - len(e3)
    line = np.full(n, np.nan)
    if len(e3) > 1:
        prev, cur = e3[:-1], e3[1:]
        ok = ~np.isnan(prev) & ~np.isnan(cur) & (prev != 0)
        vals = np.full(len(cur), np.nan)
        # Scaled by 10000, not the usual 100 (matches the reference for parity).
        vals[ok] = (cur[ok] - prev[ok]) / prev[ok] * 10000.0
        line[start + 1:] = vals
    sig = _compact_ema_scatter(line, signal)
    return pd.DataFrame({"trix": line, "signal": sig}, index=df.index)
