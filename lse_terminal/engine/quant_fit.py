"""Fit the quant models to the USER'S OWN data.

RESEARCH > QUANT MODELS used to be 18 parametric toys: pretty shapes with
sliders, disconnected from any market. This module turns each one into a desk
tool by estimating its parameters from a dataset the user picked, on the
user's own machine.

Three principles, because they are what make this honest rather than merely
impressive-looking:

1. ADAPT TO THEIR COLUMNS. A dataset here is either canonical OHLCV or a
   generic time+numbers table (providers/userdata.py). So the volatility
   estimator is chosen by what EXISTS: Garman-Klass when open/high/low/close
   are all there, Parkinson with high/low only, close-to-close otherwise. A
   generic table gets its value column picked by name, and every other
   numeric column is handed back so the user can override the guess.

2. ADAPT TO THEIR CLOCK. Nothing is annualised with a hardcoded 252. The
   bars-per-year factor is measured from the calendar span the data actually
   covers, so 1-minute crypto (24/7) and 30-minute equities (RTH only) both
   annualise correctly without being told which they are.

3. SAY WHAT IS NOT IDENTIFIABLE. A price series cannot tell you the option
   skew. Rather than invent one, the surface fitter degrades to the realized
   volatility TERM STRUCTURE (which prices genuinely do contain) and reports
   that it did. Every fit returns a `provenance` list naming the columns, the
   sample, the estimator and the caveats.

numpy + pandas only: those are the terminal's declared dependencies. scipy is
used when present (faster optimiser) and never required.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

# Fitting sample cap. The GARCH/Kalman/HMM recursions are sequential, so an
# unbounded 4M-row dataset would hang the request; the tail is also the regime
# the user cares about. Always reported in provenance, never silent.
MAX_FIT_BARS = 6000
SECONDS_PER_YEAR = 365.25 * 24 * 3600

# What each model needs. The UI uses this to offer the right datasets and to
# explain a model it cannot fit, instead of showing a dead button.
#   price     - one instrument's history (OHLCV or any numeric series)
#   universe  - two or more instruments (correlation, portfolio work)
#   options   - an option chain (strike + expiry/dte + implied vol)
#   curve     - a yield-curve table (columns like 1y, 2y, 10y)
#   none      - architecture illustration; training lives in ML Studio
REQUIREMENTS: dict[str, dict] = {
    "monte-carlo":         {"needs": "price", "label": "Monte Carlo (GBM)"},
    "diffusion":           {"needs": "price", "label": "Diffusion simulator"},
    "garch":               {"needs": "price", "label": "GARCH(1,1)"},
    "heston":              {"needs": "price", "label": "Heston stochastic vol"},
    "var-surface":         {"needs": "price", "label": "Value at Risk"},
    "kalman":              {"needs": "price", "label": "Kalman filter"},
    "hmm":                 {"needs": "price", "label": "Hidden Markov regimes"},
    "gaussian-process":    {"needs": "price", "label": "Gaussian process"},
    "black-scholes":       {"needs": "price", "label": "Black-Scholes"},
    "greeks-surface":      {"needs": "price", "label": "Option greeks"},
    "volatility-surface":  {"needs": "options", "degrades": "price",
                            "label": "Implied vol surface"},
    "correlation-surface": {"needs": "universe", "label": "Correlation matrix"},
    "pca":                 {"needs": "universe", "label": "Principal component analysis"},
    "efficient-frontier":  {"needs": "universe", "label": "Efficient frontier"},
    "term-structure":      {"needs": "curve", "label": "Term structure"},
    "neural-network":      {"needs": "none", "label": "Neural network"},
    "xgboost":             {"needs": "none", "label": "XGBoost"},
    "lstm":                {"needs": "none", "label": "LSTM"},
    "tcn":                 {"needs": "none", "label": "Temporal ConvNet"},
    "attention":           {"needs": "none", "label": "Transformer attention"},
}

# Column-name guesses, best first. The importer already lowercases them.
VALUE_NAMES = ("close", "price", "last", "px", "value", "adj_close", "nav",
               "settle", "mid")
IV_NAMES = ("iv", "implied_vol", "implied_volatility", "impliedvol", "sigma")
STRIKE_NAMES = ("strike", "strike_price", "k")
DTE_NAMES = ("dte", "days_to_expiry", "tau", "t", "expiry_years",
             "years_to_expiry", "time_to_expiry", "maturity")
TIME_NAMES = ("ts", "time", "timestamp", "date", "datetime", "quote_date",
              "trade_date", "dt", "day", "period")


# What "the right shape" concretely means per requirement, shown by the UI
# BEFORE fitting (a mismatched dataset used to produce a garbage chart with
# no hint of what the model expected). Built from the same
# name tuples the loaders actually match on, so the hint cannot drift from
# what the code accepts.
FORMATS: dict[str, dict] = {
    "price": {
        "summary": "one instrument's history, one row per bar",
        "columns": [
            "time: one of " + ", ".join(TIME_NAMES[:6]) + " (ISO date or unix)",
            "price: one of " + ", ".join(VALUE_NAMES)
            + " (anything else: pick it under COLUMN)",
            "optional: open + high + low columns switch to a sharper "
            "range-based vol estimator",
        ],
        "example": "ts,open,high,low,close,volume\n"
                   "2026-01-02 09:00,1.1012,1.1019,1.1008,1.1015,4120",
    },
    "universe": {
        "summary": "two or more price datasets with overlapping history",
        "columns": [
            "each dataset: a time column and a price column, exactly like a "
            "single-instrument fit",
        ],
        "example": "",
    },
    "options": {
        "summary": "an option chain, one row per contract",
        "columns": [
            "strike: one of " + ", ".join(STRIKE_NAMES),
            "expiry: one of " + ", ".join(DTE_NAMES),
            "implied vol: one of " + ", ".join(IV_NAMES),
        ],
        "example": "strike,dte,iv\n95,30,0.212",
    },
    "curve": {
        "summary": "a yield-curve table; the most recent complete row is fitted",
        "columns": [
            "a time column plus at least 4 maturity columns named like "
            "1y, 2y, 10y, 30y or m3, m6",
        ],
        "example": "date,1y,2y,5y,10y,30y\n2026-01-02,4.61,4.38,4.12,4.21,4.45",
    },
}


class FitError(Exception):
    """Something about the data prevents an honest fit."""


def _num(frame: pd.DataFrame, col: str) -> np.ndarray:
    return pd.to_numeric(frame[col], errors="coerce").to_numpy(dtype=float)


def _tf_label(dt_seconds: float) -> str:
    if dt_seconds <= 0:
        return "irregular"
    for secs, name in ((1, "1s"), (60, "1m"), (300, "5m"), (900, "15m"),
                       (1800, "30m"), (3600, "1h"), (14400, "4h"),
                       (86400, "1d"), (604800, "1w")):
        if abs(dt_seconds - secs) <= max(1.0, secs * 0.2):
            return name
    if dt_seconds >= 86400 * 25:
        return "1M"
    return f"{int(dt_seconds)}s"


def measure_clock(ts: np.ndarray, n: int) -> tuple[float, str]:
    """Annualisation factor from the calendar time the data really spans.

    This is the point of not hardcoding 252: a 30-minute equity series trades
    ~13 bars a day for ~252 days (~3,300/yr) while 30-minute crypto runs 48
    bars every day of the year (~17,500/yr). Measuring it removes the guess
    and handles half-days, holidays and gaps for free.
    """
    if n < 3:
        raise FitError("need at least 3 rows to work out the sampling rate")
    span = float(ts[-1] - ts[0])
    if span <= 0:
        raise FitError("timestamps do not increase; is the time column right?")
    bpy = (n - 1) / (span / SECONDS_PER_YEAR)
    return bpy, _tf_label(float(np.median(np.diff(ts))))


def normalize_time(df: pd.DataFrame) -> pd.DataFrame:
    """Give any table a `ts` column in EPOCH SECONDS.

    Needed because the terminal itself stores its two dataset kinds
    differently: an imported OHLCV file lands as `ts` in seconds, while a
    generic series file lands as `time` in MILLISECONDS. A fitter that assumed
    one of them silently rejected half the user's own library (caught in
    testing on a close-only import). Strings are parsed as dates, so a raw CSV
    read from anywhere else also works.
    """
    lower = {str(c).lower(): c for c in df.columns}
    col = next((lower[n] for n in TIME_NAMES if n in lower), None)
    if col is None:
        raise FitError(
            "no time column found (looked for "
            + ", ".join(TIME_NAMES[:5]) + "). Columns present: "
            + ", ".join(str(c) for c in df.columns))
    out = df.copy()
    t = out[col]
    if pd.api.types.is_numeric_dtype(t):
        ts = pd.to_numeric(t, errors="coerce")
        ts = ts.where(ts < 1e11, ts / 1000.0)          # ms -> s
    else:
        parsed = pd.to_datetime(t, errors="coerce", utc=True)
        ts = (parsed - pd.Timestamp(0, tz="UTC")).dt.total_seconds()
    out = out.drop(columns=[c for c in out.columns if c == col])
    out.insert(0, "ts", ts)
    out = out.dropna(subset=["ts"]).sort_values("ts")
    if out.empty:
        raise FitError("no rows with a readable timestamp")
    return out.reset_index(drop=True)


class PriceCtx:
    """One instrument, prepared: the series, its returns, its clock, and an
    honest record of which columns produced them."""

    def __init__(self, df: pd.DataFrame, symbol: str, column: str | None = None):
        df = normalize_time(df) if "ts" not in df.columns else df
        self.symbol = symbol
        self.provenance: list[str] = []
        self.value_cols = [c for c in df.columns
                           if c != "ts" and pd.api.types.is_numeric_dtype(df[c])]
        if not self.value_cols:
            raise FitError("no numeric columns to model")

        # Which column IS the price? An explicit pick wins; else the best
        # known name; else the first numeric column, and say so.
        if column and column in self.value_cols:
            price_col, why = column, "column chosen by you"
        else:
            price_col = next((c for c in VALUE_NAMES if c in self.value_cols), None)
            why = "matched a known price column name"
            if price_col is None:
                price_col = self.value_cols[0]
                why = ("first numeric column: no close/price/value column found, "
                       "override it if that is wrong")
        self.price_col = price_col

        frame = df.dropna(subset=["ts", price_col])
        n_all = len(frame)
        if n_all < 30:
            raise FitError(f"only {n_all} usable rows; need at least 30")

        # Sanity-check the chosen column BEFORE fitting: a wrong pick used to
        # sail through and come out the other end as a garbage chart with no
        # hint why (easy to hit with a random import). A column
        # that never moves, or that steps by exactly the same amount every
        # row (a row counter or id), is not a price; refuse with the way out.
        vals = _num(frame, price_col)
        others = [c for c in self.value_cols if c != price_col]
        hint = (" Pick the price column under COLUMN (also present: "
                + ", ".join(others[:8]) + ")." if others else "")
        if float(np.nanstd(vals)) == 0.0:
            raise FitError(
                f"column {price_col!r} has the same value in every row; "
                f"there is nothing to model.{hint}")
        dv = np.diff(vals)
        if len(dv) > 10 and float(np.nanstd(dv)) == 0.0:
            raise FitError(
                f"column {price_col!r} changes by exactly {dv[0]:g} every "
                f"row, which is a counter or id, not a price.{hint}")
        self.total_rows = n_all
        self.bars_per_year, self.timeframe = measure_clock(
            frame["ts"].to_numpy(dtype=float), n_all)

        if n_all > MAX_FIT_BARS:
            frame = frame.iloc[-MAX_FIT_BARS:]
            self.provenance.append(
                f"fitted on the last {MAX_FIT_BARS:,} of {n_all:,} rows")
        else:
            self.provenance.append(f"fitted on all {n_all:,} rows")

        self.ts = frame["ts"].to_numpy(dtype=float)
        self.close = _num(frame, price_col)
        self.high = _num(frame, "high") if "high" in frame.columns else None
        self.low = _num(frame, "low") if "low" in frame.columns else None
        self.open_ = _num(frame, "open") if "open" in frame.columns else None
        self.volume = _num(frame, "volume") if "volume" in frame.columns else None
        self.has_ohlc = (self.high is not None and self.low is not None
                         and self.open_ is not None)

        if (self.close <= 0).any():
            # Log returns need positive levels; a spread or a rate can legally
            # be negative, so difference it rather than refuse to work.
            self.returns = np.diff(self.close)
            self.return_kind = "differences (series is not strictly positive)"
        else:
            self.returns = np.diff(np.log(self.close))
            self.return_kind = "log returns"
        self.returns = self.returns[np.isfinite(self.returns)]
        if len(self.returns) < 20:
            raise FitError("not enough finite returns to fit anything")

        self.provenance.append(
            f"{price_col} column ({why}); {self.timeframe} bars, "
            f"{self.bars_per_year:,.0f} bars/year measured from the data's own "
            f"date range")
        self.provenance.append(f"volatility from {self.vol_estimator}")

        # Extreme-jump flag. A single monster return (a weekend gap, a
        # contract roll, two series glued together) dominates every
        # vol-family estimate and shows up as one absurd spike in the fitted
        # chart; without this line the user has no way to know the spike is
        # the DATA, not the model.
        sd = float(np.std(self.returns))
        if sd > 0:
            big = np.abs(self.returns) > 10 * sd
            if big.any():
                self.provenance.append(
                    f"WARNING: {int(big.sum())} extreme bar(s), largest "
                    f"{float(np.max(np.abs(self.returns))):+.1%} vs a typical "
                    f"{sd:.2%}; gaps, rolls or joined series will dominate "
                    f"any volatility estimate")

    @property
    def vol_estimator(self) -> str:
        if self.has_ohlc:
            return "Garman-Klass (open/high/low/close present)"
        if self.high is not None and self.low is not None:
            return "Parkinson (high/low present)"
        return f"close-to-close {self.return_kind}"

    def bar_variance(self) -> np.ndarray:
        """Per-bar variance estimates, the sharpest the columns support."""
        if self.has_ohlc:
            hl = np.log(self.high / self.low) ** 2
            co = np.log(self.close / self.open_) ** 2
            return np.clip(0.5 * hl - (2 * math.log(2) - 1) * co, 1e-16, None)
        if self.high is not None and self.low is not None:
            hl = np.log(self.high / self.low) ** 2
            return np.clip(hl / (4 * math.log(2)), 1e-16, None)
        r = self.returns
        return np.clip(np.concatenate(([r[0] ** 2], r ** 2)), 1e-16, None)

    def annual_vol(self) -> float:
        if self.high is not None and self.low is not None:
            per_bar = float(np.sqrt(np.mean(self.bar_variance())))
        else:
            per_bar = float(np.std(self.returns, ddof=1))
        return per_bar * math.sqrt(self.bars_per_year)

    def annual_drift(self) -> float:
        return float(np.mean(self.returns)) * self.bars_per_year

    def drift_tstat(self) -> float:
        """t-statistic of the mean return. Annualising a short sample's drift
        produces headline nonsense (-195%/yr on 50 days of data), so every
        consumer of annual_drift() must check this first: below |2| the drift
        is indistinguishable from zero and should not be projected forward."""
        r = self.returns
        sd = float(np.std(r, ddof=1))
        if sd <= 0:
            return 0.0
        return float(np.mean(r) / (sd / math.sqrt(len(r))))

    def block_variance(self) -> tuple[np.ndarray, float]:
        """Annualised variance aggregated to ~daily blocks, with the resulting
        blocks-per-year. Per-BAR realized variance is mostly measurement noise
        at intraday frequencies, which drives any mean-reversion fit to
        nonsense (kappa of 342/yr on gold). Aggregating first is what makes
        the variance dynamics estimable, and it is what desks actually do."""
        v_bar = self.bar_variance() * self.bars_per_year
        block = max(1, int(round(self.bars_per_year / 252)))
        if block > 1 and len(v_bar) >= block * 20:
            n_blocks = len(v_bar) // block
            v = v_bar[:n_blocks * block].reshape(n_blocks, block).mean(axis=1)
            return v, self.bars_per_year / block
        return v_bar, self.bars_per_year

    def dates(self) -> list[str]:
        return [pd.Timestamp(int(t), unit="s").strftime("%Y-%m-%d")
                for t in self.ts]


# ---------------------------------------------------------------------------
# estimators (numpy only; scipy used opportunistically)
# ---------------------------------------------------------------------------

def _garch_nll(params, r: np.ndarray) -> float:
    omega, alpha, beta = params
    if omega <= 0 or alpha < 0 or beta < 0 or alpha + beta >= 0.999:
        return 1e12
    n = len(r)
    var = np.empty(n)
    var[0] = float(np.var(r))
    r2 = r ** 2
    for t in range(1, n):
        var[t] = omega + alpha * r2[t - 1] + beta * var[t - 1]
        if var[t] <= 0:
            return 1e12
    return float(0.5 * np.sum(np.log(var) + r2 / var))


def fit_garch(r: np.ndarray) -> tuple[float, float, float]:
    """GARCH(1,1) by maximum likelihood: scipy when available, else a coarse
    grid with omega profiled out through the unconditional variance plus two
    local refinements. Both land in the same place on real series."""
    uncond = float(np.var(r))
    best = (uncond * 0.05, 0.08, 0.90)
    try:
        from scipy.optimize import minimize
        res = minimize(_garch_nll, np.array(best), args=(r,),
                       method="Nelder-Mead",
                       options={"maxiter": 800, "fatol": 1e-6})
        o, a, b = (float(x) for x in res.x)
        if np.isfinite(res.fun) and o > 0 and a >= 0 and b >= 0 and a + b < 0.999:
            return o, a, b
    except Exception:
        pass  # no scipy (or it failed): the grid below is the honest fallback
    alphas = np.linspace(0.01, 0.30, 12)
    betas = np.linspace(0.50, 0.98, 12)
    bestv = 1e18
    for _ in range(3):
        for a in alphas:
            for b in betas:
                if a + b >= 0.999:
                    continue
                o = max(uncond * (1 - a - b), 1e-14)
                v = _garch_nll((o, a, b), r)
                if v < bestv:
                    bestv, best = v, (o, a, b)
        _, a0, b0 = best
        alphas = np.linspace(max(1e-4, a0 * 0.6), min(0.6, a0 * 1.4), 9)
        betas = np.linspace(max(0.1, b0 * 0.92), min(0.995, b0 * 1.05), 9)
    return best


def garch_variance(r: np.ndarray, omega: float, alpha: float,
                   beta: float) -> np.ndarray:
    n = len(r)
    var = np.empty(n)
    var[0] = float(np.var(r))
    for t in range(1, n):
        var[t] = omega + alpha * r[t - 1] ** 2 + beta * var[t - 1]
    return var


def fit_kalman(y: np.ndarray):
    """Local-level model (random walk plus noise): choose the process /
    observation noise ratio by likelihood on a log grid, then return the
    filtered state and its variance. One free ratio keeps it robust; the
    absolute scale comes from the data's own variance."""
    dy_var = float(np.var(np.diff(y))) or 1e-12
    best_nll, best_ratio = 1e18, 1.0
    # Wide grid: a liquid price at intraday frequency IS close to a random
    # walk, so the likelihood wants almost no smoothing and a narrower grid
    # (logspace(-4, 1.5)) pinned the answer at its own top edge on gold.
    RATIOS = np.logspace(-5, 3, 45)
    for ratio in RATIOS:
        q = dy_var * ratio / (1 + ratio)
        rr = dy_var / (1 + ratio)
        nll, x, p, ok = 0.0, y[0], dy_var, True
        for t in range(1, len(y)):
            p += q
            f = p + rr
            if f <= 0:
                ok = False
                break
            v = y[t] - x
            nll += 0.5 * (math.log(f) + v * v / f)
            k = p / f
            x += k * v
            p *= (1 - k)
        if ok and nll < best_nll:
            best_nll, best_ratio = nll, ratio
    at_edge = bool(best_ratio <= RATIOS[0] * 1.01 or best_ratio >= RATIOS[-1] * 0.99)
    q = dy_var * best_ratio / (1 + best_ratio)
    rr = dy_var / (1 + best_ratio)
    n = len(y)
    xs, ps = np.empty(n), np.empty(n)
    x, p = y[0], dy_var
    for t in range(n):
        if t:
            p += q
            k = p / (p + rr)
            x += k * (y[t] - x)
            p *= (1 - k)
        xs[t], ps[t] = x, p
    return q, rr, xs, ps, at_edge


