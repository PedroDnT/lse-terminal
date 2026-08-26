import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _rsi_sma_seed(c, period):
    # RSI convention: SMA-seeded Wilder smoothing with the first
    # value at index `period`. The built-in rsi.py uses the ewm seed, which
    # differs for a long warm-up, so StochRSI needs its own copy for parity.
    n = len(c)
    out = np.full(n, np.nan)
    if n < period + 1:
        return out
    delta = np.diff(c)
    gains = np.clip(delta[:period], 0, None).sum()
    losses = np.clip(-delta[:period], 0, None).sum()
    avg_gain, avg_loss = gains / period, losses / period
    out[period] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    for i in range(period + 1, n):
        ch = delta[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(ch, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-ch, 0.0)) / period
        out[i] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    return out


@indicator("stoch_rsi", title="Stochastic RSI", overlay=False,
           params={"rsi_length": {"type": "int", "default": 14, "min": 2, "max": 200},
                   "k": {"type": "int", "default": 14, "min": 1, "max": 200},
                   "d": {"type": "int", "default": 3, "min": 1, "max": 50}})
def stoch_rsi(df, rsi_length=14, k=14, d=3):
    rsi = pd.Series(_rsi_sma_seed(df["close"].to_numpy(dtype=float), rsi_length),
                    index=df.index)
    mn = rsi.rolling(k).min()
    mx = rsi.rolling(k).max()
    k_line = ((rsi - mn) / (mx - mn) * 100.0).mask(mx == mn, 50.0)
    # Earlier-implementation bug, deliberately not replicated: its d uses the
    # NaN-poisoning running-sum SMA on k's warm-up prefix, so that d line is
    # permanently all-NaN. Canonical d is a plain SMA of k from the first valid
    # value.
    d_line = k_line.rolling(d).mean()
    return pd.DataFrame({"k": k_line, "d": d_line})
