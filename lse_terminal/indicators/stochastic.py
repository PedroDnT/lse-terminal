import pandas as pd

from lse_terminal.contracts import indicator


@indicator("stochastic", title="Stochastic", overlay=False,
           params={"k": {"type": "int", "default": 14, "min": 1, "max": 200},
                   "smooth": {"type": "int", "default": 3, "min": 1, "max": 50},
                   "d": {"type": "int", "default": 3, "min": 1, "max": 50}})
def stochastic(df, k=14, smooth=3, d=3):
    ll = df["low"].rolling(k).min()
    hh = df["high"].rolling(k).max()
    rng = (hh - ll).where(lambda s: s > 0)
    raw_k = 100.0 * (df["close"] - ll) / rng
    k_line = raw_k.rolling(smooth).mean()
    return pd.DataFrame({"k": k_line, "d": k_line.rolling(d).mean()})
