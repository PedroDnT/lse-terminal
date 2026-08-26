"""Streaming bid/ask inference for quote-less feeds.

The LSE data feed publishes trade prints without usable quotes for some
asset classes (stocks, futures, and crypto, where the feed repeats the
trade price into both quote fields). A real broker always shows a bid and
an ask, so the terminal infers one locally, on the user's machine, from
the only thing the tape gives us: the prints themselves. The feed itself
is never touched; providers that deliver real quotes pass through
untouched, byte for byte.

Two microstructure fingerprints make the inference possible. Consecutive
trades bounce between the invisible bid and ask, so:

- Roll (1984): the bounce makes adjacent price changes negatively
  correlated; spread = 2*sqrt(-cov(dp_t, dp_{t-1})). Raw Roll reads low
  when order flow clusters on one side, so it is scaled by ROLL_MULT,
  fitted against real CME/COMEX best bid/offer (ES, NQ, GC:
  true spread / raw Roll measured 3.26, 3.69, 3.05, so 3.3
  lands within ~10% on all three).
- Reversal bounce: when the tape flips direction, the flip is typically
  one spread wide; tracked as an EWMA and blended in at lower weight
  (its calibrated ratio on the same data was less stable: 1.2 to 2.4).

The blended estimate is snapped to the instrument's price grid, inferred
from the smallest nonzero move seen, because real spreads sit at integer
tick multiples and a spread of 0.2937 is the tell that it is simulated.
Quote placement is aggressor-aware: an uptick prints at the ask, a
downtick at the bid, so every print sits ON one of the two lines exactly
as a real feed looks. Everything is O(1) per tick with no lookback
buffers, so it runs inline in the provider's stream reader thread.
"""

from __future__ import annotations

import math

# Calibrated against real futures BBO (see module docstring). Applied to the
# raw Roll estimate; refit if the estimator windows below change.
ROLL_MULT = 3.3
BOUNCE_MULT = 1.9

# EWMA decay per tick. COV is the slowest because covariance is the noisiest
# statistic; ~1/alpha is the effective window in ticks.
ALPHA_COV = 0.01
ALPHA_BOUNCE = 0.05

# No synthetic quote until this many prints have been seen: better to show
# nothing for a few seconds than to show a number made from three trades.
MIN_TICKS = 30

# Ceiling as a fraction of price. Wider than any liquid instrument; only
# there so a burst of bad prints cannot paint a comedy spread.
MAX_SPREAD_FRAC = 0.01


class SpreadEstimator:
    """Per-symbol streaming spread inference from trade prints."""

    def __init__(self) -> None:
        self._last_price: float | None = None
        self._last_dp: float = 0.0
        self._cov: float = 0.0          # EWMA of dp_t * dp_{t-1}
        self._mean_dp: float = 0.0      # EWMA of dp (Roll's mean correction)
        self._bounce: float | None = None  # EWMA of |dp| on direction flips
        self._tick_size: float | None = None
        self._side: int = 1             # +1 = last aggressor lifted the ask
        self._n: int = 0

    def update(self, price: float) -> tuple[float, float] | None:
        """Feed one print; return (bid, ask) once warm, else None."""
        if not (isinstance(price, (int, float)) and math.isfinite(price)) or price <= 0:
            return None
        if self._last_price is None:
            self._last_price = float(price)
            return None

        dp = float(price) - self._last_price
        self._last_price = float(price)
        self._n += 1

        # Price-grid inference: the smallest nonzero move ever seen. The
        # epsilon guard keeps float dust (1e-13 on a re-quoted price) from
        # becoming the "tick".
        adp = abs(dp)
        if adp > 1e-9 * price and (self._tick_size is None or adp < self._tick_size):
            self._tick_size = adp

        # Roll accumulators. Zero-moves stay in on purpose: the ROLL_MULT
        # calibration was fitted on the full print series including repeats,
        # and dropping them here would silently change what 3.3 means.
        self._mean_dp += ALPHA_COV * (dp - self._mean_dp)
        self._cov += ALPHA_COV * (dp * self._last_dp - self._cov)

        if dp * self._last_dp < 0:  # direction flip = one bid-ask crossing
            b = adp if self._bounce is None else self._bounce + ALPHA_BOUNCE * (adp - self._bounce)
            self._bounce = b
        if dp > 0:
            self._side = 1
        elif dp < 0:
            self._side = -1
        self._last_dp = dp

        if self._n < MIN_TICKS or self._tick_size is None:
            return None

        estimates: list[tuple[float, float]] = []  # (value, weight)
        acov = self._cov - self._mean_dp * self._mean_dp
        if acov < 0:
            estimates.append((ROLL_MULT * 2.0 * math.sqrt(-acov), 2.0))
        if self._bounce is not None:
            estimates.append((BOUNCE_MULT * self._bounce, 1.0))
        if not estimates:
            return None
        est = sum(v * w for v, w in estimates) / sum(w for _, w in estimates)

        # Snap to the price grid and clamp: at least one tick, at most
        # MAX_SPREAD_FRAC of price.
        tick = self._tick_size
        spread = max(tick, round(est / tick) * tick)
        cap = max(tick, MAX_SPREAD_FRAC * price)
        spread = min(spread, cap)

        # Aggressor-aware placement: the print sits on the side that traded.
        if self._side > 0:
            bid, ask = price - spread, price
        else:
            bid, ask = price, price + spread
        # Kill float dust (65000.03999999998): quotes get two more decimals
        # than the inferred tick needs, which preserves any sub-tick price
        # while never showing artifacts.
        nd = max(0, 2 - int(math.floor(math.log10(tick))))
        return round(bid, nd), round(ask, nd)


class QuoteSynthesizer:
    """Fill bid/ask on stream items that arrive without a usable quote.

    A usable quote means bid and ask both present with ask > bid; the feed
    sends bid == ask == price for some classes, which is no quote at all.
    Real quotes pass through untouched and never feed the estimators: for
    quote-driven feeds the print IS the bid, there is no bounce to measure.
    Synthetic fills are marked quote_synthetic so the UI can say so.
    """

    def __init__(self) -> None:
        self._est: dict[str, SpreadEstimator] = {}

    def fill(self, item: dict) -> dict:
        price = item.get("price")
        symbol = item.get("symbol")
        if price is None or symbol is None:
            return item
        bid, ask = item.get("bid"), item.get("ask")
        if bid is not None and ask is not None and ask > bid:
            return item
        est = self._est.get(symbol)
        if est is None:
            est = self._est[symbol] = SpreadEstimator()
        quote = est.update(price)
        if quote is not None:
            item["bid"], item["ask"] = quote
            item["quote_synthetic"] = True
        else:
            # Never forward the feed's bid == ask placeholder as a quote.
            item["bid"] = item["ask"] = None
        return item
