# Brazil: B3 data and the trading question

Three data sources ship with the terminal for the Brazilian market, and
none of them needs an account to be useful. This page says what each one
covers, what it does not, and where order routing stands.

## The sources

| Source | Name in the app | Key needed | What it serves |
| --- | --- | --- | --- |
| `b3` | B3 (Brasil, Bolsa, Balcão) | none | Official end-of-day history for the cash segment, back to 1986; the current session minute by minute; delayed quotes |
| `bcb` | Banco Central do Brasil (macro) | none | Selic, CDI, IPCA, IGP-M, PTAX, IBC-Br and friends, back to the 1990s |
| `brapi` | B3 via brapi.dev | free token | Per-symbol daily and intraday history in one small request |

They are complements, not alternatives. `b3` is the exchange's own
numbers and is the one to reconcile against. `brapi` is the one that
answers a chart quickly. `bcb` is the one a Brazilian backtest needs to
have a risk-free rate at all.

### `b3` — the exchange's own files

Two public sources, neither of which asks who is calling:

* **COTAHIST** (`bvmf.bmfbovespa.com.br/InstDados/SerHist`) is B3's
  official end-of-day series: one fixed-width record per instrument per
  session, published as daily, monthly and yearly ZIPs, with a true
  open/high/low/close and traded quantity. Daily bars come from here, and
  the most recent daily file also builds the instrument catalog.
* **`cotacao.b3.com.br`** is the JSON feed behind B3's own quote pages. It
  gives a last price for any listed symbol and the current session's
  minute prints, and unlike COTAHIST it answers for BM&F contracts and the
  indices too.

Downloads are cached under `~/.config/lse-terminal/b3` and parsed once
into parquet. A daily request only fetches the grain it needs: a couple of
weeks of bars pulls individual sessions, a year pulls the yearly archive.

**Limits, stated up front.**

* Daily history exists for what COTAHIST carries — ações, units, ETFs,
  FIIs, Fiagro, BDRs, options. It does **not** carry BM&F futures, so
  `WINV26` and friends have quotes and today's intraday but no daily
  series. Asking for one says so rather than returning something invented.
* Intraday is the session in progress only, and B3's feed publishes a
  close per minute with no volume, so a 1m bar is that print in all four
  OHLC slots and the volume pane is empty. Wider bars (5m, 15m, 1h) are
  real OHLC built from the minutes inside them.
* Quotes are B3's public feed, delayed roughly 15 minutes, with no book —
  so no bid and no ask.
* The first deep history request is slow: a yearly COTAHIST archive is
  about 90 MB. It happens once per year of history, then it is on disk.

Catalog and futures codes are derived, not hardcoded: front-month
contracts follow B3's own roll rules (index futures on the Wednesday
nearest the 15th of even months, dollar futures monthly), so `WIN`, `IND`,
`WDO` and `DOL` always name the live contract.

### `bcb` — the central bank's series

The SGS open API, no key. Fourteen series grouped as juros, câmbio,
inflação and atividade: the Selic target and its 252-day annualisation,
the CDI (which is the risk-free leg of essentially every Brazilian
backtest), IPCA monthly and 12-month, IGP-M, the PTAX dollar and euro,
IBC-Br, monthly GDP and the unemployment rate.

Each series is presented as candles with the value in all four OHLC slots.
That is not a disguise — a policy rate has one number per print, and the
candle shape is what lets the chart, the indicator stack and the
backtester read it with no special case. Volume is zero because a rate has
none.

Frequency belongs to the series, not the request: a monthly series asked
for on the daily timeframe returns its monthly prints and draws as a
sparser line. Series are cached to `~/.config/lse-terminal/bcb`, because
every SGS request costs about twenty seconds regardless of how much data
it returns.

### `brapi` — with your own free token

