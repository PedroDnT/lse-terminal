import pandas as pd

from lse_terminal.contracts import indicator


@indicator("atr", title="Average True Range", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 1, "max": 200}})
def atr(df, length=14):
    prev_close = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"],
                    (df["high"] - prev_close).abs(),
                    (df["low"] - prev_close).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1.0 / length, adjust=False).mean()
