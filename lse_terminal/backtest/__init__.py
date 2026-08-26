"""Backtesting: run a strategy over candles and get equity, trades, and stats.

The engine that does the work is Brue (the open-source Rust core). It runs
entirely on the user's machine over candles from any provider: LSE history,
their own CSVs, anything a Provider yields. Nothing is sent to a server.

Alternative engines plug in through the ``lse_terminal.engines`` entry-point
group, same as providers and indicators.
"""

from lse_terminal.backtest.contract import (
    BacktestEngine,
    BacktestError,
    BacktestResult,
    Trade,
)

__all__ = ["BacktestEngine", "BacktestError", "BacktestResult", "Trade"]