def fit_hmm2(r: np.ndarray, iters: int = 60) -> dict:
    """Two-state Gaussian HMM by Baum-Welch (scaled forward-backward).

    Two states because that is what a return series actually supports:
    calm and turbulent. More states fit the noise and stop being readable.
    """
    n = len(r)
    lo, hi = np.percentile(np.abs(r), [40, 90])
    mu = np.array([float(np.mean(r))] * 2)
    sd = np.array([max(float(lo), 1e-8), max(float(hi), 2e-8)])
    A = np.array([[0.95, 0.05], [0.10, 0.90]])
    pi = np.array([0.5, 0.5])
    g = np.full((n, 2), 0.5)
    for _ in range(iters):
        B = np.empty((n, 2))
        for k in range(2):
            B[:, k] = np.exp(-0.5 * ((r - mu[k]) / sd[k]) ** 2) / (
                sd[k] * math.sqrt(2 * math.pi))
        B = np.clip(B, 1e-300, None)
        alpha = np.zeros((n, 2))
        c = np.zeros(n)
        alpha[0] = pi * B[0]
        c[0] = max(alpha[0].sum(), 1e-300)
        alpha[0] /= c[0]
        for t in range(1, n):
            alpha[t] = (alpha[t - 1] @ A) * B[t]
            c[t] = max(alpha[t].sum(), 1e-300)
            alpha[t] /= c[t]
        beta = np.zeros((n, 2))
        beta[-1] = 1.0
        for t in range(n - 2, -1, -1):
            beta[t] = A @ (B[t + 1] * beta[t + 1])
            beta[t] /= c[t + 1]
        g = alpha * beta
        g /= np.clip(g.sum(axis=1, keepdims=True), 1e-300, None)
        xi = np.zeros((2, 2))
        for t in range(n - 1):
            m = (alpha[t][:, None] * A) * (B[t + 1] * beta[t + 1])[None, :]
            s = m.sum()
            if s > 0:
                xi += m / s
        A = xi / np.clip(xi.sum(axis=1, keepdims=True), 1e-300, None)
        w = g.sum(axis=0)
        mu = (g * r[:, None]).sum(axis=0) / np.clip(w, 1e-300, None)
        sd = np.sqrt(np.clip((g * (r[:, None] - mu) ** 2).sum(axis=0)
                             / np.clip(w, 1e-300, None), 1e-16, None))
        pi = g[0]
    order = np.argsort(sd)          # state 0 = calm, state 1 = turbulent
    return {"mu": mu[order], "sd": sd[order], "A": A[np.ix_(order, order)],
            "prob_turbulent": g[:, order[1]]}


