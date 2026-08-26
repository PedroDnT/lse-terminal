"""Structural checks over EVERY registered indicator plus math spot checks
for the v0.2 pack. The structural loop is what keeps a future contribution
honest: anything registered must compute cleanly on real provider data."""

import numpy as np
import pandas as pd
import pytest

import lse_terminal.indicators  # noqa: F401
from lse_terminal.contracts import all_specs, compute
from lse_terminal.providers import DemoProvider


@pytest.fixture(scope="module")
def df():
    return DemoProvider().candles("DEMO:SPX", "1h", limit=300)


def test_pack_size():
    # The full chart set: 27 originals + 76 from the reference chart library
    # (see test_indicator_parity.py) + 12 bundled Brue-language
    # indicators (indicators/brue/*.brue). Was 44: the 32 that exactly
    # duplicated the Python pack were retired from the picker (one
    # source of truth per indicator).
    assert len(all_specs()) == 115


def test_every_indicator_computes_on_provider_data(df):
    for spec in all_specs():
        frame = compute(spec.name, df)
        assert len(frame) == len(df), spec.name
        assert len(frame.columns) >= 1, spec.name
        # Warmup NaNs are fine; an all-NaN column means broken math.
        for col in frame.columns:
            assert frame[col].notna().sum() > 0, f"{spec.name}.{col} is all NaN"
        # Styles must reference real columns.
        for styled in spec.styles:
            assert styled in frame.columns, f"{spec.name} styles {styled!r}"


def test_bollinger_band_order(df):
    bb = compute("bollinger", df).dropna()
    assert (bb["upper"] >= bb["middle"]).all()
    assert (bb["middle"] >= bb["lower"]).all()


def test_macd_is_ema_difference(df):
    out = compute("macd", df)
    fast = df["close"].ewm(span=12, adjust=False).mean()
    slow = df["close"].ewm(span=26, adjust=False).mean()
    assert np.allclose(out["macd"], fast - slow, equal_nan=True)
    assert np.allclose(out["hist"], out["macd"] - out["signal"], equal_nan=True)


def test_atr_positive_on_moving_data(df):
    out = compute("atr", df)["atr"].dropna()
    assert (out > 0).all()


def test_willr_bounds(df):
    out = compute("willr", df)["willr"].dropna()
    assert ((out <= 0) & (out >= -100)).all()


def test_stochastic_bounds_and_columns(df):
    out = compute("stochastic", df)
    assert list(out.columns) == ["k", "d"]
    vals = out.dropna()
    assert ((vals >= 0) & (vals <= 100)).all().all()


def test_obv_known_case():
    small = pd.DataFrame({
        "ts": range(4), "open": [1] * 4, "high": [1] * 4, "low": [1] * 4,
        "close": [10.0, 11.0, 10.5, 10.5], "volume": [100.0, 200.0, 300.0, 400.0],
    })
    out = compute("obv", small)["obv"]
    # Seeded at bar 0's volume (chart convention), then up 200, down 300, flat.
    assert list(out) == [100.0, 300.0, 0.0, 0.0]


def test_supertrend_flips_between_bands(df):
    st = compute("supertrend", df)["supertrend"].dropna()
    close = df["close"].iloc[-len(st):]
    # SuperTrend hugs price from one side at a time; it must not equal price.
    assert (st != close.values).all()
