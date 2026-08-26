from lse_terminal.contracts import indicator


@indicator("stddev", title="Standard Deviation", overlay=False,
           params={"length": {"type": "int", "default": 20, "min": 2, "max": 500}})
def stddev(df, length=20):
    # Population std (ddof=0) matches the chart's divide-by-period convention.
    return df["close"].rolling(length).std(ddof=0)
