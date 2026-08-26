import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _smma(values, length):
    # SMA-seeded Wilder smoothing; pandas ewm seeds from the first value, so a
    # small loop is needed to match the chart library numerically.
    n = len(values)
    out = np.full(n, np.nan)
    if n < length:
        return out
    out[length - 1] = values[:length].sum() / length
    for i in range(length, n):
        out[i] = (out[i - 1] * (length - 1) + values[i]) / length
    return out


@indicator("gator", title="Gator Oscillator", overlay=False,
           styles={"upper": {"kind": "histogram"}, "lower": {"kind": "histogram"}})
def gator(df):
    c = df["close"].to_numpy(dtype=float)
    # Alligator lines: SMMA of close, displaced FORWARD (jaw 8, teeth 5,
    # lips 3), which is a plain shift on aligned series.
    jaw = pd.Series(_smma(c, 13), index=df.index).shift(8)
    teeth = pd.Series(_smma(c, 8), index=df.index).shift(5)
    lips = pd.Series(_smma(c, 5), index=df.index).shift(3)
    return pd.DataFrame({"upper": (jaw - teeth).abs(),
                         "lower": -(teeth - lips).abs()})
