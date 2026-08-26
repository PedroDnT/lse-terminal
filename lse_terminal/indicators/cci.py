import numpy as np

from lse_terminal.contracts import indicator


@indicator("cci", title="Commodity Channel Index", overlay=False,
           params={"length": {"type": "int", "default": 20, "min": 2, "max": 200}})
def cci(df, length=20):
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    sma_tp = tp.rolling(length).mean()
    mad = tp.rolling(length).apply(lambda x: np.abs(x - x.mean()).mean(), raw=True)
    return (tp - sma_tp) / (0.015 * mad.where(mad > 0))
