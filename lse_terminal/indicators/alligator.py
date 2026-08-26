import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _smma(values, period):
    # SMA seed then Wilder recursion, matching the chart's SMMA.
    n = len(values)
    out = np.full(n, np.nan)
    if n >= period:
        val = values[:period].mean()
        out[period - 1] = val
        for i in range(period, n):
            val = (val * (period - 1) + values[i]) / period
            out[i] = val
    return out


@indicator("alligator", title="Alligator", params={})
def alligator(df):
    c = df["close"].values
    # Bill Williams fixed setup: SMMA 13/8/5 displaced forward 8/5/3 bars.
    jaw = pd.Series(_smma(c, 13), index=df.index).shift(8)
    teeth = pd.Series(_smma(c, 8), index=df.index).shift(5)
    lips = pd.Series(_smma(c, 5), index=df.index).shift(3)
    return pd.DataFrame({"jaw": jaw, "teeth": teeth, "lips": lips})
