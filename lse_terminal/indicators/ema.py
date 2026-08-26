from lse_terminal.contracts import indicator


@indicator("ema", title="Exponential Moving Average",
           params={"length": {"type": "int", "default": 50, "min": 1, "max": 500}})
def ema(df, length=50):
    return df["close"].ewm(span=length, adjust=False).mean()
