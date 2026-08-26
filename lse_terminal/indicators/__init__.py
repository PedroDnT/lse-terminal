"""Built-in indicators. Importing this package registers them all.

Each file is one indicator and doubles as the template for community PRs:
copy any of these, change the math, add a test, done.

The full chart indicator set is Python by design: every
indicator is verified numerically against reference outputs on a
shared fixture (tests/test_indicator_parity.py).
"""

from lse_terminal.indicators import (  # noqa: F401
    acc_bands, adl, adx, alligator, alma, ao, apo, aroon, atr, bb_percent,
    bb_width, bollinger, bop, camarilla, cci, chaikin_vol, chande_kroll,
    chandelier, choppiness, cmf, cmo, connors_rsi, coppock, dema, demark,
    donchian, dpo, elder_ray, ema, envelopes, eom, fib_retracement, fisher,
    force_index, fractals, gator, hist_vol, hma, ichimoku, kama, keltner,
    klinger, kst, lin_reg, lr_slope, lsma, macd, mass_index, mcginley,
    median_price, mfi, momentum, natr, net_volume, nvi, obv, pfe, pivots,
    ppo, price_channel, psar, psych_line, pvi, pvo, pvt, qstick, r_squared,
    roc, rsi, rvi, rvol, sma, smi, smma, squeeze, stc, stddev, stoch_rsi,
    stochastic, supertrend, t3, tema, trix, true_range, tsi, twiggs_mf,
    typical_price, ulcer, uo, vhf, volume, volume_osc, volume_sma, vortex,
    vroc, vwap, vwma, weighted_close, willr, wma, woodie, zigzag, zlema,
)

# Compatibility re-export: the canonical decorator lives in
# lse_terminal.contracts, but `from lse_terminal.indicators import indicator`
# is what people (and AI assistants) naturally write because this package is
# named "indicators"; the hosted assistant has emitted exactly that
# and the user's file loaded as "broken". Both imports now work.
from lse_terminal.contracts.indicator import indicator  # noqa: E402, F401

# Brue-language indicators (bundled .brue scripts in indicators/brue/)
# register at import time like everything above, so the registry content
# is deterministic and tests never depend on app-construction order.
from lse_terminal.engine import brue_indicators as _brue_bridge  # noqa: E402

_BRUE_BUNDLED_ERRORS = _brue_bridge.load_bundled()
