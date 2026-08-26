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


@indicator("pfe", title="Polarized Fractal Efficiency", overlay=False,
           params={"length": {"type": "int", "default": 10, "min": 1, "max": 200},
                   "smoothing": {"type": "int", "default": 5, "min": 1, "max": 50}})
def pfe(df, length=10, smoothing=5):
    c = df["close"]
    d = c.diff()
    # Straight-line distance vs actual path, both in mixed price/time units,
    # exactly as the chart source computes them.
    path = np.sqrt(1.0 + d * d).rolling(length).sum()
    move = np.sqrt((c - c.shift(length)) ** 2 + float(length * length))
    sign = np.where(c > c.shift(length), 1.0, -1.0)
    raw = np.where(path.to_numpy() == 0, 0.0,
                   (move / path * 100.0).to_numpy() * sign)
    raw[:length] = np.nan
    # Smooth only the valid tail: EMA-seeding across the NaN warm-up would
    # otherwise blank the whole series.
    out = np.full(len(raw), np.nan)
    valid = np.flatnonzero(~np.isnan(raw))
    if len(valid):
        fv = valid[0]
        out[fv:] = _ema_seeded(raw[fv:], smoothing)
    return pd.Series(out, index=df.index)
