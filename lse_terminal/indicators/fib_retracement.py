import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("fib_retracement", title="Fibonacci Retracement",
           params={"lookback": {"type": "int", "default": 100, "min": 2, "max": 5000}})
def fib_retracement(df, lookback=100):
    # The levels are constant, taken from the swing high/low of the
    # last `lookback` bars; we draw them only over that window so the chart
    # shows where the levels actually apply.
    n = len(df)
    start = max(0, n - lookback)
    hi = df["high"].iloc[start:].max()
    lo = df["low"].iloc[start:].min()
    diff = hi - lo
    ratios = {"f000": 0.0, "f236": 0.236, "f382": 0.382, "f500": 0.5,
              "f618": 0.618, "f786": 0.786, "f1000": 1.0}
    out = pd.DataFrame(np.nan, index=df.index, columns=list(ratios))
    for col, r in ratios.items():
        out.iloc[start:, out.columns.get_loc(col)] = hi - diff * r
    return out
