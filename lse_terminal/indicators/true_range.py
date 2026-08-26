import pandas as pd

from lse_terminal.contracts import indicator


@indicator("true_range", title="True Range", overlay=False, params={})
def true_range(df):
    prev_close = df["close"].shift()
    # skipna max makes bar 0 collapse to high-low, matching the chart's seed.
    return pd.concat([df["high"] - df["low"],
                      (df["high"] - prev_close).abs(),
                      (df["low"] - prev_close).abs()], axis=1).max(axis=1)
