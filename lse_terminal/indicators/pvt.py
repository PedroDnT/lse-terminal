import pandas as pd

from lse_terminal.contracts import indicator


@indicator("pvt", title="Price Volume Trend", overlay=False, params={})
def pvt(df):
    prev = df["close"].shift()
    # Guard against a zero previous close (percent change undefined).
    pct = ((df["close"] - prev) / prev.where(prev != 0)).fillna(0.0)
    raw = pct * df["volume"].fillna(0.0)
    if len(raw):
        raw.iloc[0] = 0.0
    return raw.cumsum()