def gp_posterior(x, y, xs, length, sigma_f, sigma_n):
    """Exact GP posterior with an RBF kernel, via Cholesky."""
    def k(a, b):
        d = (a[:, None] - b[None, :]) / length
        return sigma_f ** 2 * np.exp(-0.5 * d ** 2)
    K = k(x, x) + (sigma_n ** 2) * np.eye(len(x))
    L = np.linalg.cholesky(K)
    a = np.linalg.solve(L.T, np.linalg.solve(L, y))
    Ks = k(x, xs)
    v = np.linalg.solve(L, Ks)
    var = np.clip(sigma_f ** 2 - np.sum(v * v, axis=0), 0, None)
    return Ks.T @ a, np.sqrt(var)


def norm_cdf(x):
    return 0.5 * (1.0 + np.vectorize(math.erf)(
        np.asarray(x, dtype=float) / math.sqrt(2.0)))


def norm_pdf(x):
    x = np.asarray(x, dtype=float)
    return np.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


# ---------------------------------------------------------------------------
# the fitters: each returns {model, params, provenance}
#
# `model` is the dict shape ModelView (frontend ModelLab.tsx) renders
# (kind/x/y/z/series + labels + notes), so every fitter draws through the
# one renderer instead of shipping a component per model.
# ---------------------------------------------------------------------------

def _pack(model: dict, params: dict, prov: list[str]) -> dict:
    return {"ok": True, "model": model, "params": params, "provenance": prov}


def fit_monte_carlo(ctx: PriceCtx, opts: dict) -> dict:
    raw_mu, sigma = ctx.annual_drift(), ctx.annual_vol()
    t = ctx.drift_tstat()
    # Drift is the one parameter a short sample cannot pin down: annualising
    # 50 days of downtrend gave -195%/yr, which as a forward projection is
    # noise dressed as a forecast. If the mean is not significant, project
    # zero drift and say why. The user can force it back on.
    mode = str(opts.get("drift", "auto")).lower()
    if mode == "fitted" or (mode == "auto" and abs(t) >= 2.0):
        mu, drift_note = raw_mu, f"drift {raw_mu:+.1%}/yr (fitted, t={t:+.1f})"
    elif mode == "zero":
        mu, drift_note = 0.0, "drift set to zero (your choice)"
    else:
        mu = 0.0
        drift_note = (f"drift set to ZERO: the sample mean annualises to "
                      f"{raw_mu:+.1%}/yr but t={t:+.1f}, so it is "
                      f"indistinguishable from noise")
    paths = int(opts.get("paths", 60))
    steps = int(min(max(ctx.bars_per_year, 50), 504))
    dt = 1.0 / steps
    rng = np.random.default_rng(int(opts.get("seed", 7)))
    z = rng.standard_normal((paths, steps))
    inc = (mu - 0.5 * sigma ** 2) * dt + sigma * math.sqrt(dt) * z
    tracks = ctx.close[-1] * np.exp(np.cumsum(inc, axis=1))
    tracks = np.concatenate([np.full((paths, 1), ctx.close[-1]), tracks], axis=1)
    finals = tracks[:, -1]
    return _pack(
        {"kind": "lines",
         "title": f"{ctx.symbol}: Monte Carlo at fitted volatility",
         "x": list(range(steps + 1)),
         "series": [{"name": f"path {i+1}", "y": tracks[i].tolist()}
                    for i in range(paths)],
         "x_label": "Bars ahead (one year)", "y_label": "Price",
         "notes": [drift_note, f"volatility {sigma:.1%}/yr (fitted)",
                   f"median in 1y {np.median(finals):,.2f}",
                   f"5-95% {np.percentile(finals, 5):,.2f} to "
                   f"{np.percentile(finals, 95):,.2f}",
                   f"P(below today's price) "
                   f"{float(np.mean(finals < ctx.close[-1])):.0%}"]},
        {"drift": mu, "drift_fitted": raw_mu, "drift_tstat": t,
         "volatility": sigma, "spot": float(ctx.close[-1])},
        ctx.provenance + [f"{paths} paths simulated one year forward "
                          f"({steps} steps at this timeframe)"])


# Payload cap for the diffusion training set. The windows are shipped to the
# browser (the sampler runs there, one denoise step per animation frame), so
# this is a wire-size and per-step-cost budget, not a statistical one: 1500
# windows x 64 bars is ~700 KB of JSON and ~15M multiply-adds per step, which
# holds 60fps. Always reported in provenance, never silent.
MAX_DIFFUSION_WINDOWS = 1500


def _acf(x: np.ndarray, lag: int) -> float:
    """Autocorrelation at one lag. Returns 0.0 rather than nan on a constant
    series, because this feeds a scorecard the user reads, not a test."""
    if lag >= len(x):
        return 0.0
    a, b = x[:-lag], x[lag:]
    sa, sb = float(np.std(a)), float(np.std(b))
    if sa <= 0 or sb <= 0:
        return 0.0
    return float(np.mean((a - np.mean(a)) * (b - np.mean(b))) / (sa * sb))


