import numpy as np

from lse_terminal.contracts import indicator


@indicator("net_volume", title="Net Volume", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 1, "max": 500}})
def net_volume(df, length=14):
    signed = np.sign(df["close"].diff()).fillna(0.0) * df["volume"].fillna(0.0)
    return signed.rolling(length).mean()
