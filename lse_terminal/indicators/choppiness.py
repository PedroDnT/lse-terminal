import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("choppiness", title="Choppiness Index", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 2, "max": 200}})
def choppiness(df, length=14):
    h, l, c = df["high"], df["low"], df["close"]
    prev_c = c.shift()
    tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()],
                   axis=1).max(axis=1)
    # Bar 0 has no prior close; keeping it NaN pushes the first output to bar
    # length, matching the chart's warm-up.
    tr.iloc[0] = float("nan")
    atr_sum = tr.rolling(length).sum()
    rng = h.rolling(length).max() - l.rolling(length).min()
    out = 100.0 * np.log10(atr_sum / rng) / np.log10(length)
    return out.where(rng != 0, 50.0)
