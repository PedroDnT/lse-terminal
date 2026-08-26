import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("lsma", title="Least Squares MA",
           params={"length": {"type": "int", "default": 25, "min": 2, "max": 500}})
def lsma(df, length=25):
    c = df["close"]
    p = float(length)
    # In-window x runs 0..p-1; rewrite sum(j*y) as sum(t*y) - window_start*sum(y)
    # so the whole regression endpoint vectorizes with two rolling sums.
    sum_x = p * (p - 1) / 2.0
    sum_x2 = (p - 1) * p * (2 * p - 1) / 6.0
    idx = pd.Series(np.arange(len(c), dtype=float), index=c.index)
    sum_y = c.rolling(length).sum()
    sum_ty = (c * idx).rolling(length).sum()
    sum_xy = sum_ty - (idx - length + 1) * sum_y
    slope = (p * sum_xy - sum_x * sum_y) / (p * sum_x2 - sum_x * sum_x)
    intercept = (sum_y - slope * sum_x) / p
    return intercept + slope * (p - 1)
