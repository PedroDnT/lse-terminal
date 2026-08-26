import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("aroon", title="Aroon", overlay=False,
           params={"length": {"type": "int", "default": 25, "min": 1, "max": 200}})
def aroon(df, length=25):
    # argmax over an n+1 window = bars since the extreme, TradingView convention.
    win = length + 1
    since_high = win - 1 - df["high"].rolling(win).apply(np.argmax, raw=True)
    since_low = win - 1 - df["low"].rolling(win).apply(np.argmin, raw=True)
    return pd.DataFrame({"up": 100.0 * (length - since_high) / length,
                         "down": 100.0 * (length - since_low) / length})
