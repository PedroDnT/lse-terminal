"""The data provider contract.

A provider is the terminal's window onto one data source: the LSE vault, a
folder of CSVs, an exchange, a broker. Implement this class in any pip
package, expose it under the ``lse_terminal.providers`` entry-point group,
and the terminal discovers it automatically.

Only ``search`` and ``candles`` are mandatory. Everything else degrades
gracefully in the UI when it raises :class:`NotSupported`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncIterator

import pandas as pd

from lse_terminal.contracts.types import Instrument, Quote


class NotSupported(Exception):
    """Raised by optional provider methods the source cannot serve."""


class Provider(ABC):
    # Machine identifier, unique across installed providers (used in URLs).
    name: str = ""
    # Human label shown in the UI.
    title: str = ""
    # Timeframes this source can serve, in UI display order.
    timeframes: list[str] = ["1m", "5m", "15m", "1h", "4h", "1d"]
    # Providers that return identical data for identical calls (used by the
    # compliance harness to enable determinism checks).
    deterministic: bool = False

    @abstractmethod
    def search(self, query: str = "", limit: int = 50) -> list[Instrument]:
        """Instruments matching ``query`` (empty query = a sensible default list).

        Presentation contract (the translator layer): the UI renders whatever
        arrives here with NO source-specific rules of its own, so a provider
        adapting a new broker/vendor must normalize to this shape:
        - ``category`` is a display-ready group label ("Forex", "US Stocks").
        - ``name`` is the instrument's human display name ("Euro / US Dollar",
          "Apple Inc."); empty only when the source truly has none.
        - For an empty query, results arrive grouped contiguously by category,
          groups and rows already in the order the source wants them shown.
          The sidebar renders that order verbatim, one collapsible folder per
          category.
        """

    @abstractmethod
    def candles(
        self,
        symbol: str,
        timeframe: str,
        limit: int = 500,
        start: str | None = None,
        end: str | None = None,
    ) -> pd.DataFrame:
        """OHLCV history as a DataFrame with exactly ``CANDLE_COLUMNS``, ts ascending."""

    def quote(self, symbol: str) -> Quote:
        raise NotSupported(f"{self.name} does not serve quotes")

    def stream(self, symbols: list[str]) -> AsyncIterator[dict]:
        """Async iterator of tick dicts: {symbol, price, ts, bid?, ask?, volume?}."""
        raise NotSupported(f"{self.name} does not stream")

    def configured(self) -> bool:
        """False when the source needs setup (an API key, a path) it doesn't have."""
        return True

    def capabilities(self) -> set[str]:
        """Which optional surfaces this provider actually implements."""
        caps = {"search", "candles"}
        if type(self).quote is not Provider.quote:
            caps.add("quote")
        if type(self).stream is not Provider.stream:
            caps.add("stream")
        return caps
