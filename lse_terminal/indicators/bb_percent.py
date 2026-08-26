from lse_terminal.contracts import indicator


@indicator("bb_percent", title="Bollinger %B", overlay=False,
           params={"length": {"type": "int", "default": 20, "min": 2, "max": 500},
                   "mult": {"type": "float", "default": 2.0, "min": 0.1, "max": 10}})
def bb_percent(df, length=20, mult=2.0):
    mid = df["close"].rolling(length).mean()
    # Population std (ddof=0) to match the chart's Bollinger math.
    sd = df["close"].rolling(length).std(ddof=0)
    upper = mid + mult * sd
    lower = mid - mult * sd
    rng = upper - lower
    pct = (df["close"] - lower) / rng
    # Flat window collapses the bands; price is by definition mid-band.
    return pct.mask(rng == 0, 0.5)
