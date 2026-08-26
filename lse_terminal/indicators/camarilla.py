import pandas as pd

from lse_terminal.contracts import indicator


@indicator("camarilla", title="Camarilla Pivots")
def camarilla(df):
    # Levels derive from the PREVIOUS day's completed H/L/C; first day is NaN.
    day = df["ts"] // 86400
    grp = df.groupby(day, sort=False)
    ph = grp["high"].max().shift()
    pl = grp["low"].min().shift()
    pc = grp["close"].last().shift()
    rng = ph - pl
    lvl = pd.DataFrame({
        "h4": pc + rng * 1.1 / 2.0,
        "h3": pc + rng * 1.1 / 4.0,
        "l3": pc - rng * 1.1 / 4.0,
        "l4": pc - rng * 1.1 / 2.0,
    })
    out = lvl.reindex(day.to_numpy())
    out.index = df.index
    return out
