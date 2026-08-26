import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _ema(values, period):
    # Chart-convention EMA: NaN warm-up, SMA seed at bar period-1, then recursive.
    out = np.full(len(values), np.nan)
    if len(values) >= period:
        e = values[:period].mean()
        out[period - 1] = e
        m = 2.0 / (period + 1)
        for i in range(period, len(values)):
            e = (values[i] - e) * m + e
            out[i] = e
    return out


@indicator("twiggs_mf", title="Twiggs Money Flow", overlay=False,
           params={"length": {"type": "int", "default": 21, "min": 1, "max": 500}})
def twiggs_mf(df, length=21):
    prev_close = df["close"].shift()
    # True-range highs/lows (gap-aware), which is what distinguishes Twiggs
    # from plain Chaikin Money Flow. First bar falls back to its own high/low.
    trh = pd.concat([df["high"], prev_close], axis=1).max(axis=1)
    trl = pd.concat([df["low"], prev_close], axis=1).min(axis=1)
    rng = trh - trl
    vol = df["volume"].fillna(0.0)
    adv = (((df["close"] - trl) / rng.where(rng != 0) * 2.0 - 1.0) * vol).fillna(0.0)
    ema_adv = _ema(adv.to_numpy(dtype=float), length)
    ema_vol = _ema(vol.to_numpy(dtype=float), length)
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where(ema_vol == 0, np.nan, ema_adv / ema_vol)
    return pd.Series(out, index=df.index)
