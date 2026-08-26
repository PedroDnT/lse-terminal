from lse_terminal.contracts import indicator


@indicator("typical_price", title="Typical Price")
def typical_price(df):
    return (df["high"] + df["low"] + df["close"]) / 3.0
