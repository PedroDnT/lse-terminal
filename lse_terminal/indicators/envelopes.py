import pandas as pd

from lse_terminal.contracts import indicator


@indicator("envelopes", title="Envelopes",
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 500},
                   "percent": {"type": "float", "default": 2.5, "min": 0.01, "max": 50.0}})
def envelopes(df, length=20, percent=2.5):
    middle = df["close"].rolling(length).mean()
    factor = percent / 100.0
    return pd.DataFrame({"upper": middle * (1.0 + factor),
                         "middle": middle,
                         "lower": middle * (1.0 - factor)})