def fit_diffusion(ctx: PriceCtx, opts: dict) -> dict:
    """Denoising diffusion over the user's own return paths.

    A diffusion model is trained to invert a known noising process: it learns
    the score of the data distribution at every noise level. What we ship as
    "the model" is the CLOSED-FORM OPTIMAL DENOISER for this dataset, i.e. the
    posterior mean E[x0 | xt] under the empirical distribution of the user's
    windows. That is not a shortcut around training: it is the exact quantity
    a trained network approximates, and stating it lets us be honest about the
    known consequence (at low noise it reproduces training windows, which the
    UI measures with a nearest-window meter) instead of claiming a network was
    trained in 200ms.

    The sampling itself runs in the browser, so what this returns is the
    training set plus the empirical facts the samples are scored against. No
    parameters are estimated by search here; the data IS the model.
    """
    r = np.asarray(ctx.returns, dtype=float)
    if len(r) < 40:
        raise FitError(f"only {len(r)} returns; a diffusion model needs at "
                       "least 40 to have anything to denoise towards")

    # Horizon is what one sample IS (a path of this many bars). Capped by the
    # data: a 64-bar window out of 80 returns would give ~16 near-identical
    # windows and a model that can only reproduce them.
    horizon = int(opts.get("horizon", 64))
    horizon = max(8, min(horizon, 128, len(r) // 4))

    # Drift doctrine, same as Monte Carlo: an insignificant sample mean
    # annualises into a headline forecast that is pure noise. Here it would
    # also be baked into every generated path, so it is removed unless the
    # data actually supports it.
    t = ctx.drift_tstat()
    mode = str(opts.get("drift", "auto")).lower()
    keep_drift = (mode == "keep") or (mode == "auto" and abs(t) >= 2.0)
    if keep_drift:
        drift_note = (f"windows keep the sample's own drift "
                      f"({float(np.mean(r)) * ctx.bars_per_year:+.1%}/yr, "
                      f"t={t:+.1f})")
    else:
        r = r - float(np.mean(r))
        drift_note = (f"windows de-meaned: the sample drift has t={t:+.1f}, "
                      f"so projecting it forward would be noise dressed as a "
                      f"forecast" if mode == "auto" else
                      "windows de-meaned (your choice)")

    sigma_bar = float(np.std(r))
    if sigma_bar <= 0:
        raise FitError("this series never moves; there is no distribution to "
                       "learn")

    # Overlapping windows, cumulated into paths and expressed in units of one
    # bar's standard deviation. Scale-free windows keep the browser sampler's
    # noise schedule identical for gold, bitcoin and a rate series; the price
    # axis is rebuilt from last_price and sigma at render time.
    starts = np.arange(0, len(r) - horizon + 1)
    stride = max(1, int(math.ceil(len(starts) / MAX_DIFFUSION_WINDOWS)))
    starts = starts[::stride]
    idx = starts[:, None] + np.arange(horizon)[None, :]
    windows = np.cumsum(r[idx], axis=1) / sigma_bar

    abs_r = np.abs(r)
    stats = {
        # Excess kurtosis and the two autocorrelations ARE the stylised facts
        # a generative market model is judged on: fat tails, no return
        # predictability, persistent volatility.
        "kurtosis": float(np.mean((r - r.mean()) ** 4) / sigma_bar ** 4 - 3.0),
        "skew": float(np.mean((r - r.mean()) ** 3) / sigma_bar ** 3),
        "acf_return": _acf(r, 1),
        "acf_abs": [_acf(abs_r, k) for k in range(1, 6)],
        "vol_annual": ctx.annual_vol(),
        "var99": float(np.percentile(r, 1)),
        "sigma_bar": sigma_bar,
    }

    return {
        "ok": True,
        # No server-rendered chart: this model owns its renderer (the sampler
        # is an animation, not a static figure), so a duplicate static model
        # dict would be payload nobody draws.
        "model": None,
        "params": {
            "windows": np.round(windows, 4).tolist(),
            "horizon": horizon,
            "n_windows": int(len(windows)),
            "stride": int(stride),
            "sigma_bar": sigma_bar,
            "last_price": float(ctx.close[-1]),
            # The recent history the fan is drawn continuing from: generated
            # paths joined to the actual series read as a forecast, which is
            # what they are, instead of as an abstract cloud around zero.
            "tail": [float(v) for v in ctx.close[-min(len(ctx.close), 180):]],
            "bars_per_year": ctx.bars_per_year,
            "timeframe": ctx.timeframe,
            "log_returns": ctx.return_kind.startswith("log"),
            "symbol": ctx.symbol,
            "stats": stats,
        },
        "provenance": ctx.provenance + [
            f"{len(windows):,} overlapping {horizon}-bar windows"
            + (f" (every {stride} bars)" if stride > 1 else "")
            + " are the training set",
            drift_note,
            "denoiser: closed-form posterior mean over those windows, the "
            "optimum a trained network approximates. At low noise it "
            "reproduces training windows; the memorisation meter measures "
            "how close each sample lands.",
        ],
    }


def fit_garch_model(ctx: PriceCtx, opts: dict) -> dict:
    r = ctx.returns - float(np.mean(ctx.returns))
    omega, alpha, beta = fit_garch(r)
    var = garch_variance(r, omega, alpha, beta)
    ann = np.sqrt(var * ctx.bars_per_year) * 100.0
    persistence = alpha + beta
    half_life = (math.log(0.5) / math.log(persistence)
                 if 0 < persistence < 1 else float("inf"))
    uncond = (math.sqrt(omega / (1 - persistence) * ctx.bars_per_year) * 100
              if persistence < 1 else float("nan"))
    # The overlay is realised |return| in the SAME %/yr units, the classic
    # GARCH diagnostic (the vol line should trace the envelope of the return
    # spikes). It used to be the raw price on the shared axis, which squashed
    # a 1.14 price against a 100%/yr vol spike into an unreadable flat line.
    realised = np.sqrt(r ** 2 * ctx.bars_per_year) * 100.0
    notes = [f"alpha {alpha:.3f} (shock reaction)",
             f"beta {beta:.3f} (memory)",
             f"persistence {persistence:.3f}",
             f"half-life {half_life:,.1f} bars",
             f"unconditional vol {uncond:.1f}%/yr",
             f"current vol {ann[-1]:.1f}%/yr"]
    if beta < 0.05 or alpha < 0.005:
        # A degenerate fit is an ANSWER about the data, not a result to
        # present as if the model worked: say it, or the parameter block
        # reads as authoritative nonsense (beta 0.000 shipped silently once;
        # iid noise degenerates the other way, alpha 0.000).
        what = ("no volatility memory (beta ~0)" if beta < 0.05
                else "no shock response (alpha ~0)")
        notes.append(f"{what}: the MLE could not find real GARCH dynamics "
                     "in this series, so the numbers above are a degenerate "
                     "fit; treat them as evidence about the data, not a "
                     "forecast")
    return _pack(
        {"kind": "lines",
         "title": f"{ctx.symbol}: GARCH(1,1) fitted by maximum likelihood",
         "x": list(range(len(ann))),
         "series": [{"name": "conditional vol %/yr", "y": ann.tolist()},
                    {"name": "realised |return| %/yr", "y": realised.tolist()}],
         "x_label": "Bar", "y_label": "% per year",
         "notes": notes},
        {"omega": omega, "alpha": alpha, "beta": beta,
         "persistence": persistence},
        ctx.provenance + ["parameters are MLE on de-meaned returns"])


def fit_heston_model(ctx: PriceCtx, opts: dict) -> dict:
    """CIR variance parameters by the standard OLS discretisation, so the
    numbers come from this instrument rather than from a slider."""
    # Fit on ~daily aggregated realized variance, not per-bar: see
    # PriceCtx.block_variance for why (per-bar variance is mostly measurement
    # noise, which pushed kappa to 342/yr on real gold data).
    v, blocks_per_year = ctx.block_variance()
    dt = 1.0 / blocks_per_year
    v = np.clip(v, 1e-12, None)
    v0, v1 = v[:-1], v[1:]
    # (v1-v0)/sqrt(v0) = kappa*theta*dt/sqrt(v0) - kappa*sqrt(v0)*dt + xi*sqrt(dt)*z
    y = (v1 - v0) / np.sqrt(v0)
    X = np.column_stack([dt / np.sqrt(v0), -np.sqrt(v0) * dt])
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    kappa_raw = float(coef[1])
    kappa = float(min(max(kappa_raw, 0.05), 60.0))
    theta = float(np.clip(coef[0] / kappa if kappa > 0 else np.mean(v),
                          1e-8, 25.0))
    resid = y - X @ coef
    xi = float(np.std(resid, ddof=2) / math.sqrt(dt))
    # Leverage effect at the SAME horizon as the variance series, so the two
    # sides of the correlation are measured on the same clock.
    block = max(1, int(round(ctx.bars_per_year / 252)))
    r_blocks = (ctx.returns[:len(v) * block].reshape(-1, block).sum(axis=1)
                if block > 1 and len(ctx.returns) >= len(v) * block
                else ctx.returns[:len(v)])
    n = min(len(r_blocks), len(v) - 1)
    rho = float(np.corrcoef(r_blocks[:n], np.diff(v)[:n])[0, 1]) if n > 5 else 0.0
    if not np.isfinite(rho):
        rho = 0.0
    clamp_note = ([] if abs(kappa - kappa_raw) < 1e-9 else
                  [f"kappa clamped from {kappa_raw:.1f} to {kappa:.1f}: the "
                   f"variance series is too noisy to pin it down"])

    steps = int(min(max(ctx.bars_per_year, 50), 504))
    paths = int(opts.get("paths", 40))
    sdt = 1.0 / steps
    rng = np.random.default_rng(int(opts.get("seed", 7)))
    z1 = rng.standard_normal((paths, steps))
    z2 = rho * z1 + math.sqrt(max(1 - rho ** 2, 0)) * rng.standard_normal((paths, steps))
    s = np.full(paths, float(ctx.close[-1]))
    vv = np.full(paths, float(v[-1]))
    tracks = np.zeros((paths, steps + 1))
    tracks[:, 0] = s
    for t in range(steps):
        vv = np.maximum(vv + kappa * (theta - vv) * sdt
                        + xi * np.sqrt(np.maximum(vv, 0) * sdt) * z2[:, t], 0)
        s = s * np.exp(-0.5 * vv * sdt + np.sqrt(vv * sdt) * z1[:, t])
        tracks[:, t + 1] = s
    feller = 2 * kappa * theta - xi ** 2
    return _pack(
        {"kind": "lines",
         "title": f"{ctx.symbol}: Heston paths from fitted variance dynamics",
         "x": list(range(steps + 1)),
         "series": [{"name": f"path {i+1}", "y": tracks[i].tolist()}
                    for i in range(paths)],
         "x_label": "Bars ahead (one year)", "y_label": "Price",
         "notes": [f"kappa {kappa:.2f}/yr (variance mean reversion, "
                   f"half-life {math.log(2) / kappa * 252:.0f} days)",
                   f"theta {theta:.4f} = {math.sqrt(max(theta,0)):.1%} long-run vol",
                   f"xi {xi:.2f} (vol of vol)",
                   f"rho {rho:+.2f} (leverage effect: "
                   f"{'vol rises as price falls' if rho < 0 else 'vol rises with price'})",
                   f"current vol {math.sqrt(max(v[-1],0)):.1%}",
                   ("Feller satisfied" if feller > 0
                    else "Feller violated: variance can reach zero")] + clamp_note},
        {"kappa": kappa, "theta": theta, "xi": xi, "rho": rho,
         "v0": float(v[-1])},
        ctx.provenance + [
            f"CIR parameters by OLS on realised variance aggregated to "
            f"{blocks_per_year:,.0f} blocks/year (~daily), not per-bar",
            "rho is corr(block return, block variance change)"] + clamp_note)


def fit_var(ctx: PriceCtx, opts: dict) -> dict:
    r = ctx.returns
    pct = r * 100.0
    lo, hi = np.percentile(pct, [0.2, 99.8])
    bins = np.linspace(lo, hi, 61)
    counts, edges = np.histogram(np.clip(pct, lo, hi), bins=bins)
    centres = ((edges[:-1] + edges[1:]) / 2).tolist()
    out = {}
    for c in (95.0, 99.0):
        q = float(np.percentile(pct, 100 - c))
        tail = pct[pct <= q]
        out[c] = (q, float(tail.mean()) if len(tail) else q)
    mu, sd = float(np.mean(pct)), float(np.std(pct, ddof=1))
    z95, z99 = -1.6448536, -2.3263479
    skew = float(np.mean(((pct - mu) / sd) ** 3))
    kurt = float(np.mean(((pct - mu) / sd) ** 4) - 3)
    return _pack(
        {"kind": "bars",
         "title": f"{ctx.symbol}: return distribution and Value at Risk",
         "x": centres,
         "series": [{"name": f"{ctx.timeframe} return frequency",
                     "y": counts.tolist()}],
         "x_label": f"{ctx.timeframe} return %", "y_label": "Observations",
         "notes": [f"historical VaR 95% {out[95.0][0]:.2f}%",
                   f"expected shortfall 95% {out[95.0][1]:.2f}%",
                   f"historical VaR 99% {out[99.0][0]:.2f}%",
                   f"expected shortfall 99% {out[99.0][1]:.2f}%",
                   f"normal-assumption VaR 99% {mu + z99 * sd:.2f}% "
                   f"(understates by {abs(out[99.0][0] - (mu + z99*sd)):.2f}pp)",
                   f"skew {skew:+.2f}, excess kurtosis {kurt:+.1f}"]},
        {"var95": out[95.0][0], "es95": out[95.0][1],
         "var99": out[99.0][0], "es99": out[99.0][1],
         "normal_var99": mu + z99 * sd, "skew": skew, "excess_kurtosis": kurt},
        ctx.provenance + ["historical VaR is the empirical quantile of the "
                          "actual returns; the normal figure is shown to "
                          "expose how far the tails deviate"])


def fit_kalman_model(ctx: PriceCtx, opts: dict) -> dict:
    y = ctx.close
    q, r_obs, xs, ps, at_edge = fit_kalman(y)
    band = 2 * np.sqrt(ps)
    return _pack(
        {"kind": "lines",
         "title": f"{ctx.symbol}: Kalman filter, noise fitted by likelihood",
         "x": list(range(len(y))),
         "series": [{"name": "price", "y": y.tolist()},
                    {"name": "filtered state", "y": xs.tolist()},
                    {"name": "+2 sigma", "y": (xs + band).tolist()},
                    {"name": "-2 sigma", "y": (xs - band).tolist()}],
         "x_label": "Bar", "y_label": "Price",
         "notes": [f"process noise Q {q:.3e}",
                   f"observation noise R {r_obs:.3e}",
                   f"Q/R {q / r_obs:.3f} "
                   f"({'trusts the price' if q > r_obs else 'smooths the price'})",
                   f"final estimate {xs[-1]:,.4f} vs last price {y[-1]:,.4f}"]
                  + (["the likelihood wants even less smoothing than the grid "
                      "allows: at this frequency the series is essentially a "
                      "random walk"] if at_edge else [])},
        {"q": q, "r": r_obs, "ratio": q / r_obs},
        ctx.provenance + ["Q and R chosen by maximising the local-level "
                          "likelihood on this series"])


def fit_hmm_model(ctx: PriceCtx, opts: dict) -> dict:
    h = fit_hmm2(ctx.returns)
    ann = np.sqrt(ctx.bars_per_year) * 100.0
    calm_v, turb_v = h["sd"][0] * ann, h["sd"][1] * ann
    stay = np.diag(h["A"])
    dur = [1.0 / max(1e-9, 1 - s) for s in stay]
    prob = h["prob_turbulent"]
    return _pack(
        {"kind": "lines",
         "title": f"{ctx.symbol}: regimes from a fitted 2-state Markov model",
         "x": list(range(len(prob))),
         "series": [{"name": "P(turbulent)", "y": prob.tolist()},
                    {"name": "price", "y": ctx.close[1:].tolist()}],
         "x_label": "Bar", "y_label": "Value",
         "notes": [f"calm vol {calm_v:.1f}%/yr", f"turbulent vol {turb_v:.1f}%/yr",
                   f"vol ratio {turb_v / max(calm_v, 1e-9):.1f}x",
                   f"stay-calm {stay[0]:.3f} (~{dur[0]:,.0f} bars)",
                   f"stay-turbulent {stay[1]:.3f} (~{dur[1]:,.0f} bars)",
                   f"currently P(turbulent) {prob[-1]:.0%}",
                   f"time in turbulence {float(np.mean(prob > 0.5)):.0%}"]},
        {"calm_vol": calm_v, "turbulent_vol": turb_v,
         "stay_calm": float(stay[0]), "stay_turbulent": float(stay[1]),
         "p_turbulent_now": float(prob[-1])},
        ctx.provenance + ["two states fitted by Baum-Welch on the returns; "
                          "states are ordered so state 1 is the higher-vol one"])


def fit_gp(ctx: PriceCtx, opts: dict) -> dict:
    take = int(min(len(ctx.close), int(opts.get("window", 220))))
    y_raw = ctx.close[-take:]
    x = np.arange(take, dtype=float)
    mu_y, sd_y = float(np.mean(y_raw)), float(np.std(y_raw)) or 1.0
    y = (y_raw - mu_y) / sd_y
    noise = float(np.std(np.diff(y)) / math.sqrt(2)) or 0.05
    best = None
    for length in np.linspace(3, max(8, take / 3), 12):     # marginal likelihood
        def k(a, b, L=length):
            d = (a[:, None] - b[None, :]) / L
            return np.exp(-0.5 * d ** 2)
        K = k(x, x) + noise ** 2 * np.eye(take)
        try:
            L_ = np.linalg.cholesky(K)
        except np.linalg.LinAlgError:
            continue
        a = np.linalg.solve(L_.T, np.linalg.solve(L_, y))
        ll = -0.5 * float(y @ a) - float(np.log(np.diag(L_)).sum())
        if best is None or ll > best[0]:
            best = (ll, float(length))
    length = best[1] if best else 10.0
    ahead = int(opts.get("ahead", 30))
    xs = np.arange(take + ahead, dtype=float)
    mean, sd = gp_posterior(x, y, xs, length, 1.0, noise)
    mean = mean * sd_y + mu_y
    band = 2 * sd * sd_y
    obs = list(y_raw) + [None] * ahead
    return _pack(
        {"kind": "lines",
         "title": f"{ctx.symbol}: Gaussian process fit with {ahead}-bar forecast",
         "x": xs.tolist(),
         "series": [{"name": "price", "y": obs},
                    {"name": "GP mean", "y": mean.tolist()},
                    {"name": "+2 sigma", "y": (mean + band).tolist()},
                    {"name": "-2 sigma", "y": (mean - band).tolist()}],
         "x_label": "Bar", "y_label": "Price",
         "notes": [f"length scale {length:.1f} bars (fitted by marginal likelihood)",
                   f"noise {noise * sd_y:,.4f} in price units",
                   f"last {take} bars used, {ahead} bars extrapolated",
                   f"band at the horizon +/-{band[-1]:,.2f}"]},
        {"length_scale": length, "noise": noise, "window": take},
        ctx.provenance + ["RBF kernel; the length scale is chosen by marginal "
                          "likelihood, so the smoothness comes from the data"])


def _bs_grid(ctx: PriceCtx, opts: dict):
    spot = float(ctx.close[-1])
    sigma = max(ctx.annual_vol(), 1e-4)
    r = float(opts.get("rate", 0.05))
    strike = float(opts.get("strike", round(spot, 2)))
    spots = np.linspace(spot * 0.5, spot * 1.5, 70)
    times = np.linspace(0.02, float(opts.get("expiry", 1.0)), 55)
    S, T = np.meshgrid(spots, times)
    d1 = (np.log(S / strike) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    return spot, sigma, r, strike, spots, times, S, T, d1, d2


def fit_black_scholes(ctx: PriceCtx, opts: dict) -> dict:
    spot, sigma, r, strike, spots, times, S, T, d1, d2 = _bs_grid(ctx, opts)
    call = S * norm_cdf(d1) - strike * np.exp(-r * T) * norm_cdf(d2)
    atm = float(np.interp(spot, spots, call[-1]))
    return _pack(
        {"kind": "surface",
         "title": f"{ctx.symbol}: Black-Scholes call value at fitted volatility",
         "x": spots.tolist(), "y": times.tolist(), "z": call.tolist(),
         "x_label": "Spot", "y_label": "Time to expiry (years)",
         "z_label": "Call value",
         "notes": [f"spot {spot:,.2f} (last close)",
                   f"volatility {sigma:.1%}/yr (fitted)",
                   f"strike {strike:,.2f}", f"rate {r:.1%} (assumption, not fitted)",
                   f"1y ATM call {atm:,.2f} = {atm / spot:.1%} of spot"]},
        {"spot": spot, "volatility": sigma, "strike": strike, "rate": r},
        ctx.provenance + ["the rate is an input you can change; everything "
                          "else comes from your data"])


def fit_greeks(ctx: PriceCtx, opts: dict) -> dict:
    which = str(opts.get("greek", "delta")).lower()
    spot, sigma, r, strike, spots, times, S, T, d1, d2 = _bs_grid(ctx, opts)
    if which == "gamma":
        z = norm_pdf(d1) / (S * sigma * np.sqrt(T))
        label, note = "Gamma", "gamma peaks at the money and explodes near expiry"
    else:
        which = "delta"
        z = norm_cdf(d1)
        label, note = "Delta", "delta steepens into expiry around the strike"
    return _pack(
        {"kind": "surface",
         "title": f"{ctx.symbol}: {label} surface at fitted volatility",
         "x": spots.tolist(), "y": times.tolist(), "z": z.tolist(),
         "x_label": "Spot", "y_label": "Time to expiry (years)", "z_label": label,
         "notes": [f"spot {spot:,.2f}", f"volatility {sigma:.1%}/yr (fitted)",
                   f"strike {strike:,.2f}", note]},
        {"spot": spot, "volatility": sigma, "strike": strike, "rate": r,
         "greek": which},
        ctx.provenance)


def fit_vol_surface_from_prices(ctx: PriceCtx, opts: dict) -> dict:
    """Prices cannot identify the strike dimension of a vol surface, so rather
    than invent a skew this fits what prices DO contain: the term structure of
    realised volatility across horizons."""
    r = ctx.returns
    max_h = int(min(max(4, len(r) // 12), 60))
    hs = np.unique(np.round(np.linspace(1, max_h, min(max_h, 24))).astype(int))
    vols = []
    for h in hs:
        agg = np.convolve(r, np.ones(int(h)), mode="valid")     # overlapping
        vols.append(float(np.std(agg, ddof=1)
                          * math.sqrt(ctx.bars_per_year / h) * 100))
    slope = vols[-1] - vols[0]
    return _pack(
        {"kind": "lines",
         "title": f"{ctx.symbol}: realised volatility term structure",
         "x": [int(h) for h in hs],
         "series": [{"name": "annualised vol %", "y": vols}],
         "x_label": "Horizon (bars)", "y_label": "Annualised vol %",
         "notes": [f"1-bar vol {vols[0]:.1f}%/yr",
                   f"{int(hs[-1])}-bar vol {vols[-1]:.1f}%/yr",
                   f"term slope {slope:+.1f}pp "
                   f"({'mean reverting' if slope < 0 else 'trending'})",
                   "no options data: the STRIKE dimension (skew and smile) "
                   "cannot be identified from prices, so it is not drawn"]},
        {"vol_1bar": vols[0], "vol_long": vols[-1], "term_slope": slope},
        ctx.provenance + ["degraded from an implied surface to a realised term "
                          "structure because the dataset holds prices, not "
                          "option quotes"])


def fit_vol_surface_from_options(frame: pd.DataFrame, symbol: str,
                                 opts: dict) -> dict:
    """Fit iv ~ a + b*m + c*m^2 + d*sqrt(T) on real quotes (m = log-moneyness),
    which is the smallest model that captures level, skew, smile and term."""
    cols = list(frame.columns)
    def pick(names):
        return next((c for c in names if c in cols), None)
    iv_c, k_c, t_c = pick(IV_NAMES), pick(STRIKE_NAMES), pick(DTE_NAMES)
    missing = [n for n, c in (("implied vol", iv_c), ("strike", k_c),
                              ("expiry/dte", t_c)) if c is None]
    if missing:
        raise FitError(
            "this looks like an option chain but these columns are missing: "
            + ", ".join(missing) + f". Found: {', '.join(cols)}")
    d = frame[[iv_c, k_c, t_c]].apply(pd.to_numeric, errors="coerce").dropna()
    iv = d[iv_c].to_numpy(dtype=float)
    if np.nanmedian(iv) > 3:                 # quoted in percent
        iv = iv / 100.0
    K = d[k_c].to_numpy(dtype=float)
    T = d[t_c].to_numpy(dtype=float)
    t_units = "years"
    if np.nanmedian(T) > 3:                  # days to expiry
        T = T / 365.25
        t_units = "days converted to years"
    keep = (iv > 0.001) & (iv < 5) & (K > 0) & (T > 1 / 365.25)
    iv, K, T = iv[keep], K[keep], T[keep]
    if len(iv) < 12:
        raise FitError(f"only {len(iv)} usable quotes after cleaning; need 12+")
    spot_c = pick(("spot", "underlying", "underlying_price", "close", "price"))
    if spot_c:
        spot = float(pd.to_numeric(frame[spot_c], errors="coerce").dropna().median())
        spot_why = f"{spot_c} column"
    else:
        atm_i = int(np.argmin(iv))
        spot = float(K[atm_i])
        spot_why = "strike with the lowest IV (smile vertex), no spot column found"
    m = np.log(K / spot)
    X = np.column_stack([np.ones_like(m), m, m ** 2, np.sqrt(T)])
    coef, *_ = np.linalg.lstsq(X, iv, rcond=None)
    resid = iv - X @ coef
    r2 = 1 - float(np.var(resid) / np.var(iv)) if np.var(iv) > 0 else 0.0
    ks = np.linspace(K.min(), K.max(), 60)
    tsg = np.linspace(max(T.min(), 1 / 365.25), T.max(), 40)
    KK, TT = np.meshgrid(ks, tsg)
    MM = np.log(KK / spot)
    Z = (coef[0] + coef[1] * MM + coef[2] * MM ** 2 + coef[3] * np.sqrt(TT)) * 100
    return _pack(
        {"kind": "surface",
         "title": f"{symbol}: implied volatility surface fitted to your quotes",
         "x": ks.tolist(), "y": tsg.tolist(), "z": np.clip(Z, 0.1, None).tolist(),
         "x_label": "Strike", "y_label": "Expiry (years)", "z_label": "IV %",
         "notes": [f"{len(iv):,} quotes fitted, R2 {r2:.3f}",
                   f"ATM level {coef[0] * 100:.1f}%",
                   f"skew {coef[1] * 100:+.1f}pp per log-moneyness "
                   f"({'puts bid over calls' if coef[1] < 0 else 'calls bid over puts'})",
                   f"smile curvature {coef[2] * 100:+.1f}",
                   f"term {coef[3] * 100:+.1f}pp per sqrt(year) "
                   f"({'contango' if coef[3] > 0 else 'backwardation'})",
                   f"spot {spot:,.2f} ({spot_why})"]},
        {"atm": float(coef[0]), "skew": float(coef[1]), "smile": float(coef[2]),
         "term": float(coef[3]), "spot": spot, "r2": r2},
        [f"columns used: {iv_c} (IV), {k_c} (strike), {t_c} (expiry, {t_units})",
         f"{len(iv):,} quotes after dropping non-positive and expired rows",
         "least squares on iv ~ 1 + m + m^2 + sqrt(T), m = log(K/spot)"])


def fit_correlation(ctxs: list[PriceCtx], opts: dict) -> dict:
    aligned, names, bpy, tf, _ts = _align_returns(ctxs)
    C = np.corrcoef(aligned, rowvar=False)
    n = len(names)
    off = C[np.triu_indices(n, 1)]
    ev = np.linalg.eigvalsh(C)[::-1]
    # Marchenko-Pastur edge: eigenvalues below it are indistinguishable from
    # noise for this sample size, which is the honest read on a corr matrix.
    T_obs, N = aligned.shape
    q = N / T_obs
    mp_edge = (1 + math.sqrt(q)) ** 2
    signal = int(np.sum(ev > mp_edge))
    return _pack(
        {"kind": "heatmap",
         "title": f"Correlation of {n} instruments ({T_obs:,} aligned bars)",
         "x": names, "y": names, "z": C.tolist(),
         "x_label": "", "y_label": "", "z_label": "correlation",
         "notes": [f"mean pairwise {float(np.mean(off)):+.2f}",
                   f"range {float(np.min(off)):+.2f} to {float(np.max(off)):+.2f}",
                   f"top eigenvalue {ev[0]:.2f} = "
                   f"{ev[0] / n:.0%} of variance (the market factor)",
                   f"{signal} of {n} eigenvalues clear the Marchenko-Pastur "
                   f"noise edge ({mp_edge:.2f})",
                   f"{T_obs:,} {tf} bars survive alignment"]},
        {"mean_correlation": float(np.mean(off)),
         "top_eigenvalue": float(ev[0]), "signal_factors": signal},
        [f"instruments: {', '.join(names)}",
         f"aligned on a shared {tf} grid: {T_obs:,} bars",
         "correlations on log returns of each series' own price column"])


def fit_pca(frames: list[tuple[str, pd.DataFrame]], opts: dict) -> dict:
    """PCA factor structure, rendered by the island's interactive 3D view
    (PCAVisualization fitted mode), so this returns params, not a figure.

    Two shapes of input, chosen by what the user picked:
    - two or more datasets: classic cross-sectional PCA on aligned log
      returns (the market factor and its siblings);
    - ONE dataset with >=3 numeric columns (a yield-curve table, a spread
      panel): PCA on per-bar changes of the columns, which is where
      level/slope/curvature comes from.
    """
    if len(frames) >= 2:
        ctxs = [PriceCtx(f, sym, opts.get("column")) for sym, f in frames]
        X, names, _bpy, tf, ts_arr = _align_returns(ctxs)
        X = X * 100.0  # percent per bar; keeps the color legend human
        kind, color_label = "instruments", "mean return per bar %"
        basis_note = "log returns (%) of each instrument's price column"
    else:
        sym, df = frames[0]
        df = normalize_time(df) if "ts" not in df.columns else df
        cols = [c for c in df.columns
                if c != "ts" and pd.api.types.is_numeric_dtype(df[c])]
        # A single OHLCV instrument is NOT a decomposable panel: open, high,
        # low and close are nearly the same series (they load on one factor
        # together) and volume, on a scale millions of times larger, becomes
        # its own "factor". Seen exactly this with Apple:
        # PC2 = volume +1.00 and a +-76,050,200 color legend.
        # Column mode is for genuine panels (a yield-curve table); one
        # instrument gets guidance, not a garbage decomposition.
        if set(cols) <= {"open", "high", "low", "close", "volume",
                         "vwap", "trades"}:
            raise FitError(
                f"{sym!r} is one instrument, so there is nothing to "
                "decompose: its open/high/low/close move as one series. PCA "
                "finds patterns ACROSS series. Ctrl-click two or more "
                "instruments in the FIT TO list (e.g. Bitcoin + Gold + "
                "S&P 500), or pick a curve table like US Treasury Curve.")
        if len(cols) < 3:
            raise FitError(
                "PCA needs two or more instruments, or one dataset with at "
                f"least 3 numeric columns (a curve table); {sym!r} has "
                f"{len(cols)} numeric column(s). Pick more datasets.")
        sub = df.dropna(subset=["ts"] + cols)
        if len(sub) < 40:
            raise FitError(f"only {len(sub)} complete rows in {sym!r}; "
                           "need at least 40")
        _bpy, tf = measure_clock(sub["ts"].to_numpy(dtype=float), len(sub))
        X = np.diff(sub[cols].to_numpy(dtype=float), axis=0)
        ts_arr = sub["ts"].to_numpy(dtype=float)[1:]
        names, kind, color_label = cols, "columns", "mean change per bar"
        basis_note = f"per-bar changes of {len(cols)} columns of {sym}"

    T = len(X)
    sd = X.std(axis=0, ddof=1)
    keep = sd > 1e-12
    dropped = [n for n, k in zip(names, keep) if not k]
    X = X[:, keep]
    names = [n for n, k in zip(names, keep) if k]
    sd = sd[keep]
    N = X.shape[1]
    if N < 2:
        raise FitError("fewer than 2 series actually move; nothing to "
                       "decompose")

    # Correlation-basis PCA: z-score first so a 2%-a-day instrument and a
    # 0.02%-a-day one weigh the same. Covariance on raw scales would just
    # rediscover which column has the biggest units.
    Z = (X - X.mean(axis=0)) / sd
    C = (Z.T @ Z) / (T - 1)
    ev, V = np.linalg.eigh(C)
    order = np.argsort(ev)[::-1]
    ev = np.clip(ev[order], 0, None)
    V = V[:, order]
    # Deterministic orientation: eigenvector signs are arbitrary, and a
    # refit that flips the cloud upside down reads as a different market.
    for j in range(V.shape[1]):
        k = int(np.argmax(np.abs(V[:, j])))
        if V[k, j] < 0:
            V[:, j] = -V[:, j]

    total = float(ev.sum()) or 1.0
    ratio = ev / total
    eff_dim = float(ev.sum() ** 2 / (np.sum(ev ** 2) + 1e-12))
    # Marchenko-Pastur noise edge, same read as the correlation model: how
    # many factors are distinguishable from sampling noise at this T.
    q = N / T
    mp_edge = (1 + math.sqrt(q)) ** 2
    signal = int(np.sum(ev > mp_edge))

    # Two series give a 2D decomposition; the 3D view shows it as a plane
    # with PC3 flat at zero, which is itself the honest picture.
    k3 = min(3, N)
    scores = np.zeros((T, 3))
    scores[:, :k3] = Z @ V[:, :k3]
    V3 = np.zeros((N, 3))
    V3[:, :k3] = V[:, :k3]
    if kind == "columns":
        # Panels can mix units (a curve table is fine, but anything with a
        # volume-like column would put the legend in the millions); z-scored
        # moves keep the color scale-free.
        color = Z.mean(axis=1)
        color_label = "mean move (z-score)"
    else:
        color = X.mean(axis=1)

    max_pts = 1500
    idx = (np.arange(T) if T <= max_pts
           else np.linspace(0, T - 1, max_pts).astype(int))
    finite = color[np.isfinite(color)]
    lim = float(np.percentile(np.abs(finite), 95)) if len(finite) else 1.0

    params = {
        "kind": kind, "names": names, "tf": tf, "n_bars": int(T),
        "var_pct": [round(float(r * 100), 2) for r in ratio[:min(8, N)]],
        "eff_dim": round(eff_dim, 2),
        "mp_edge": round(float(mp_edge), 2),
        "signal_factors": signal,
        "loadings": {f"pc{j + 1}": [round(float(v), 4) for v in V3[:, j]]
                     for j in range(3)},
        "scores": [[round(float(scores[i, 0]), 4),
                    round(float(scores[i, 1]), 4),
                    round(float(scores[i, 2]), 4)] for i in idx],
        "color": [round(float(color[i]), 4) for i in idx],
        "color_label": color_label,
        "color_lim": round(lim or 1.0, 4),
        # Epoch seconds per point, same subsample: the view's time-sweep
        # animation shows the date each sphere landed on.
        "ts": [int(ts_arr[i]) for i in idx],
    }
    prov = [f"{'instruments' if kind == 'instruments' else 'columns'}: "
            + ", ".join(names),
            f"{T:,} {tf} bars decomposed; {basis_note}",
            "correlation basis: every series z-scored before the "
            "eigendecomposition",
            f"PC1-3 carry {ratio[:3].sum():.0%} of total variance; "
            f"{signal} of {N} eigenvalues clear the Marchenko-Pastur noise "
            f"edge ({mp_edge:.2f})",
            "PC signs oriented so each component's largest loading is "
            "positive"]
    if dropped:
        prov.append("dropped as constant: " + ", ".join(dropped))
    return {"ok": True, "params": params, "provenance": prov}


def fit_frontier(ctxs: list[PriceCtx], opts: dict) -> dict:
    aligned, names, bpy, tf, _ts = _align_returns(ctxs)
    mu = aligned.mean(axis=0) * bpy
    cov = np.cov(aligned, rowvar=False) * bpy
    n = len(names)
    rng = np.random.default_rng(int(opts.get("seed", 3)))
    n_ports = int(opts.get("portfolios", 4000))
    w = rng.dirichlet(np.ones(n), n_ports)
    rets = w @ mu
    risks = np.sqrt(np.maximum(np.einsum("ij,jk,ik->i", w, cov, w), 1e-18))
    rf = float(opts.get("rf", 0.02))
    sharpe = (rets - rf) / risks
    best = int(np.argmax(sharpe))
    mv = int(np.argmin(risks))
    weights = ", ".join(f"{names[i]} {w[best][i]:.0%}" for i in range(n))
    # Expected returns are the weakest input in portfolio work: on a short
    # sample they are noise, and the frontier's return axis inherits that
    # noise. Report the t-stats so the user reads the picture correctly.
    tstats = (aligned.mean(axis=0) / (aligned.std(axis=0, ddof=1)
              / math.sqrt(len(aligned))))
    weak = [names[i] for i in range(n) if abs(tstats[i]) < 2]
    return _pack(
        {"kind": "scatter",
         "title": f"Efficient frontier from {n} of your instruments",
         "series": [
             {"name": "random portfolios", "x": (risks * 100).tolist(),
              "y": (rets * 100).tolist()},
             {"name": "max Sharpe", "x": [float(risks[best] * 100)],
              "y": [float(rets[best] * 100)]},
             {"name": "min variance", "x": [float(risks[mv] * 100)],
              "y": [float(rets[mv] * 100)]}],
         "x_label": "Volatility %/yr", "y_label": "Return %/yr",
         "notes": [f"{n_ports:,} long-only portfolios of {n} assets",
                   f"best Sharpe {sharpe[best]:.2f} at {risks[best]:.1%} vol",
                   f"max-Sharpe weights: {weights}",
                   f"min variance {risks[mv]:.1%} vol",
                   f"risk-free {rf:.1%} (assumption)",
                   f"annualised with {bpy:,.0f} {tf} bars/year, measured from "
                   f"the aligned index"]
                  + ([f"CAUTION: expected returns for {', '.join(weak)} are not "
                      f"statistically significant (|t| < 2), so the return axis "
                      f"is indicative, not a forecast"] if weak else [])},
        {"best_sharpe": float(sharpe[best]),
         "weights": {names[i]: float(w[best][i]) for i in range(n)}},
        [f"instruments: {', '.join(names)}",
         "expected returns and covariance estimated from YOUR aligned history, "
         "which is why the frontier is this shape and not a textbook one"])


def _align_returns(ctxs: list[PriceCtx]):
    """Align the instruments on a common clock, then compute returns. An
    unaligned correlation is a meaningless number.

    Mixed timeframes are handled by snapping every series to the COARSEST
    bar among them (1m data joined against 1h data is resampled to 1h, last
    price in each bucket) instead of demanding identical timestamps, which
    returned zero overlap on real 30m datasets whose bars sit on different
    offsets. The clock is then measured from the JOINED index: annualising a
    2-asset join with the average of the two inputs' bars-per-year produced a
    Sharpe of 3.5 out of thin air.
    """
    if len(ctxs) < 2:
        raise FitError("this model needs at least two datasets")
    step = max(1.0, max(float(np.median(np.diff(c.ts))) for c in ctxs))
    frames = []
    for c in ctxs:
        bucket = (np.floor(c.ts / step) * step).astype("int64")
        s = pd.Series(c.close, index=pd.Index(bucket, name="ts"))
        frames.append(s[~s.index.duplicated(keep="last")].rename(c.symbol))
    joined = pd.concat(frames, axis=1, join="inner").dropna()
    if len(joined) < 40:
        # Name the culprit: "no overlap" is useless without knowing which
        # dataset sits in a different period.
        spans = "; ".join(
            f"{c.symbol} {pd.Timestamp(int(c.ts[0]), unit='s'):%Y-%m-%d} to "
            f"{pd.Timestamp(int(c.ts[-1]), unit='s'):%Y-%m-%d}" for c in ctxs)
        raise FitError(
            f"only {len(joined)} bars are shared by all {len(ctxs)} datasets "
            f"after snapping to a {_tf_label(step)} grid. Their ranges: {spans}")
    ts_j = joined.index.to_numpy(dtype=float)
    bpy, tf = measure_clock(ts_j, len(ts_j))
    rets = np.log(joined / joined.shift(1)).dropna().to_numpy(dtype=float)
    # ts_j[1:] lines up with rets rows (the diff drops the first bar); the
    # PCA time-sweep animation needs a date per point.
    return rets, [str(c) for c in joined.columns], bpy, tf, ts_j[1:]


def fit_term_structure(frame: pd.DataFrame, symbol: str, opts: dict) -> dict:
    """Nelson-Siegel on a yield-curve table. Maturity columns are detected by
    name (1y, 2y, 10y, m3, 30y...), which is the column intelligence that
    makes this work on whatever the user exported."""
    import re
    mats: list[tuple[float, str]] = []
    for c in frame.columns:
        if c == "ts" or not pd.api.types.is_numeric_dtype(frame[c]):
            continue
        m = re.fullmatch(r"(?:y|m|t)?_?(\d+(?:\.\d+)?)\s*(y|yr|year|m|mo|month)?",
                         str(c).lower())
        if not m:
            continue
        val = float(m.group(1))
        unit = (m.group(2) or ("m" if str(c).lower().startswith("m") else "y"))
        mats.append((val / 12.0 if unit.startswith("m") else val, c))
    if len(mats) < 4:
        raise FitError(
            "need at least 4 maturity columns named like 1y, 2y, 5y, 10y (or "
            "m3, m6). Found: " + ", ".join(str(c) for c in frame.columns))
    mats.sort()
    taus = np.array([m[0] for m in mats])
    last = frame[[m[1] for m in mats]].apply(pd.to_numeric, errors="coerce").dropna()
    if last.empty:
        raise FitError("no complete curve row found")
    y = last.iloc[-1].to_numpy(dtype=float)
    best = None
    for lam in np.linspace(0.2, 3.0, 40):        # betas are linear given lambda
        f = (1 - np.exp(-taus / lam)) / (taus / lam)
        X = np.column_stack([np.ones_like(taus), f, f - np.exp(-taus / lam)])
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        sse = float(np.sum((y - X @ beta) ** 2))
        if best is None or sse < best[0]:
            best = (sse, lam, beta, X)
    sse, lam, beta, X = best
    grid = np.linspace(taus.min(), taus.max(), 80)
    f = (1 - np.exp(-grid / lam)) / (grid / lam)
    fit_curve = beta[0] + beta[1] * f + beta[2] * (f - np.exp(-grid / lam))
    slope = float(y[-1] - y[0])
    return _pack(
        {"kind": "lines",
         "title": f"{symbol}: Nelson-Siegel fit to your latest curve",
         "series": [{"name": "observed", "x": taus.tolist(), "y": y.tolist()},
                    {"name": "Nelson-Siegel", "x": grid.tolist(),
                     "y": fit_curve.tolist()}],
         "x_label": "Maturity (years)", "y_label": "Yield",
         "notes": [f"level beta0 {beta[0]:.2f}", f"slope beta1 {beta[1]:+.2f}",
                   f"curvature beta2 {beta[2]:+.2f}", f"lambda {lam:.2f}",
                   f"fit RMSE {math.sqrt(sse / len(y)):.3f}",
                   f"{taus[0]:g}y to {taus[-1]:g}y spread {slope:+.2f} "
                   f"({'inverted' if slope < 0 else 'upward sloping'})"]},
        {"beta0": float(beta[0]), "beta1": float(beta[1]),
         "beta2": float(beta[2]), "lambda": float(lam)},
        [f"maturity columns detected: "
         + ", ".join(f"{m[1]}={m[0]:g}y" for m in mats),
         "fitted to the most recent complete row of the table"])


PRICE_FITTERS = {
    "monte-carlo": fit_monte_carlo,
    "diffusion": fit_diffusion,
    "garch": fit_garch_model,
    "heston": fit_heston_model,
    "var-surface": fit_var,
    "kalman": fit_kalman_model,
    "hmm": fit_hmm_model,
    "gaussian-process": fit_gp,
    "black-scholes": fit_black_scholes,
    "greeks-surface": fit_greeks,
    "volatility-surface": fit_vol_surface_from_prices,
}
UNIVERSE_FITTERS = {
    "correlation-surface": fit_correlation,
    "efficient-frontier": fit_frontier,
}


def looks_like_options(frame: pd.DataFrame) -> bool:
    cols = list(frame.columns)
    return (any(c in cols for c in IV_NAMES)
            and any(c in cols for c in STRIKE_NAMES))


def fit(model: str, frames: list[tuple[str, pd.DataFrame]],
        opts: dict | None = None) -> dict:
    """Dispatch: model id + the loaded dataset(s) -> fitted model dict."""
    opts = opts or {}
    req = REQUIREMENTS.get(model)
    if req is None:
        raise FitError(f"unknown model {model!r}")
    if req["needs"] == "none":
        raise FitError(
            f"{req['label']} is an architecture illustration, not an estimated "
            "model. To train one on your data use BACKTEST > MACHINE LEARNING, "
            "which runs real training jobs on this machine.")
    if not frames:
        raise FitError("pick a dataset first")

    if model == "pca":
        # Takes raw frames, not PriceCtx: with a single multi-column dataset
        # it decomposes the columns (curve PCA), which PriceCtx's one-price-
        # column view cannot express.
        return fit_pca(frames, opts)
    if model in UNIVERSE_FITTERS:
        ctxs = [PriceCtx(f, sym, opts.get("column")) for sym, f in frames]
        return UNIVERSE_FITTERS[model](ctxs, opts)

    symbol, frame = frames[0]
    if model == "term-structure":
        return fit_term_structure(frame, symbol, opts)
    if model == "volatility-surface" and looks_like_options(frame):
        return fit_vol_surface_from_options(frame, symbol, opts)
    ctx = PriceCtx(frame, symbol, opts.get("column"))
    return PRICE_FITTERS[model](ctx, opts)
