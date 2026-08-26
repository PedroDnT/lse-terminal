import numpy as np

from lse_terminal.contracts import indicator


@indicator("alma", title="Arnaud Legoux Moving Average",
           params={"length": {"type": "int", "default": 21, "min": 2, "max": 500},
                   "offset": {"type": "float", "default": 0.85, "min": 0, "max": 1},
                   "sigma": {"type": "float", "default": 6.0, "min": 0.1, "max": 100}})
def alma(df, length=21, offset=0.85, sigma=6.0):
    m = offset * (length - 1)
    s = length / sigma
    w = np.exp(-((np.arange(length) - m) ** 2) / (2 * s * s))
    w /= w.sum()
    return df["close"].rolling(length).apply(lambda x: float(np.dot(x, w)), raw=True)
