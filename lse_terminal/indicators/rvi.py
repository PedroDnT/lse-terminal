import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("rvi", title="Relative Vigor Index", overlay=False,
           params={"length": {"type": "int", "default": 10, "min": 1, "max": 200}})
def rvi(df, length=10):
    co = df["close"] - df["open"]
    hl = df["high"] - df["low"]
    # 1-2-2-1 symmetric weighting over the last four bars (Ehlers).
    num = (co + 2.0 * co.shift(1) + 2.0 * co.shift(2) + co.shift(3)) / 6.0
    den = (hl + 2.0 * hl.shift(1) + 2.0 * hl.shift(2) + hl.shift(3)) / 6.0
    # The chart source zeroes the first three bars instead of dropping them.
    num.iloc[:3] = 0.0
    den.iloc[:3] = 0.0
    sn = num.rolling(length).sum()
    sd = den.rolling(length).sum()
    line = sn.div(sd).where(sd != 0, 0.0)
    # Warm-up matches the chart: first value at bar length + 2, where the
    # window no longer touches the zeroed seed bars.
    line.iloc[:length + 2] = np.nan
    signal = (line + 2.0 * line.shift(1) + 2.0 * line.shift(2)
              + line.shift(3)) / 6.0
    return pd.DataFrame({"rvi": line, "signal": signal})
