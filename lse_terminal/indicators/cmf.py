from lse_terminal.contracts import indicator


@indicator("cmf", title="Chaikin Money Flow", overlay=False,
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 200}})
def cmf(df, length=20):
    rng = (df["high"] - df["low"]).where(lambda s: s > 0)
    mfm = ((df["close"] - df["low"]) - (df["high"] - df["close"])) / rng
    mfv = mfm.fillna(0.0) * df["volume"]
    vol_sum = df["volume"].rolling(length).sum()
    return mfv.rolling(length).sum() / vol_sum.where(vol_sum > 0)
