import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _ema_sma_seed(a, period):
    # EMA convention: NaN warm-up, SMA of the first `period`
    # values as the seed, then the standard recursion. pandas ewm seeds from
    # the first value instead, which diverges for hundreds of bars.
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


def _ema_nan_safe(a, period):
    # Re-smooth from the first valid value and pad the warm-up back on,
    # the NaN-safe re-smoothing used for chained EMAs.
    idx = np.flatnonzero(~np.isnan(a))
    out = np.full(len(a), np.nan)
    if idx.size:
        f = idx[0]
        out[f:] = _ema_sma_seed(a[f:], period)
    return out


def _compact_ema_scatter(a, period):
    # Signal convention: EMA over the compacted valid values, scattered
    # back onto the valid positions in order.
    idx = np.flatnonzero(~np.isnan(a))
    out = np.full(len(a), np.nan)
    if idx.size:
        out[idx] = _ema_sma_seed(a[idx], period)
    return out


@indicator("tsi", title="True Strength Index", overlay=False,
           params={"long": {"type": "int", "default": 25, "min": 2, "max": 200},
                   "short": {"type": "int", "default": 13, "min": 1, "max": 200},
                   "signal": {"type": "int", "default": 13, "min": 1, "max": 200}})
def tsi(df, long=25, short=13, signal=13):
    c = df["close"].to_numpy(dtype=float)
    n = len(c)
    mom = np.zeros(n)
    mom[1:] = c[1:] - c[:-1]  # bar 0 momentum is seeded as 0, not NaN
    ds = _ema_nan_safe(_ema_sma_seed(mom, long), short)
    ads = _ema_nan_safe(_ema_sma_seed(np.abs(mom), long), short)
    line = np.full(n, np.nan)
    ok = ~np.isnan(ds) & ~np.isnan(ads) & (ads != 0)
    line[ok] = ds[ok] / ads[ok] * 100.0
    sig = _compact_ema_scatter(line, signal)
    return pd.DataFrame({"tsi": line, "signal": sig}, index=df.index)
