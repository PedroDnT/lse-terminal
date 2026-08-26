from lse_terminal.contracts import indicator


@indicator("bb_width", title="Bollinger Band Width", overlay=False,
           params={"length": {"type": "int", "default": 20, "min": 2, "max": 500},
                   "mult": {"type": "float", "default": 2.0, "min": 0.1, "max": 10}})
def bb_width(df, length=20, mult=2.0):
    mid = df["close"].rolling(length).mean()
    # Population std (ddof=0) to match the chart's Bollinger math.
    sd = df["close"].rolling(length).std(ddof=0)
    width = (2.0 * mult * sd / mid) * 100.0
    return width.mask(mid == 0)
