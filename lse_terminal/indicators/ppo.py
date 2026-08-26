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


def ppo_lines(values, fast, slow, signal):
    fe = _ema_sma_seed(values, fast)
    se = _ema_sma_seed(values, slow)
    line = np.full(len(values), np.nan)
    ok = ~np.isnan(fe) & ~np.isnan(se) & (se != 0)
    line[ok] = (fe[ok] - se[ok]) / se[ok] * 100.0
    sig = _compact_ema_scatter(line, signal)
    hist = np.where(np.isnan(line) | np.isnan(sig), np.nan, line - sig)
    return line, sig, hist


@indicator("ppo", title="Percentage Price Oscillator", overlay=False,
           params={"fast": {"type": "int", "default": 12, "min": 1, "max": 200},
                   "slow": {"type": "int", "default": 26, "min": 2, "max": 500},
                   "signal": {"type": "int", "default": 9, "min": 1, "max": 200}},
           styles={"hist": {"kind": "histogram"}})
def ppo(df, fast=12, slow=26, signal=9):
    line, sig, hist = ppo_lines(df["close"].to_numpy(dtype=float), fast, slow, signal)
    return pd.DataFrame({"ppo": line, "signal": sig, "hist": hist}, index=df.index)
