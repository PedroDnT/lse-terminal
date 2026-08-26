import numpy as np

from lse_terminal.contracts import indicator


@indicator("ulcer", title="Ulcer Index", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 2, "max": 500}})
def ulcer(df, length=14):
    def _ui(w):
        # Each bar's drawdown is measured against the max of ITS window,
        # so this cannot be expressed as a composition of simple rollings.
        dd = (w - w.max()) / w.max() * 100.0
        return np.sqrt(np.mean(dd * dd))

    return df["close"].rolling(length).apply(_ui, raw=True)
