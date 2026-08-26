import math

import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("fisher", title="Fisher Transform", overlay=False,
           params={"length": {"type": "int", "default": 10, "min": 2, "max": 200}})
def fisher(df, length=10):
    h = df["high"].to_numpy(dtype=float)
    l = df["low"].to_numpy(dtype=float)
    hh = df["high"].rolling(length).max().to_numpy()
    ll = df["low"].rolling(length).min().to_numpy()
    n = len(h)
    fish_out = np.full(n, np.nan)
    trig_out = np.full(n, np.nan)
    # The smoothed value and prior fisher are recursive state, so this stays a
    # loop (supertrend precedent). Both are seeded at 0, making the first
    # trigger value 0 rather than NaN; replicated for parity.
    val = 0.0
    prev_fish = 0.0
    for i in range(length - 1, n):
        rng = hh[i] - ll[i]
        mid = (h[i] + l[i]) / 2.0
        raw = 0.0 if rng == 0 else 0.33 * 2.0 * ((mid - ll[i]) / rng - 0.5) + 0.67 * val
        val = max(-0.999, min(0.999, raw))
        fish = 0.5 * math.log((1.0 + val) / (1.0 - val)) + 0.5 * prev_fish
        trig_out[i] = prev_fish
        fish_out[i] = fish
        prev_fish = fish
    return pd.DataFrame({"fisher": fish_out, "trigger": trig_out}, index=df.index)
