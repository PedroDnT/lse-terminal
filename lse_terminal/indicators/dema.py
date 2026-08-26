from lse_terminal.contracts import indicator


@indicator("dema", title="Double EMA",
           params={"length": {"type": "int", "default": 21, "min": 1, "max": 500}})
def dema(df, length=21):
    e1 = df["close"].ewm(span=length, adjust=False).mean()
    e2 = e1.ewm(span=length, adjust=False).mean()
    return 2 * e1 - e2
