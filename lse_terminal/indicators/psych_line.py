import numpy as np

from lse_terminal.contracts import indicator


@indicator("psych_line", title="Psychological Line", overlay=False,
           params={"length": {"type": "int", "default": 12, "min": 1, "max": 200}})
def psych_line(df, length=12):
    up = (df["close"].diff() > 0).astype(float)
    out = up.rolling(length).mean() * 100.0
    # Bar 0 has no prior close, so the first full window ends at bar `length`,
    # one later than a plain rolling mean would report.
    out.iloc[:length] = np.nan
    return out
