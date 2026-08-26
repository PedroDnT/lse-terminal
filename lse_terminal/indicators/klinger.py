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


@indicator("klinger", title="Klinger Volume Oscillator", overlay=False,
           params={"fast": {"type": "int", "default": 34, "min": 1, "max": 200},
                   "slow": {"type": "int", "default": 55, "min": 2, "max": 500},
                   "signal": {"type": "int", "default": 13, "min": 1, "max": 200}})
def klinger(df, fast=34, slow=55, signal=13):
    h = df["high"].to_numpy(dtype=float)
    l = df["low"].to_numpy(dtype=float)
    c = df["close"].to_numpy(dtype=float)
    v = df["volume"].to_numpy(dtype=float)
    n = len(c)
    # Volume force depends on the previous bar's value (trend continuation
    # doubles the range term), so it is inherently sequential.
    vf = np.zeros(n)
    for i in range(1, n):
        hlc = h[i] + l[i] + c[i]
        prev = h[i - 1] + l[i - 1] + c[i - 1]
        trend = 1.0 if hlc > prev else -1.0
        dm = h[i] - l[i]
        if i > 1 and (hlc > prev) == (prev > h[i - 2] + l[i - 2] + c[i - 2]):
            cm = dm + abs(dm) if vf[i - 1] != 0 else dm
        else:
            cm = dm
        vol = v[i]
        if np.isnan(vol):
            vol = 0.0
        vf[i] = 0.0 if cm == 0 else vol * abs(2.0 * dm / cm - 1.0) * trend
    kl = _ema_seeded(vf, fast) - _ema_seeded(vf, slow)
    # Signal EMA runs over the valid tail only; seeding across the NaN
    # warm-up would blank the whole line.
    sig = np.full(n, np.nan)
    mask = ~np.isnan(kl)
    sig[np.flatnonzero(mask)] = _ema_seeded(kl[mask], signal)
    return pd.DataFrame({"klinger": kl, "signal": sig}, index=df.index)
