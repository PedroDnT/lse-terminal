import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("acc_bands", title="Acceleration Bands",
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 500}})
def acc_bands(df, length=20):
    high, low = df["high"], df["low"]
    hl = high - low
    # hl == 0 forces the midpoint to be nonzero too, so the guard suffices.
    factor = np.where(hl == 0, 0.0, hl / ((high + low) / 2.0))
    upper_raw = high * (1.0 + 2.0 * factor)
    lower_raw = low * (1.0 - 2.0 * factor)
    return pd.DataFrame({
        "upper": upper_raw.rolling(length).mean(),
        "middle": df["close"].rolling(length).mean(),
        "lower": lower_raw.rolling(length).mean(),
    })
