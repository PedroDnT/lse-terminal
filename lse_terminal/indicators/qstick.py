from lse_terminal.contracts import indicator


@indicator("qstick", title="Qstick", overlay=False,
           params={"length": {"type": "int", "default": 8, "min": 1, "max": 200}})
def qstick(df, length=8):
    return (df["close"] - df["open"]).rolling(length).mean()
