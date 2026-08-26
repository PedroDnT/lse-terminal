import pandas as pd

from lse_terminal.contracts import indicator


@indicator("keltner", title="Keltner Channels",
           params={"length": {"type": "int", "default": 20, "min": 2, "max": 500},
                   "atr_length": {"type": "int", "default": 10, "min": 1, "max": 500},
                   "mult": {"type": "float", "default": 2.0, "min": 0.1, "max": 10}})
def keltner(df, length=20, atr_length=10, mult=2.0):
    mid = df["close"].ewm(span=length, adjust=False).mean()
    prev_close = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"],
                    (df["high"] - prev_close).abs(),
                    (df["low"] - prev_close).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1.0 / atr_length, adjust=False).mean()
    return pd.DataFrame({"upper": mid + mult * atr, "middle": mid,
                         "lower": mid - mult * atr})
