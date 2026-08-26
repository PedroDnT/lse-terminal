import math

import pandas as pd
import pytest

import lse_terminal.indicators  # noqa: F401  (registers built-ins)
from lse_terminal.contracts import all_specs, compute


def make_df(closes):
    return pd.DataFrame({
        "ts": range(len(closes)), "open": closes, "high": closes,
        "low": closes, "close": closes, "volume": [0] * len(closes),
    })


def test_builtins_registered():
    names = {s.name for s in all_specs()}
    assert {"sma", "ema", "rsi"} <= names


def test_sma_known_values():
    out = compute("sma", make_df([1, 2, 3, 4]), length=2)["sma"]
    assert math.isnan(out.iloc[0])
    assert list(out.iloc[1:]) == [1.5, 2.5, 3.5]


def test_ema_known_values():
    out = compute("ema", make_df([1, 2, 3, 4]), length=2)["ema"]
    # alpha = 2/(span+1) = 2/3, seeded at the first close
    assert out.iloc[0] == 1
    assert abs(out.iloc[1] - 5 / 3) < 1e-9
    assert abs(out.iloc[2] - 23 / 9) < 1e-9


def test_rsi_bounds_and_direction():
    up = compute("rsi", make_df(list(range(1, 40))), length=14)["rsi"]
    assert up.iloc[-1] > 99  # monotonic rise has no losses
    down = compute("rsi", make_df(list(range(40, 1, -1))), length=14)["rsi"]
    assert down.iloc[-1] < 1
    mixed = compute("rsi", make_df([10, 11, 10, 11, 10, 11, 10, 11, 10, 11] * 4),
                    length=14)["rsi"]
    assert ((mixed.dropna() >= 0) & (mixed.dropna() <= 100)).all()


def test_param_validation():
    with pytest.raises(KeyError):
        compute("nope", make_df([1, 2, 3]))
    with pytest.raises(ValueError):
        compute("sma", make_df([1, 2, 3]), length=0)  # below min
    out = compute("sma", make_df([1, 2, 3]), length="2")["sma"]  # string cast
    assert list(out.iloc[1:]) == [1.5, 2.5]
