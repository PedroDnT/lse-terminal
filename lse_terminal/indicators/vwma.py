from lse_terminal.contracts import indicator


@indicator("vwma", title="Volume Weighted MA",
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 500}})
def vwma(df, length=20):
    vol = df["volume"].fillna(0.0)
    pv_sum = (df["close"] * vol).rolling(length).sum()
    v_sum = vol.rolling(length).sum()
    out = pv_sum / v_sum
    # A dead window (zero total volume) falls back to close, per the chart.
    return out.mask(v_sum == 0, df["close"])
