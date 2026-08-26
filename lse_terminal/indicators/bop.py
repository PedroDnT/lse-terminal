from lse_terminal.contracts import indicator


@indicator("bop", title="Balance of Power", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 1, "max": 200}})
def bop(df, length=14):
    hl = df["high"] - df["low"]
    # Zero-range bars (h == l) count as 0 rather than poisoning the average.
    raw = (df["close"] - df["open"]).div(hl).where(hl != 0, 0.0)
    return raw.rolling(length).mean()
