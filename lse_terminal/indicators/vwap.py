from lse_terminal.contracts import indicator


@indicator("vwap", title="VWAP", params={})
def vwap(df):
    # Daily-anchored: cumulation resets at each UTC day boundary, the standard
    # session-VWAP convention and what the chart has always drawn. True
    # exchange-session anchoring needs session metadata (registry work).
    typical = (df["high"] + df["low"] + df["close"]) / 3.0
    vol = df["volume"].clip(lower=0.0)
    day = (df["ts"] // 86400)
    cum_vol = vol.groupby(day).cumsum()
    out = (typical * vol).groupby(day).cumsum() / cum_vol.where(cum_vol > 0)
    # Zero-volume opening bars have no VWAP yet; the chart falls back to close.
    return out.fillna(df["close"])
