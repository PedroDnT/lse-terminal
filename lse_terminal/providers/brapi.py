"""B3 history and quotes through brapi.dev, on the user's own free token.

The B3 provider next door reads the exchange's own files, which is the
honest source but a blunt instrument: end-of-day history arrives as
whole-month and whole-year archives, and intraday exists only for the
session in progress. brapi.dev is the other half of that story -- a
Brazilian API that answers per symbol, in one small request, for years of
daily bars or weeks of intraday.

It is a third party, so it is opt-in and it is the user's own account:
brapi issues free tokens, the token lives in the terminal's local config
like the LSE key does, and nothing else about the user goes with a
request. Without a token the source still works against brapi's public
sandbox (PETR4, VALE3, ITUB4, MGLU3), which is enough to see what the
source does before deciding to register for one.

Two limits worth knowing before building on this rather than discovering
them from an empty chart, both inherited from the upstream data: intraday
history is shallow (minutes go back days, hours go back months), and the
catalog is a listing, so a delisted ticker stops appearing even though
its history still resolves when asked for by name.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import pandas as pd

from lse_terminal.contracts import CANDLE_COLUMNS, Instrument, NotSupported, Provider, Quote
from lse_terminal.engine import config as cfg

BRAPI_URL = "https://brapi.dev/api"

# Terminal timeframe -> brapi interval. brapi spells the hour "60m"; the
# rest line up one to one.
_TF_INTERVAL = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
                "1h": "60m", "1d": "1d", "1w": "1wk"}

# How much wall-clock one bar of each timeframe covers, for turning a bar
# count into one of brapi's fixed range names. Intraday uses the ~7-hour
# B3 session rather than a 24-hour day, so 500 hourly bars asks for the
# three months it actually needs and not a fortnight.
_SESSION_HOURS = 7.0
_BAR_DAYS = {"1m": 1 / (60 * _SESSION_HOURS), "5m": 5 / (60 * _SESSION_HOURS),
             "15m": 15 / (60 * _SESSION_HOURS), "30m": 30 / (60 * _SESSION_HOURS),
             "1h": 1 / _SESSION_HOURS, "1d": 365 / 252, "1w": 7}

# brapi's range names and the calendar days each covers, shortest first.
_RANGES = [("1d", 1), ("5d", 5), ("1mo", 30), ("3mo", 92), ("6mo", 183),
           ("1y", 365), ("2y", 730), ("5y", 1826), ("10y", 3653)]

# Upstream keeps only so much intraday history whatever range is asked for,
# so the request is clamped to what can actually come back. Asking for more
# does not fail loudly, it just returns the same short window with a longer
# round trip.
_MAX_INTRADAY_DAYS = {"1m": 7, "5m": 60, "15m": 60, "30m": 60, "1h": 730}

# brapi's instrument types, mapped to display-ready folder names. Rows the
# listing types this does not name are grouped as plain listings rather
# than dropped, so a new brapi type never silently disappears from search.
_CATEGORY = {
    ("stock", "stock"): "B3 Ações",
    ("stock", "unit"): "B3 Units",
    ("fund", "etf"): "B3 ETFs",
    ("fund", "fii"): "B3 Fundos Imobiliários",
    ("fund", "fi-agro"): "B3 Fiagro",
    ("fund", "fi-infra"): "B3 FI-Infra",
    ("fund", "fip"): "B3 FIP",
    ("fund", "fidc"): "B3 FIDC",
    ("bdr", "bdr"): "B3 BDRs",
}
_CATEGORY_ORDER = ["B3 Ações", "B3 Units", "B3 ETFs", "B3 Fundos Imobiliários",
                   "B3 Fiagro", "B3 FI-Infra", "B3 FIP", "B3 FIDC", "B3 BDRs",
                   "B3 Índices", "B3 Outros"]

# Seconds between polls when streaming. brapi's free tier counts requests,
# and B3's public prices are delayed anyway, so a faster poll would spend
# the user's quota to redraw the same number.
_POLL_S = 5.0


class BrapiProvider(Provider):
    name = "brapi"
    title = "B3 via brapi.dev (token)"
    timeframes = ["1m", "5m", "15m", "30m", "1h", "1d", "1w"]
    # The user's own account with a third party, never a fleet-listed vendor.
    is_custom = True

    def __init__(self, token: str | None = None, fetch=None):
        self._token = token
        self._fetch = fetch or _http_get
        self._lock = threading.Lock()
        self._catalog: tuple[float, list[Instrument]] | None = None

    def token(self) -> str | None:
        # Read through rather than captured at construction: the settings
        # screen writes the token while the terminal is running, and a
        # provider built at boot would otherwise never see it.
        return self._token or cfg.get_brapi_token()

    def configured(self) -> bool:
        return bool(self.token())

    # ── catalog ─────────────────────────────────────────────────────────

    def search(self, query: str = "", limit: int = 50) -> list[Instrument]:
        q = query.strip().upper()
        rows = self._catalog_rows()
        if q:
            rows = [i for i in rows if q in i.symbol.upper() or q in i.name.upper()]
        return rows[: max(1, int(limit))]

    def _catalog_rows(self) -> list[Instrument]:
        with self._lock:
            hit = self._catalog
            if hit and time.time() - hit[0] < 3600:
                return hit[1]
        payload = self._get("quote/list", limit="10000")
        grouped: dict[str, list[Instrument]] = {}
        for row in payload.get("stocks") or []:
            symbol = row.get("stock")
            if not symbol:
                continue
            category = _CATEGORY.get((row.get("type"), row.get("subType")))
            if category is None:
                category = "B3 Índices" if row.get("type") == "index" else "B3 Outros"
            grouped.setdefault(category, []).append(Instrument(
                symbol=symbol, name=row.get("name") or symbol,
                category=category, provider=self.name,
                meta={"sector": row.get("sector") or ""}))
        for row in payload.get("indexes") or []:
            symbol = row.get("stock")
            if symbol:
                grouped.setdefault("B3 Índices", []).append(Instrument(
                    symbol=symbol, name=row.get("name") or symbol,
                    category="B3 Índices", provider=self.name))
        # Contiguous by category, in the order the sidebar should show them:
        # the contract says the UI renders this order verbatim.
        rows = [i for category in _CATEGORY_ORDER
                for i in sorted(grouped.pop(category, []), key=lambda x: x.symbol)]
        for leftover in grouped.values():
            rows.extend(sorted(leftover, key=lambda x: x.symbol))
        with self._lock:
            self._catalog = (time.time(), rows)
        return rows

    # ── candles ─────────────────────────────────────────────────────────

    def candles(self, symbol: str, timeframe: str, limit: int = 500,
                start: str | None = None, end: str | None = None) -> pd.DataFrame:
        if timeframe not in _TF_INTERVAL:
            raise ValueError(f"unsupported timeframe: {timeframe}")
        sym = symbol.strip().upper()
        payload = self._get(f"quote/{urllib.parse.quote(sym)}",
                            interval=_TF_INTERVAL[timeframe],
                            range=_range_for(timeframe, limit, start, end))
        results = payload.get("results") or []
        if not results:
            raise ValueError(f"brapi returned no result for {sym!r}")
        history = results[0].get("historicalDataPrice") or []
        df = _to_candles(history)
        if not len(df):
            raise ValueError(
                f"brapi has no {timeframe} history for {sym!r}"
                + ("" if self.configured() else
                   " (no token set: only brapi's sandbox tickers answer)"))
        if start:
            df = df[df["ts"] >= int(pd.Timestamp(start, tz="UTC").timestamp())]
        if end:
            df = df[df["ts"] <= int(pd.Timestamp(end, tz="UTC").timestamp())]
        n = max(1, int(limit))
        df = df.head(n) if start else df.tail(n)
        return df[CANDLE_COLUMNS].reset_index(drop=True)

    # ── quote and stream ────────────────────────────────────────────────

    def quote(self, symbol: str) -> Quote:
        row = self._quote_rows([symbol.strip().upper()])
        if not row:
            raise NotSupported(f"brapi has no quote for {symbol!r}")
        return row[0]

    def _quote_rows(self, symbols: list[str]) -> list[Quote]:
        """Last price for up to a handful of symbols in one request.

        brapi takes a comma-separated list, which is what keeps a watchlist
        of twenty rows to one request per poll instead of twenty.
        """
        if not symbols:
            return []
        payload = self._get(f"quote/{urllib.parse.quote(','.join(symbols))}",
                            range="1d", interval="1d")
        out = []
        for r in payload.get("results") or []:
            price = r.get("regularMarketPrice")
            if r.get("symbol") is None or price is None:
                continue
            when = r.get("regularMarketTime")
            out.append(Quote(symbol=r["symbol"], price=float(price),
                             ts=_epoch(when)))
        return out

    async def stream(self, symbols: list[str]):
        """Polled ticks. brapi has no push feed and B3's prices are delayed,
        so this is a poll on a timer, batched into one request per round."""
        wanted = [s.strip().upper() for s in symbols if s and s.strip()]
        if not wanted:
            return
        while True:
            try:
                rows = await asyncio.to_thread(self._quote_rows, wanted)
            except Exception:
                # A poll that fails (quota, a blip) must not end the stream:
                # the next round is a few seconds away.
                rows = []
            for q in rows:
                yield {"symbol": q.symbol, "price": q.price, "ts": q.ts}
            await asyncio.sleep(_POLL_S)

    # ── http ────────────────────────────────────────────────────────────

    def _get(self, path: str, **params) -> dict:
        token = self.token()
        if token:
            params["token"] = token
        url = f"{BRAPI_URL}/{path}?{urllib.parse.urlencode(params)}"
        payload = json.loads(self._fetch(url))
        if isinstance(payload, dict) and payload.get("error"):
            message = payload.get("message") or "brapi refused the request"
            if payload.get("code") == "MISSING_TOKEN":
                raise NotSupported(
                    f"{message}. Add a free brapi.dev token in settings, or use "
                    f"the b3 source, which needs none.")
            raise ValueError(message)
        return payload


def _range_for(timeframe: str, limit: int, start: str | None,
               end: str | None) -> str:
    """The shortest brapi range that covers what was asked for.

    brapi takes a named range, not a date window, so an explicit start is
    turned into the days back from today it implies. The choice is then
    capped at what upstream actually keeps for that interval: minute bars
    go back days, hourly bars go back a couple of years, and naming a
    longer range than that only buys a slower request returning the same
    window.
    """
    if start:
        last = pd.Timestamp(end).date() if end else pd.Timestamp.utcnow().date()
        days = max(1, (last - pd.Timestamp(start).date()).days)
    else:
        # Round up: a bar count smaller than one range step still needs a
        # range, and a weekend must not leave it empty.
        days = max(1, int(max(1, int(limit)) * _BAR_DAYS[timeframe]) + 3)
    cap = _MAX_INTRADAY_DAYS.get(timeframe)
    allowed = [r for r in _RANGES if cap is None or r[1] <= cap] or _RANGES[:1]
    for name, covered in allowed:
        if covered >= days:
            return name
    return allowed[-1][0]


def _to_candles(history: list[dict]) -> pd.DataFrame:
    """brapi's ``historicalDataPrice`` rows as the candle frame."""
    if not history:
        return pd.DataFrame(columns=CANDLE_COLUMNS)
    frame = pd.DataFrame(history)
    for column in ("date", "open", "high", "low", "close"):
        if column not in frame.columns:
            return pd.DataFrame(columns=CANDLE_COLUMNS)
    out = pd.DataFrame({
        "ts": pd.to_numeric(frame["date"], errors="coerce").astype("Int64"),
        "open": pd.to_numeric(frame["open"], errors="coerce"),
        "high": pd.to_numeric(frame["high"], errors="coerce"),
        "low": pd.to_numeric(frame["low"], errors="coerce"),
        "close": pd.to_numeric(frame["close"], errors="coerce"),
        "volume": pd.to_numeric(frame.get("volume"), errors="coerce").fillna(0.0)
        if "volume" in frame.columns else 0.0,
    })
    # A bar with no trade comes back with nulls in the price fields; it is a
    # hole in the session, not a bar at zero.
    out = out.dropna(subset=["ts", "open", "high", "low", "close"])
    out["ts"] = out["ts"].astype("int64")
    out = out.drop_duplicates(subset="ts", keep="last").sort_values("ts")
    return out.reset_index(drop=True)


def _epoch(value) -> float:
    """brapi's ISO quote timestamp as epoch seconds, falling back to now."""
    try:
        return float(pd.Timestamp(value).timestamp())
    except Exception:
        return time.time()


def _http_get(url: str, timeout: float = 30.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "lse-terminal",
                                               "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        # brapi answers a missing token or an unknown ticker with a JSON body
        # on a 4xx; that body says more than the status code does, so it is
        # returned for the caller to read rather than raised as a bare error.
        body = e.read()
        if body.strip().startswith(b"{"):
            return body
        raise
