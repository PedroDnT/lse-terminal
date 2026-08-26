from lse_terminal.contracts import indicator


@indicator("volume_sma", title="Volume SMA", overlay=False,
           params={"length": {"type": "int", "default": 20, "min": 1, "max": 500}})
def volume_sma(df, length=20):
    return df["volume"].rolling(length).mean()
