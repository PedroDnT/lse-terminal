from lse_terminal.contracts import indicator


@indicator("sma", title="Simple Moving Average",
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 500}})
def sma(df, length=20):
    return df["close"].rolling(length).mean()
