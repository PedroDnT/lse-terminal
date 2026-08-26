import numpy as np

from lse_terminal.contracts import indicator


@indicator("obv", title="On-Balance Volume", overlay=False, params={})
def obv(df):
    signed = np.sign(df["close"].diff()).fillna(0.0) * df["volume"]
    # Seed with the first bar's volume (not 0): OBV has no canonical zero and
    # this matches the chart's long-standing rendering.
    if len(signed):
        signed.iloc[0] = df["volume"].iloc[0]
    return signed.cumsum()
