from lse_terminal.contracts import indicator


@indicator("vroc", title="Volume Rate of Change", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 1, "max": 500}})
def vroc(df, length=14):
    prev = df["volume"].shift(length)
    out = (df["volume"] - prev) / prev * 100.0
    # A zero baseline volume reports 0, not infinity (chart convention).
    return out.mask(prev == 0, 0.0)
