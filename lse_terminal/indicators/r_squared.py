import math

import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("r_squared", title="R-Squared", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 2, "max": 200}})
def r_squared(df, length=14):
    c = df["close"].to_numpy(dtype=float)
    n = len(c)
    out = np.full(n, np.nan)
    x = np.arange(length, dtype=float)
    sum_x = x.sum()
    sum_x2 = (x * x).sum()
    x_term = length * sum_x2 - sum_x * sum_x
    for i in range(length - 1, n):
        w = c[i - length + 1:i + 1]
        sum_y = w.sum()
        sum_xy = (x * w).sum()
        sum_y2 = (w * w).sum()
        num = length * sum_xy - sum_x * sum_y
        den = math.sqrt(x_term * (length * sum_y2 - sum_y * sum_y))
        r = 0.0 if den == 0 else num / den
        out[i] = r * r
    return pd.Series(out, index=df.index)
