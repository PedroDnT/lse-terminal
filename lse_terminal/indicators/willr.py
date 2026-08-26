from lse_terminal.contracts import indicator


@indicator("willr", title="Williams %R", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 1, "max": 200}})
def willr(df, length=14):
    hh = df["high"].rolling(length).max()
    ll = df["low"].rolling(length).min()
    rng = (hh - ll).where(lambda s: s > 0)
    return -100.0 * (hh - df["close"]) / rng
