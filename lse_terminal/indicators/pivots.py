import pandas as pd

from lse_terminal.contracts import indicator


@indicator("pivots", title="Pivot Points")
def pivots(df):
    # Levels for each day come from the PREVIOUS day's completed H/L/C, so the
    # first day of data has no levels (NaN), matching the chart library.
    day = df["ts"] // 86400
    grp = df.groupby(day, sort=False)
    ph = grp["high"].max().shift()
    pl = grp["low"].min().shift()
    pc = grp["close"].last().shift()
    p = (ph + pl + pc) / 3.0
    rng = ph - pl
    lvl = pd.DataFrame({
        "pivot": p,
        "r1": 2.0 * p - pl,
        "r2": p + rng,
        "r3": ph + 2.0 * (p - pl),
        "s1": 2.0 * p - ph,
        "s2": p - rng,
        "s3": pl - 2.0 * (ph - p),
    })
    out = lvl.reindex(day.to_numpy())
    out.index = df.index
    return out
