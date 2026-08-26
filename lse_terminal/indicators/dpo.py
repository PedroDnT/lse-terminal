from lse_terminal.contracts import indicator


@indicator("dpo", title="Detrended Price Oscillator", overlay=False,
           params={"length": {"type": "int", "default": 21, "min": 2, "max": 500}})
def dpo(df, length=21):
    sma = df["close"].rolling(length).mean()
    # Centered convention: compare each close to the
    # SMA computed length/2 + 1 bars ahead, so the last `shift` bars are NaN.
    shift = length // 2 + 1
    return df["close"] - sma.shift(-shift)
