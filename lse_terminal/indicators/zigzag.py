import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("zigzag", title="Zig Zag",
           params={"deviation": {"type": "float", "default": 5.0, "min": 0.1, "max": 50.0}})
def zigzag(df, deviation=5.0):
    h = df["high"].to_numpy(dtype=float)
    l = df["low"].to_numpy(dtype=float)
    c = df["close"].to_numpy(dtype=float)
    n = len(c)
    out = np.full(n, np.nan)
    if n < 2:
        return pd.Series(out, index=df.index)
    # Pivot confirmation is inherently sequential: a swing only becomes a
    # pivot once price retraces `deviation` percent against it.
    trend = 1
    last_idx = 0
    last_price = c[0]
    out[0] = c[0]
    for i in range(1, n):
        if trend == 1:
            if h[i] > last_price:
                last_price = h[i]
                last_idx = i
            change = (last_price - l[i]) / last_price * 100.0
            if change >= deviation:
                out[last_idx] = last_price
                trend = -1
                last_price = l[i]
                last_idx = i
        else:
            if l[i] < last_price:
                last_price = l[i]
                last_idx = i
            change = (h[i] - last_price) / last_price * 100.0
            if change >= deviation:
                out[last_idx] = last_price
                trend = 1
                last_price = h[i]
                last_idx = i
    out[last_idx] = last_price
    # Straight-line interpolation between confirmed pivots, so the output
    # is a continuous polyline rather than dots.
    prev = -1
    for i in range(n):
        if not np.isnan(out[i]):
            if prev >= 0 and i - prev > 1:
                start_val, end_val = out[prev], out[i]
                for j in range(prev + 1, i):
                    out[j] = start_val + (end_val - start_val) * ((j - prev) / (i - prev))
            prev = i
    return pd.Series(out, index=df.index)
