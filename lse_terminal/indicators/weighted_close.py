from lse_terminal.contracts import indicator


@indicator("weighted_close", title="Weighted Close")
def weighted_close(df):
    return (df["high"] + df["low"] + 2.0 * df["close"]) / 4.0
