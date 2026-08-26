import math

import numpy as np

from lse_terminal.contracts import indicator


def _wma(s, n):
    w = np.arange(1, n + 1, dtype=float)
    return s.rolling(n).apply(lambda x: (x * w).sum() / w.sum(), raw=True)


@indicator("hma", title="Hull Moving Average",
           params={"length": {"type": "int", "default": 21, "min": 2, "max": 500}})
def hma(df, length=21):
    half = max(1, length // 2)
    root = max(1, int(math.sqrt(length)))
    return _wma(2 * _wma(df["close"], half) - _wma(df["close"], length), root)
