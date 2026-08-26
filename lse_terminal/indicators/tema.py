from lse_terminal.contracts import indicator


@indicator("tema", title="Triple EMA",
           params={"length": {"type": "int", "default": 21, "min": 1, "max": 500}})
def tema(df, length=21):
    e1 = df["close"].ewm(span=length, adjust=False).mean()
    e2 = e1.ewm(span=length, adjust=False).mean()
    e3 = e2.ewm(span=length, adjust=False).mean()
    return 3 * e1 - 3 * e2 + e3
