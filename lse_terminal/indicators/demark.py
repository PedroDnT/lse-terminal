import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("demark", title="DeMark Pivots")
def demark(df):
    # Levels derive from the PREVIOUS day's completed O/H/L/C; first day is NaN.
    # DeMark weights the day's extreme by whether it closed up, down, or flat.
    day = df["ts"] // 86400
    grp = df.groupby(day, sort=False)
    ph = grp["high"].max().shift()
    pl = grp["low"].min().shift()
    po = grp["open"].first().shift()
    pc = grp["close"].last().shift()
    # NaN compares False on both branches, so the first day falls through to
    # the flat-close formula, which is NaN anyway.
    x = np.where(pc < po, ph + 2.0 * pl + pc,
                 np.where(pc > po, 2.0 * ph + pl + pc, ph + pl + 2.0 * pc))
    x = pd.Series(x, index=ph.index)
    lvl = pd.DataFrame({
        "pivot": x / 4.0,
        "r1": x / 2.0 - pl,
        "s1": x / 2.0 - ph,
    })
    out = lvl.reindex(day.to_numpy())
    out.index = df.index
    return out
