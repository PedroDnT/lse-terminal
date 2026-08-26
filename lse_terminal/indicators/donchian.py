import pandas as pd

from lse_terminal.contracts import indicator


@indicator("donchian", title="Donchian Channels",
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 500}})
def donchian(df, length=20):
    upper = df["high"].rolling(length).max()
    lower = df["low"].rolling(length).min()
    return pd.DataFrame({"upper": upper, "middle": (upper + lower) / 2.0,
                         "lower": lower})
