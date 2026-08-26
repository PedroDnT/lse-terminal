import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("smma", title="Smoothed Moving Average",
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 500}})
def smma(df, length=20):
    c = df["close"].values
    n = len(c)
    out = np.full(n, np.nan)
    if n >= length:
        # Seeded with the plain SMA, then Wilder-style recursion; ewm(alpha=1/n)
        # would seed from the first value instead and diverge from the chart.
        val = c[:length].mean()
        out[length - 1] = val
        for i in range(length, n):
            val = (val * (length - 1) + c[i]) / length
            out[i] = val
    return pd.Series(out, index=df.index)
