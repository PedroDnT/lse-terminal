import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _ema_sma_seed(arr, period):
    # Chart-style EMA: NaN warm-up, seeded with the SMA of the first `period`
    # values (pandas ewm seeds from the first value, which diverges early on).
    n = len(arr)
    out = np.full(n, np.nan)
    if n < period:
        return out
    k = 2.0 / (period + 1)
    val = arr[:period].mean()
    out[period - 1] = val
    for i in range(period, n):
        val = (arr[i] - val) * k + val
        out[i] = val
    return out


@indicator("rvol", title="Relative Volatility Index", overlay=False,
           params={"length": {"type": "int", "default": 10, "min": 2, "max": 200},
                   "smoothing": {"type": "int", "default": 14, "min": 1, "max": 200}})
def rvol(df, length=10, smoothing=14):
    sd = df["close"].rolling(length).std(ddof=0).values
    n = len(sd)
    gains = np.zeros(n)
    losses = np.zeros(n)
    change = np.diff(sd)
    # The chart treats warm-up NaN deltas as zero movement, so the EMA seed
    # averages over those zeros; keep that to match its early values.
    gains[1:] = np.where(np.isnan(change), 0.0, np.clip(change, 0.0, None))
    losses[1:] = np.where(np.isnan(change), 0.0, np.clip(-change, 0.0, None))
    avg_gain = _ema_sma_seed(gains, smoothing)
    avg_loss = _ema_sma_seed(losses, smoothing)
    total = avg_gain + avg_loss
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where(total == 0, 50.0, avg_gain / total * 100.0)
    return pd.Series(out, index=df.index)
