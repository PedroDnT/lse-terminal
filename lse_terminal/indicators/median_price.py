from lse_terminal.contracts import indicator


@indicator("median_price", title="Median Price")
def median_price(df):
    return (df["high"] + df["low"]) / 2.0
