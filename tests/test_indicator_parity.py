"""Full-library checks on the shared candle fixture.

Two layers:

1. Always-on: every registered indicator computes on the 1500-bar fixture
   without error, length-aligned, with at least some finite values.

2. Reference parity (skipped unless tests/data/ts_truth.json exists): compares
   every indicator against the reference chart library's output, bars 300+
   (seeding conventions legitimately differ inside the warm-up). The truth
   file is ~4 MB so it is not committed; regenerate it with
   tests/gen_ts_truth.mjs (needs the frontend's esbuild). This is how the
   full 103-indicator set was verified numerically against the reference outputs.

Known, deliberate divergences from the reference chart library (Python is canonical):
- tema: the earlier implementation time-shifts its third EMA term by period-1 bars.
- stoch_rsi: the earlier implementation %D line was permanently NaN (NaN-poisoned running SMA).
"""
import json
import math
import pathlib

import pandas as pd
import pytest

import lse_terminal.indicators  # noqa: F401  (registers built-ins)
from lse_terminal.contracts import all_specs, compute

DATA = pathlib.Path(__file__).parent / "data"
TRUTH_PATH = DATA / "ts_truth.json"

# The reference dump used the chart registry's defaults; these Python defaults differ,
# so parity passes them explicitly.
TS_PARAMS = {"ema": {"length": 20}, "alma": {"length": 9}, "hma": {"length": 9}}
KNOWN_TS_BUGS = {"tema", "stoch_rsi"}


@pytest.fixture(scope="module")
def df():
    return pd.read_csv(DATA / "candles_fixture.csv")


def test_full_registry_present():
    names = {s.name for s in all_specs()}
    assert len(names) >= 103
    # Spot anchors across every category.
    assert {"sma", "ichimoku", "stoch_rsi", "squeeze", "twiggs_mf",
            "pivots", "gator", "volume"} <= names


def test_every_indicator_computes(df):
    for spec in all_specs():
        out = compute(spec.name, df)
        assert len(out) == len(df), spec.name
        assert out.notna().any().any(), f"{spec.name} produced no values"


@pytest.mark.skipif(not TRUTH_PATH.exists(),
                    reason="ts_truth.json not generated (see gen_ts_truth.mjs)")
def test_ts_parity(df):
    truth = json.loads(TRUTH_PATH.read_text())
    aliases = {"histogram": "hist", "upfractals": "up", "downfractals": "down",
               "viplus": "plus", "viminus": "minus", "bullpower": "bull",
               "bearpower": "bear", "exitlong": "long", "exitshort": "short",
               "stoplong": "long", "stopshort": "short"}
    norm = lambda s: s.lower().replace("_", "")  # noqa: E731
    failures = []
    for name, cols in truth.items():
        if name in KNOWN_TS_BUGS:
            continue
        out = compute(name, df, **TS_PARAMS.get(name, {}))
        py_cols = {norm(c): c for c in out.columns}
        for idx, (tcol, arr) in enumerate(cols.items()):
            key = norm(tcol)
            pcol = py_cols.get(key) or py_cols.get(aliases.get(key, ""))
            if pcol is None and len(cols) == len(out.columns):
                pcol = list(out.columns)[idx]
            if pcol is None:
                continue  # extra reference column (e.g. aroon oscillator) absent here
            b = out[pcol].tolist()
            max_err, nan_mm = 0.0, 0
            for i in range(300, len(df)):
                a = arr[i] if arr[i] is not None else math.nan
                x = b[i] if isinstance(b[i], (int, float)) else math.nan
                an = isinstance(a, float) and math.isnan(a)
                xn = isinstance(x, float) and math.isnan(x)
                if an and xn:
                    continue
                if an != xn:
                    nan_mm += 1
                    continue
                max_err = max(max_err, abs(a - x) / max(1e-12, abs(a)))
            if max_err > 1e-6 or nan_mm > 5:
                failures.append(f"{name}.{tcol}: err={max_err:.2e} nan_mm={nan_mm}")
    assert not failures, failures
