import pandas as pd

from lse_terminal.contracts import indicator


@indicator("fractals", title="Williams Fractals",
           params={"length": {"type": "int", "default": 2, "min": 1, "max": 50}})
def fractals(df, length=2):
    h, l = df["high"], df["low"]
    up_ok = pd.Series(True, index=df.index)
    down_ok = pd.Series(True, index=df.index)
    # A fractal needs `length` strictly lower highs (higher lows) on BOTH
    # sides; comparisons against the NaN shifts at the edges come out False,
    # which reproduces the bound of i in [length, n-length).
    for j in range(1, length + 1):
        up_ok &= (h > h.shift(j)) & (h > h.shift(-j))
        down_ok &= (l < l.shift(j)) & (l < l.shift(-j))
    return pd.DataFrame({"up": h.where(up_ok), "down": l.where(down_ok)})
