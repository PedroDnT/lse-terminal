"""The part after the run: monte carlo and walk-forward.

This is deliberately ours rather than the strategy author's. Anyone can write
a moving average; almost nobody writes an honest resampler, and the ways to
get one quietly wrong (resampling equity instead of trade PnL, forgetting that
a path can go bust mid-sequence, reporting a mean where a median is meant) all
flatter the result.

The maths is deterministic: a seeded LCG means a given (trades, seed) always
reproduces the same numbers. The JSON key names are fixed, because the terminal
UI reads them.
"""

from __future__ import annotations

import math
import struct

_U64_MASK = 0xFFFFFFFFFFFFFFFF


def jnum(v):
    """Non-finite floats as the markers the UI already understands. FastAPI
    cannot emit a bare Infinity/NaN token, so these never become raw JSON."""
    if isinstance(v, str):
        return v
    v = float(v)
    if math.isnan(v):
        return "__NaN__"
    if math.isinf(v):
        return "__+Inf__" if v > 0 else "__-Inf__"
    return v


def _total_cmp_key(x: float):
    """IEEE754 bits with the sign-magnitude flip, so ordering is bit-identical
    regardless of how the values were produced."""
    bits = struct.unpack("<q", struct.pack("<d", x))[0]
    if bits < 0:
        bits ^= 0x7FFFFFFFFFFFFFFF
    return bits


def _quantile_sorted(sorted_vals: list[float], q: float) -> float:
    """Type-7 quantile: linear interpolation between order statistics."""
    if not sorted_vals:
        return math.nan
    h = q * (float(len(sorted_vals)) - 1.0)
    lo = int(math.floor(h))
    hi = int(math.ceil(h))
    return sorted_vals[lo] + (h - float(lo)) * (sorted_vals[hi] - sorted_vals[lo])


def percentiles(values: list[float]) -> dict:
    values.sort(key=_total_cmp_key)
    mean = (sum(values) / float(len(values))) if values else math.nan
    return {
        "p5": jnum(_quantile_sorted(values, 0.05)),
        "p25": jnum(_quantile_sorted(values, 0.25)),
        "p50": jnum(_quantile_sorted(values, 0.50)),
        "p75": jnum(_quantile_sorted(values, 0.75)),
        "p95": jnum(_quantile_sorted(values, 0.95)),
        "mean": jnum(mean),
    }


class Lcg:
    """Knuth MMIX LCG, wrapping mod 2^64. Seeded and deterministic on purpose:
    the same inputs must always give the same distribution, or a user cannot
    tell a strategy change from a reshuffle."""

    def __init__(self, state: int):
        self.state = state & _U64_MASK

    def next_index(self, n: int) -> int:
        self.state = (self.state * 6364136223846793005
                      + 1442695040888963407) & _U64_MASK
        return (self.state >> 33) % n     # the high bits are the good bits


def monte_carlo(trade_pnls: list[float], capital: float, runs: int,
                seed: int, base_net_profit: float) -> dict:
    """Bootstrap the closed-trade PnL sequence.

    Each path redraws len(trade_pnls) trades with replacement and replays them
    from `capital`, which answers the only question a single backtest cannot:
    how much of this result was the particular ORDER the trades arrived in.
    """
    if not trade_pnls:
        raise ValueError("no closed trades to resample")
    if any(not math.isfinite(p) for p in trade_pnls):
        # A NaN PnL means a trade closed on dirty data; resampling it poisons
        # every path, so refuse loudly rather than return a clean-looking lie.
        raise ValueError("trade PnLs contain non-finite values "
                         "(dirty bar data?); cannot resample")
    if int(runs) < 1:
        raise ValueError("runs must be >= 1")

    runs = int(runs)
    n = len(trade_pnls)
    rng = Lcg((int(seed) * 0x9E3779B97F4A7C15 + 1) & _U64_MASK)
    finals: list[float] = []
    dds: list[float] = []
    losses = ruins = 0

    for _ in range(runs):
        equity = peak = float(capital)
        max_dd_pct = 0.0
        ruined = False
        for _ in range(n):
            equity += trade_pnls[rng.next_index(n)]
            if equity <= 0.0:
                ruined = True          # touched zero at any point, not just at the end
            if equity > peak:
                peak = equity
            if peak > 0.0:
                dd = (peak - equity) / peak * 100.0
                if dd > max_dd_pct:
                    max_dd_pct = dd
        finals.append(equity)
        dds.append(max_dd_pct)
        if equity < capital:
            losses += 1
        if ruined:
            ruins += 1

    return {
        "type": "monte_carlo",
        "runs": runs,
        "seed": int(seed),
        "tradesPerPath": n,
        "baseNetProfit": jnum(base_net_profit),
        "finalEquity": percentiles(finals),
        "maxDrawdownPct": percentiles(dds),
        "probLoss": losses / float(runs),
        "riskOfRuin": ruins / float(runs),
    }


def _parse_f64(s: str) -> float:
    v = float(s)
    if not math.isfinite(v):
        raise ValueError(f"{s!r} is not a finite number")
    return v


def expand_param_spec(spec: str) -> list[float]:
    """"lo:hi:step" or "v1,v2,v3" -> concrete values."""
    spec = str(spec)
    if "," in spec:
        vals = []
        for p in spec.split(","):
            try:
                vals.append(_parse_f64(p.strip()))
            except ValueError:
                raise ValueError(f"bad param value '{p}'") from None
        if not vals:
            raise ValueError("empty param list")
        return vals

    parts = spec.split(":")
    if len(parts) == 1:
        # A single value pins that parameter while the others sweep. The
        # assistant's walk-forward calls kept sending {"mult": "3.0"} for
        # a knob it wanted held fixed and got the lo:hi:step error back;
        # one value is a valid one-point grid.
        try:
            return [_parse_f64(spec.strip())]
        except ValueError:
            raise ValueError(f"param spec '{spec}' must be lo:hi:step, "
                             "v1,v2,... or a single value") from None
    if len(parts) != 3:
        raise ValueError(f"param spec '{spec}' must be lo:hi:step or v1,v2,...")
    try:
        lo, hi, step = (_parse_f64(p.strip()) for p in parts)
    except ValueError:
        raise ValueError(f"param spec '{spec}' has a non-numeric part") from None
    if step <= 0.0 or hi < lo:
        raise ValueError(f"param spec '{spec}' needs step > 0 and hi >= lo")

    # Bound the count BEFORE materializing: a fat-fingered range like 0:1e9:1
    # must error rather than allocate gigabytes.
    count = math.floor((hi - lo) / step) + 1
    if count > 10_000:
        raise ValueError(f"param spec '{spec}' expands to {count} values; "
                         "cap is 10000")
    vals = []
    v = lo
    # The epsilon absorbs float accumulation so `hi` itself is always included.
    while v <= hi + step * 1e-9:
        vals.append(v)
        v += step
    return vals
