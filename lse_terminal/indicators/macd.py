import pandas as pd

from lse_terminal.contracts import indicator


@indicator("macd", title="MACD", overlay=False,
           params={"fast": {"type": "int", "default": 12, "min": 1, "max": 200},
                   "slow": {"type": "int", "default": 26, "min": 2, "max": 500},
                   "signal": {"type": "int", "default": 9, "min": 1, "max": 200}},
           styles={"hist": {"kind": "histogram"}})
def macd(df, fast=12, slow=26, signal=9):
    fast_ema = df["close"].ewm(span=fast, adjust=False).mean()
    slow_ema = df["close"].ewm(span=slow, adjust=False).mean()
    line = fast_ema - slow_ema
    sig = line.ewm(span=signal, adjust=False).mean()
    return pd.DataFrame({"macd": line, "signal": sig, "hist": line - sig})
