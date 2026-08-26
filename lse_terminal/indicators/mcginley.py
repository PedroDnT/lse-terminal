import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("mcginley", title="McGinley Dynamic",
           params={"length": {"type": "int", "default": 14, "min": 1, "max": 500}})
def mcginley(df, length=14):
    c = df["close"].values
    n = len(c)
    out = np.full(n, np.nan)
    if n == 0:
        return pd.Series(out, index=df.index)
    # Self-adjusting recursion; the divisor speeds up in downmoves and slows in
    # upmoves, which is the whole point versus a fixed-alpha EMA.
    out[0] = c[0]
    for i in range(1, n):
        prev = out[i - 1]
        ratio = c[i] / prev
        out[i] = prev + (c[i] - prev) / (length * ratio ** 4)
    return pd.Series(out, index=df.index)
