import numpy as np

from lse_terminal.contracts import indicator


@indicator("vhf", title="Vertical Horizontal Filter", overlay=False,
           params={"length": {"type": "int", "default": 28, "min": 2, "max": 500}})
def vhf(df, length=28):
    close = df["close"]
    hh = close.rolling(length).max()
    ll = close.rolling(length).min()
    # length-1 diffs fall inside a length-bar window.
    sum_change = close.diff().abs().rolling(length - 1).sum()
    out = (hh - ll).abs() / sum_change
    out = out.mask(sum_change == 0, 0.0)
    # The chart starts one bar later than the rolling windows allow.
    out.iloc[:length] = np.nan
    return out
