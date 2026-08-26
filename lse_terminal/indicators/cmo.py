from lse_terminal.contracts import indicator


@indicator("cmo", title="Chande Momentum Oscillator", overlay=False,
           params={"length": {"type": "int", "default": 9, "min": 2, "max": 200}})
def cmo(df, length=9):
    delta = df["close"].diff()
    up = delta.clip(lower=0.0).rolling(length).sum()
    down = (-delta).clip(lower=0.0).rolling(length).sum()
    total = up + down
    # A flat window (total 0) maps to 0, not NaN
    return ((up - down) / total * 100.0).mask(total == 0, 0.0)
