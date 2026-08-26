from lse_terminal.contracts import indicator


@indicator("volume", title="Volume", overlay=False, params={},
           styles={"volume": {"kind": "histogram"}})
def volume(df):
    return df["volume"].astype(float)
