import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("adx", title="Average Directional Index", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 2, "max": 200}})
def adx(df, length=14):
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=df.index)

    prev_close = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"],
                    (df["high"] - prev_close).abs(),
                    (df["low"] - prev_close).abs()], axis=1).max(axis=1)

    alpha = 1.0 / length  # Wilder smoothing throughout
    atr = tr.ewm(alpha=alpha, adjust=False).mean()
    plus_di = 100.0 * plus_dm.ewm(alpha=alpha, adjust=False).mean() / atr
    minus_di = 100.0 * minus_dm.ewm(alpha=alpha, adjust=False).mean() / atr
    dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).where(lambda s: s > 0)
    return pd.DataFrame({"adx": dx.ewm(alpha=alpha, adjust=False).mean(),
                         "di_plus": plus_di, "di_minus": minus_di})
