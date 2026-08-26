import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("uo", title="Ultimate Oscillator", overlay=False,
           params={"fast": {"type": "int", "default": 7, "min": 1, "max": 100},
                   "med": {"type": "int", "default": 14, "min": 1, "max": 200},
                   "slow": {"type": "int", "default": 28, "min": 2, "max": 500}})
def uo(df, fast=7, med=14, slow=28):
    prev_c = df["close"].shift()
    low_or_pc = np.minimum(df["low"], prev_c)
    bp = df["close"] - low_or_pc
    tr = np.maximum(df["high"], prev_c) - low_or_pc

    def avg(p):
        b, t = bp.rolling(p).sum(), tr.rolling(p).sum()
        # A zero true-range sum is treated as 0, not NaN
        return (b / t).mask(t == 0, 0.0)

    out = (4.0 * avg(fast) + 2.0 * avg(med) + avg(slow)) / 7.0 * 100.0
    out.iloc[:slow] = np.nan  # NaN strictly for i < slow
    return out