[brapi.dev](https://brapi.dev) is a Brazilian API that answers per symbol:
years of daily bars, or weeks of intraday, in one small request. That is
the gap `b3` leaves, so it is worth the token.

Set it with `BRAPI_TOKEN` in the environment, or `brapi_token` in
`~/.config/lse-terminal/config.json`. Without one the source still answers
for brapi's public sandbox tickers (PETR4, VALE3, ITUB4, MGLU3), which is
enough to see what it does before registering.

Its catalog is richer than COTAHIST's — full company names rather than
12-character abbreviations, and a listing type per row. Its intraday
history is shallow at the fine end (minutes go back days, hours go back
about two years), and the terminal caps each request at what upstream
actually keeps rather than asking for a window that comes back short.

## Using them

Everything works through the normal surfaces — pick the source in MARKETS,
chart a symbol, run a backtest against it. From a strategy or the
assistant, the provider name is what selects the source:

```
GET /api/instruments?provider=b3&query=PETR
GET /api/candles?provider=b3&symbol=PETR4&timeframe=1d&limit=500
GET /api/candles?provider=bcb&symbol=BCB:CDI&timeframe=1d&limit=2000
GET /api/candles?provider=brapi&symbol=WEGE3&timeframe=15m&limit=500
```

To use a Brazilian macro series as alternative data in a backtest, import
it into MY DATA as a CSV — `use`/`data[...]` bindings read the user's own
library, not providers, so a `data["CDI"]` lookup wants a file.

## Trading: where order routing actually stands

No Brazilian broker adapter ships here yet, and this section is the
reason why rather than an oversight.

Orders in this terminal go through
[Brue Connect](https://github.com/londonstrategicedge/brue-connect): every
broker is an adapter process speaking that protocol, spawned by the hub in
`lse_terminal/engine/broker_hub.py`, and nothing in the terminal is
allowed to special-case a broker name. So "add a Brazilian broker" means
"write a brue-connect adapter", and it lands in that repository, not this
one. Once written, `brueconnect add <name> --command ...` makes it appear
in this terminal's connection picker with no change here at all.

The realistic routes, in the order they are worth attempting:

1. **MetaTrader 5.** The widest coverage by a distance: essentially every
   large Brazilian broker offers MT5 with B3 routing, and one adapter
   serves all of them. MetaQuotes publishes an official Python package,
   which fits how the hub already works — it spawns adapters as Python
   subprocesses. Two real constraints: the package is Windows-only (Linux
   and macOS need a Wine bridge), and it drives a running, logged-in MT5
   terminal rather than talking to the broker directly, so the adapter
   depends on a desktop app being open. Best coverage per unit of work.

2. **Cedro Technologies.** The gateway that sits behind most of that MT5
   routing in the first place, offered directly as REST, WebSocket and FIX
   to B3. Cleanest technically — a real API with no desktop app in the
   loop — but it is a commercial B2B contract, so it is a route for a
   business relationship rather than something a user can self-serve.

3. **Nelogica ProfitDLL.** A Windows C API, widely used by Brazilian
   retail algo traders and reachable from Python through `ctypes`. Narrower
   than MT5 (one platform's users) and Windows-only, but no vendor
   contract needed.

4. **Crypto venues quoting BRL** (Mercado Bitcoin, Foxbit, Binance BRL).
   Public REST and WebSocket, keys the user issues themselves, no
   onboarding. Not equities, but it is the only route on this list where
   someone can go from nothing to live orders the same afternoon — which
   makes it the natural first adapter if the goal is to prove the path
   end to end.

The honest summary: B3 **data** is solved and free, and now shipped. B3
**execution** is gated by broker relationships rather than by engineering,
and MT5 is the way through that gate for a self-serve user.

## Sources and terms

COTAHIST and the `cotacao.b3.com.br` feed are published by B3 for public
download; the SGS API is published by the Banco Central as open data.
brapi.dev is a third party under its own terms, reached with the user's
own token. As everywhere else in this terminal, every request goes out
from the user's machine and nothing about the user goes with it.
