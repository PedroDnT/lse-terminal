from lse_terminal.contracts import indicator


@indicator("ao", title="Awesome Oscillator", overlay=False, params={},
           styles={"ao": {"kind": "histogram"}})
def ao(df):
    median = (df["high"] + df["low"]) / 2.0
    return (median.rolling(5).mean() - median.rolling(34).mean()).rename("ao")
