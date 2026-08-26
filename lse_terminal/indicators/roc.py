from lse_terminal.contracts import indicator


@indicator("roc", title="Rate of Change", overlay=False,
           params={"length": {"type": "int", "default": 12, "min": 1, "max": 500}})
def roc(df, length=12):
    prev = df["close"].shift(length)
    return 100.0 * (df["close"] / prev.where(prev != 0) - 1.0)
