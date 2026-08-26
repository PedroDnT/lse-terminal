import pandas as pd

from lse_terminal.contracts import indicator


@indicator("bollinger", title="Bollinger Bands",
           params={"length": {"type": "int", "default": 20, "min": 2, "max": 500},
                   "mult": {"type": "float", "default": 2.0, "min": 0.1, "max": 10}})
def bollinger(df, length=20, mult=2.0):
    mid = df["close"].rolling(length).mean()
    # Population std (ddof=0) matches the classic definition charting
    # platforms use; pandas' default sample std reads visibly tighter.
    sd = df["close"].rolling(length).std(ddof=0)
    return pd.DataFrame({"upper": mid + mult * sd, "middle": mid,
                         "lower": mid - mult * sd})
