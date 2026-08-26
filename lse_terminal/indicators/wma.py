import numpy as np

from lse_terminal.contracts import indicator


@indicator("wma", title="Weighted Moving Average",
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 500}})
def wma(df, length=20):
    w = np.arange(1, length + 1, dtype=float)
    return df["close"].rolling(length).apply(lambda x: (x * w).sum() / w.sum(), raw=True)
