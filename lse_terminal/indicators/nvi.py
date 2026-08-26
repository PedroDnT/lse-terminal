import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("nvi", title="Negative Volume Index", overlay=False, params={})
def nvi(df):
    c = df["close"].to_numpy(dtype=float)
    v = np.nan_to_num(df["volume"].to_numpy(dtype=float))
    n = len(c)
    out = np.empty(n)
    if n == 0:
        return pd.Series(out, index=df.index)
    out[0] = 1000.0  # conventional NVI base
    # Index compounds only on falling-volume days; inherently sequential.
    for i in range(1, n):
        if v[i] < v[i - 1]:
            out[i] = out[i - 1] * (1.0 + (c[i] - c[i - 1]) / c[i - 1])
        else:
            out[i] = out[i - 1]
    return pd.Series(out, index=df.index)
