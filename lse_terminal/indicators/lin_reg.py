import math

import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("lin_reg", title="Linear Regression Channel",
           params={"length": {"type": "int", "default": 100, "min": 2, "max": 500},
                   "mult": {"type": "float", "default": 2.0, "min": 0.1, "max": 10.0}})
def lin_reg(df, length=100, mult=2.0):
    c = df["close"].to_numpy(dtype=float)
    n = len(c)
    middle = np.full(n, np.nan)
    upper = np.full(n, np.nan)
    lower = np.full(n, np.nan)
    x = np.arange(length, dtype=float)
    sum_x = x.sum()
    sum_x2 = (x * x).sum()
    denom = length * sum_x2 - sum_x * sum_x
    for i in range(length - 1, n):
        w = c[i - length + 1:i + 1]
        sum_y = w.sum()
        sum_xy = (x * w).sum()
        slope = (length * sum_xy - sum_x * sum_y) / denom
        intercept = (sum_y - slope * sum_x) / length
        # The channel plots the regression ENDPOINT for each window, not the
        # window mean, so the line hugs the most recent bar.
        reg = intercept + slope * (length - 1)
        resid = w - (intercept + slope * x)
        std_err = math.sqrt((resid * resid).sum() / length)
        middle[i] = reg
        upper[i] = reg + mult * std_err
        lower[i] = reg - mult * std_err
    return pd.DataFrame({"middle": middle, "upper": upper, "lower": lower},
                        index=df.index)
