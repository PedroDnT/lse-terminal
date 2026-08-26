import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("psar", title="Parabolic SAR",
           params={"af_start": {"type": "float", "default": 0.02, "min": 0.001, "max": 0.5},
                   "af_step": {"type": "float", "default": 0.02, "min": 0.001, "max": 0.5},
                   "af_max": {"type": "float", "default": 0.2, "min": 0.01, "max": 1.0}})
def psar(df, af_start=0.02, af_step=0.02, af_max=0.2):
    h, l = df["high"].values, df["low"].values
    n = len(h)
    sar = np.full(n, np.nan)
    direction = np.full(n, np.nan)
    if n < 2:
        return pd.DataFrame({"sar": sar, "direction": direction}, index=df.index)

    is_long = h[1] > h[0]
    af = af_start
    ep = h[0] if is_long else l[0]
    sar_val = l[0] if is_long else h[0]

    # Accelerating stop-and-reverse state is inherently sequential.
    for i in range(n):
        if i < 2:
            sar[i] = sar_val
            direction[i] = 1 if is_long else -1
            continue
        sar_val = sar_val + af * (ep - sar_val)
        if is_long:
            # SAR may never enter the prior two bars' range.
            sar_val = min(sar_val, l[i - 1], l[i - 2])
            if l[i] < sar_val:
                is_long = False
                sar_val = ep
                ep = l[i]
                af = af_start
            elif h[i] > ep:
                ep = h[i]
                af = min(af + af_step, af_max)
        else:
            sar_val = max(sar_val, h[i - 1], h[i - 2])
            if h[i] > sar_val:
                is_long = True
                sar_val = ep
                ep = h[i]
                af = af_start
            elif l[i] < ep:
                ep = l[i]
                af = min(af + af_step, af_max)
        sar[i] = sar_val
        direction[i] = 1 if is_long else -1
    return pd.DataFrame({"sar": sar, "direction": direction}, index=df.index)
