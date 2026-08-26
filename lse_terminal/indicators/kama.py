import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("kama", title="Kaufman Adaptive Moving Average",
           params={"length": {"type": "int", "default": 10, "min": 2, "max": 200},
                   "fast": {"type": "int", "default": 2, "min": 1, "max": 50},
                   "slow": {"type": "int", "default": 30, "min": 2, "max": 200}})
def kama(df, length=10, fast=2, slow=30):
    c = df["close"].values
    change = np.abs(pd.Series(c).diff(length).values)
    volatility = pd.Series(np.abs(np.diff(c, prepend=c[0]))).rolling(length).sum().values
    with np.errstate(divide="ignore", invalid="ignore"):
        er = np.where(volatility > 0, change / volatility, 0.0)
    fast_sc, slow_sc = 2.0 / (fast + 1), 2.0 / (slow + 1)
    sc = (er * (fast_sc - slow_sc) + slow_sc) ** 2

    out = np.full(len(c), np.nan)
    if len(c) > length:
        out[length] = c[length]
        for i in range(length + 1, len(c)):
            out[i] = out[i - 1] + sc[i] * (c[i] - out[i - 1])
    return pd.Series(out, index=df.index)
