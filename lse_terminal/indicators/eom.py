from lse_terminal.contracts import indicator


@indicator("eom", title="Ease of Movement", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 1, "max": 200}})
def eom(df, length=14):
    mid = (df["high"] + df["low"]) / 2.0
    dm = mid.diff()
    # Zero volume and zero range both fall back to 1 so the box ratio never
    # divides by zero (matches the chart's guard).
    vol = df["volume"].where(df["volume"] != 0, 1.0)
    rng = (df["high"] - df["low"]).where(lambda s: s != 0, 1.0)
    raw = dm / (vol / rng)
    if len(raw):
        raw.iloc[0] = 0.0
    return raw.rolling(length).mean()
