import numpy as np

from lse_terminal.contracts import indicator


@indicator("coppock", title="Coppock Curve", overlay=False,
           params={"long_roc": {"type": "int", "default": 14, "min": 1, "max": 500},
                   "short_roc": {"type": "int", "default": 11, "min": 1, "max": 500},
                   "wma_length": {"type": "int", "default": 10, "min": 1, "max": 200}})
def coppock(df, long_roc=14, short_roc=11, wma_length=10):
    c = df["close"]

    def roc(period):
        prev = c.shift(period)
        r = (c - prev) / prev * 100.0
        # Return 0 (not NaN) when the reference close is exactly zero.
        return r.mask(prev == 0, 0.0)

    combined = roc(long_roc) + roc(short_roc)
    weights = np.arange(1, wma_length + 1, dtype=float)
    denom = weights.sum()
    # Any NaN inside the window keeps the WMA NaN.
    return combined.rolling(wma_length).apply(
        lambda w: np.dot(w, weights) / denom, raw=True)
