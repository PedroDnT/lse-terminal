import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _roc(close, period):
    prev = close.shift(period)
    # A zero base price maps to 0 rather than inf; warm-up stays NaN.
    return ((close - prev) / prev * 100.0).mask(prev == 0, 0.0)


@indicator("kst", title="Know Sure Thing", overlay=False,
           params={"roc1": {"type": "int", "default": 10, "min": 1, "max": 500},
                   "roc2": {"type": "int", "default": 15, "min": 1, "max": 500},
                   "roc3": {"type": "int", "default": 20, "min": 1, "max": 500},
                   "roc4": {"type": "int", "default": 30, "min": 1, "max": 500},
                   "sma1": {"type": "int", "default": 10, "min": 1, "max": 200},
                   "sma2": {"type": "int", "default": 10, "min": 1, "max": 200},
                   "sma3": {"type": "int", "default": 10, "min": 1, "max": 200},
                   "sma4": {"type": "int", "default": 15, "min": 1, "max": 200},
                   "signal": {"type": "int", "default": 9, "min": 1, "max": 200}})
def kst(df, roc1=10, roc2=15, roc3=20, roc4=30,
        sma1=10, sma2=10, sma3=10, sma4=15, signal=9):
    c = df["close"]
    # pandas rolling mean already smooths from the first valid value when the
    # NaN prefix is contiguous, matching the NaN-safe SMA wrapper exactly.
    r1 = _roc(c, roc1).rolling(sma1).mean()
    r2 = _roc(c, roc2).rolling(sma2).mean()
    r3 = _roc(c, roc3).rolling(sma3).mean()
    r4 = _roc(c, roc4).rolling(sma4).mean()
    line = r1 + 2.0 * r2 + 3.0 * r3 + 4.0 * r4
    # Signal: SMA over the compacted valid KST values, scattered back onto
    # the valid positions; with a contiguous NaN prefix this is a rolling mean.
    sig = line.rolling(signal).mean()
    return pd.DataFrame({"kst": line, "signal": sig})
