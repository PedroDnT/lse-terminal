from lse_terminal.contracts import indicator


@indicator("momentum", title="Momentum", overlay=False,
           params={"length": {"type": "int", "default": 10, "min": 1, "max": 500}})
def momentum(df, length=10):
    return df["close"].diff(length)
