import pandas as pd

from lse_terminal.contracts import indicator


@indicator("vortex", title="Vortex", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 1, "max": 200}})
def vortex(df, length=14):
    h, l, c = df["high"], df["low"], df["close"]
    prev_c = c.shift()
    vm_plus = (h - l.shift()).abs()
    vm_minus = (l - h.shift()).abs()
    tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()],
                   axis=1).max(axis=1)
    # Bar 0 has no prior bar, so all three series start NaN; the rolling sums
    # then first resolve at bar length, matching the chart's warm-up.
    tr.iloc[0] = float("nan")
    tr_sum = tr.rolling(length).sum()
    plus = (vm_plus.rolling(length).sum() / tr_sum).where(tr_sum != 0, 0.0)
    minus = (vm_minus.rolling(length).sum() / tr_sum).where(tr_sum != 0, 0.0)
    return pd.DataFrame({"plus": plus, "minus": minus})
