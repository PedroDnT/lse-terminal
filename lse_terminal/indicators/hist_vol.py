import numpy as np

from lse_terminal.contracts import indicator


@indicator("hist_vol", title="Historical Volatility", overlay=False,
           params={"length": {"type": "int", "default": 20, "min": 2, "max": 500}})
def hist_vol(df, length=20):
    prev = df["close"].shift()
    ret = np.log(df["close"] / prev)
    # Zero prior close would blow up the log ratio; the chart emits 0 there.
    ret = ret.where(prev != 0, 0.0)
    # Sample std (ddof=1), annualized on 252 trading days, in percent.
    return ret.rolling(length).std(ddof=1) * np.sqrt(252.0) * 100.0
