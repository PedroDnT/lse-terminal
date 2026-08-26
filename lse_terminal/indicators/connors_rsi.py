import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _rsi_sma_seed(values, period):
    # Chart-parity RSI: SMA seed for the first average, then Wilder smoothing,
    # with avg_loss == 0 mapping to 100. Differs from the pure-ewm rsi.py
    # builtin only during early bars, but Connors RSI must match the chart.
    n = len(values)
    out = np.full(n, np.nan)
    if n < period + 1:
        return out
    changes = np.diff(values)
    avg_gain = changes[:period].clip(min=0).sum() / period
    avg_loss = (-changes[:period]).clip(min=0).sum() / period
    out[period] = 100.0 if avg_loss == 0 else \
        100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    for i in range(period + 1, n):
        ch = values[i] - values[i - 1]
        gain = ch if ch > 0 else 0.0
        loss = -ch if ch < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = 100.0 if avg_loss == 0 else \
            100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    return out


@indicator("connors_rsi", title="Connors RSI", overlay=False,
           params={"rsi_length": {"type": "int", "default": 3, "min": 2, "max": 200},
                   "streak_length": {"type": "int", "default": 2, "min": 2, "max": 200},
                   "rank_length": {"type": "int", "default": 100, "min": 2, "max": 500}})
def connors_rsi(df, rsi_length=3, streak_length=2, rank_length=100):
    c = df["close"].to_numpy(dtype=float)
    n = len(c)
    price_rsi = _rsi_sma_seed(c, rsi_length)

    streak = np.zeros(n)
    for i in range(1, n):
        if c[i] > c[i - 1]:
            streak[i] = streak[i - 1] + 1 if streak[i - 1] > 0 else 1
        elif c[i] < c[i - 1]:
            streak[i] = streak[i - 1] - 1 if streak[i - 1] < 0 else -1
    streak_rsi = _rsi_sma_seed(streak, streak_length)

    # Percent rank of today's change against the trailing window (the window
    # includes today, which never counts as strictly less than itself).
    change = np.diff(c, prepend=np.nan)
    pct_rank = np.full(n, np.nan)
    for i in range(rank_length, n):
        w = change[i - rank_length + 1:i + 1]
        pct_rank[i] = np.count_nonzero(w < w[-1]) / rank_length * 100.0

    return pd.Series((price_rsi + streak_rsi + pct_rank) / 3.0, index=df.index)
