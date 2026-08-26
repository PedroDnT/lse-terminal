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


def _ema_over_valid(values, period):
    # Run the EMA on the non-NaN tail only; seeding across the NaN warm-up
    # would blank the whole line.
    out = np.full(len(values), np.nan)
    mask = ~np.isnan(values)
    out[np.flatnonzero(mask)] = _ema_seeded(values[mask], period)
    return out


@indicator("smi", title="Stochastic Momentum Index", overlay=False,
           params={"length": {"type": "int", "default": 13, "min": 1, "max": 200},
                   "smooth_k": {"type": "int", "default": 25, "min": 1, "max": 200},
                   "smooth_d": {"type": "int", "default": 2, "min": 1, "max": 50}})
def smi(df, length=13, smooth_k=25, smooth_d=2):
    hh = df["high"].rolling(length).max()
    ll = df["low"].rolling(length).min()
    rng = hh - ll
    # Close position relative to the range midpoint, scaled to +-100.
    raw = ((df["close"] - (hh + ll) / 2.0) / (rng / 2.0) * 100.0) \
        .where(rng != 0, 0.0).to_numpy(dtype=float)
    line = _ema_over_valid(raw, smooth_k)
    signal = _ema_over_valid(line, smooth_d)
    return pd.DataFrame({"smi": line, "signal": signal}, index=df.index)
