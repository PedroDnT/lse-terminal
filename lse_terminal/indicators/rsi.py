from lse_terminal.contracts import indicator


@indicator("rsi", title="Relative Strength Index", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 2, "max": 200}})
def rsi(df, length=14):
    delta = df["close"].diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    # Wilder's smoothing = EMA with alpha 1/length, which is what every
    # charting platform labels "RSI"; a plain rolling mean reads ~5 points off.
    avg_gain = gain.ewm(alpha=1.0 / length, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / length, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)
