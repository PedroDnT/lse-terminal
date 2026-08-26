import pandas as pd

from lse_terminal.contracts import indicator


@indicator("adl", title="Accumulation/Distribution Line", overlay=False, params={})
def adl(df):
    hl = df["high"] - df["low"]
    # Zero-range bars contribute nothing (money flow multiplier forced to 0).
    mfm = (((df["close"] - df["low"]) - (df["high"] - df["close"])) / hl.where(hl != 0)).fillna(0.0)
    return (mfm * df["volume"].fillna(0.0)).cumsum()
