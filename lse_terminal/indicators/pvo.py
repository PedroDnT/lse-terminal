import pandas as pd

from lse_terminal.contracts import indicator
from lse_terminal.indicators.ppo import ppo_lines


@indicator("pvo", title="Percentage Volume Oscillator", overlay=False,
           params={"fast": {"type": "int", "default": 12, "min": 1, "max": 200},
                   "slow": {"type": "int", "default": 26, "min": 2, "max": 500},
                   "signal": {"type": "int", "default": 9, "min": 1, "max": 200}},
           styles={"hist": {"kind": "histogram"}})
def pvo(df, fast=12, slow=26, signal=9):
    # PVO is the PPO math applied to volume; mirrored here.
    line, sig, hist = ppo_lines(df["volume"].to_numpy(dtype=float), fast, slow, signal)
    return pd.DataFrame({"pvo": line, "signal": sig, "hist": hist}, index=df.index)
