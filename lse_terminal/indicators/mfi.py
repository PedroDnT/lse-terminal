import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("mfi", title="Money Flow Index", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 1, "max": 200}})
def mfi(df, length=14):
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    flow = tp * df["volume"].clip(lower=0.0)
    direction = np.sign(tp.diff())
    pos = flow.where(direction > 0, 0.0).rolling(length).sum()
    neg = flow.where(direction < 0, 0.0).rolling(length).sum()
    ratio = pos / neg.where(neg > 0)
    return (100.0 - 100.0 / (1.0 + ratio)).where(neg > 0, 100.0)
