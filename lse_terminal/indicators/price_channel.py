import pandas as pd

from lse_terminal.contracts import indicator


@indicator("price_channel", title="Price Channel",
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 500}})
def price_channel(df, length=20):
    # Deliberately excludes the current bar (window ends at the prior bar) so
    # the channel is breakable by the bar being evaluated.
    upper = df["high"].shift(1).rolling(length).max()
    lower = df["low"].shift(1).rolling(length).min()
    return pd.DataFrame({"upper": upper, "middle": (upper + lower) / 2.0,
                         "lower": lower})
