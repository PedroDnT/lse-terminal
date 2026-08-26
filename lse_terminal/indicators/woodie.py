import pandas as pd

from lse_terminal.contracts import indicator


@indicator("woodie", title="Woodie Pivots")
def woodie(df):
    # Levels derive from the PREVIOUS day's completed H/L/C; first day is NaN.
    day = df["ts"] // 86400
    grp = df.groupby(day, sort=False)
    ph = grp["high"].max().shift()
    pl = grp["low"].min().shift()
    pc = grp["close"].last().shift()
    p = (ph + pl + 2.0 * pc) / 4.0
    rng = ph - pl
    lvl = pd.DataFrame({
        "pivot": p,
        "r1": 2.0 * p - pl,
        "r2": p + rng,
        "s1": 2.0 * p - ph,
        "s2": p - rng,
    })
    out = lvl.reindex(day.to_numpy())
    out.index = df.index
    return out
