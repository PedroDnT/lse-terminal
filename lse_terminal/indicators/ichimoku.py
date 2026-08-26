import pandas as pd

from lse_terminal.contracts import indicator


@indicator("ichimoku", title="Ichimoku Cloud",
           params={"tenkan": {"type": "int", "default": 9, "min": 1, "max": 200},
                   "kijun": {"type": "int", "default": 26, "min": 1, "max": 300},
                   "senkou_b": {"type": "int", "default": 52, "min": 1, "max": 500},
                   "displacement": {"type": "int", "default": 26, "min": 0, "max": 300}})
def ichimoku(df, tenkan=9, kijun=26, senkou_b=52, displacement=26):
    def midpoint(period):
        return (df["high"].rolling(period).max()
                + df["low"].rolling(period).min()) / 2.0

    tenkan_line = midpoint(tenkan)
    kijun_line = midpoint(kijun)
    # Senkou spans plot displaced forward; the chikou span is the raw close,
    # displaced backward at render time, so the data column is just close.
    senkou_a = ((tenkan_line + kijun_line) / 2.0).shift(displacement)
    senkou_b_line = midpoint(senkou_b).shift(displacement)
    return pd.DataFrame({"tenkan": tenkan_line, "kijun": kijun_line,
                         "senkou_a": senkou_a, "senkou_b": senkou_b_line,
                         "chikou": df["close"]})
