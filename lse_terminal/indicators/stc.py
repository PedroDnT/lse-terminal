import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _ema_seeded(values, period):
    # Chart-parity EMA: NaN warm-up, SMA seed at bar period-1, then the
    # standard recursion. pandas ewm seeds from bar 0, which diverges early.
    n = len(values)
    out = np.full(n, np.nan)
    if n < period:
        return out
    k = 2.0 / (period + 1.0)
    e = values[:period].mean()
    out[period - 1] = e
    for i in range(period, n):
        e = (values[i] - e) * k + e
        out[i] = e
    return out


def _smooth_over_valid(values, period):
    # EMA on the non-NaN entries only, results mapped back to their original
    # slots. Each pass turns the first period-1 valid slots NaN, exactly like
    # the chart source's filter-then-remap loop.
    out = np.full(len(values), np.nan)
    mask = ~np.isnan(values)
    out[np.flatnonzero(mask)] = _ema_seeded(values[mask], period)
    return out


@indicator("stc", title="Schaff Trend Cycle", overlay=False,
           params={"fast": {"type": "int", "default": 23, "min": 1, "max": 200},
                   "slow": {"type": "int", "default": 50, "min": 2, "max": 500},
                   "cycle": {"type": "int", "default": 10, "min": 2, "max": 200},
                   "smooth": {"type": "int", "default": 3, "min": 1, "max": 50}})
def stc(df, fast=23, slow=50, cycle=10, smooth=3):
    c = df["close"].to_numpy(dtype=float)
    n = len(c)
    macd = _ema_seeded(c, fast) - _ema_seeded(c, slow)

    def stoch(data):
        # Windows near the warm-up boundary are partially NaN; the chart
        # source stretches over whatever valid values remain (min two).
        r = np.full(n, np.nan)
        for i in range(cycle - 1, n):
            if np.isnan(data[i]):
                continue
            w = data[i - cycle + 1:i + 1]
            valid = w[~np.isnan(w)]
            if len(valid) < 2:
                continue
            mx, mn = valid.max(), valid.min()
            r[i] = 50.0 if mx == mn else (data[i] - mn) / (mx - mn) * 100.0
        return r

    pf = stoch(macd)
    for _ in range(smooth):
        pf = _smooth_over_valid(pf, smooth)
    pf2 = stoch(pf)
    for _ in range(smooth):
        pf2 = _smooth_over_valid(pf2, smooth)
    return pd.Series(pf2, index=df.index)
