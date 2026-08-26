import json

import pytest
from fastapi.testclient import TestClient

from lse_terminal.engine.server import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Point config at a sandbox and hide any real key so `lse` shows
    # unconfigured; tests must never touch the developer's real config.
    monkeypatch.setenv("LSE_TERMINAL_CONFIG_DIR", str(tmp_path))
    monkeypatch.delenv("LSE_API_KEY", raising=False)
    return TestClient(create_app(), base_url="http://127.0.0.1")


def test_health(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True


def test_providers_listing(client):
    provs = {p["name"]: p for p in client.get("/api/providers").json()}
    assert provs["demo"]["configured"] is True
    assert provs["lse"]["configured"] is False
    assert "stream" in provs["demo"]["capabilities"]


def test_instruments_and_candles_with_indicators(client):
    items = client.get("/api/instruments",
                       params={"provider": "demo", "query": "btc"}).json()
    assert items[0]["symbol"] == "DEMO:BTC"

    r = client.get("/api/candles", params={
        "provider": "demo", "symbol": "DEMO:BTC", "timeframe": "1h",
        "limit": 100, "indicators": "sma:length=20,rsi:length=14",
    }).json()
    assert len(r["candles"]) == 100
    assert len(r["candles"][0]) == 6
    labels = set(r["indicators"])
    assert labels == {"sma(length=20)", "rsi(length=14)"}
    sma = r["indicators"]["sma(length=20)"]
    assert sma["overlay"] is True
    assert set(sma["series"]) == {"sma"}
    assert sma["series"]["sma"]["kind"] == "line"
    # NaN warmup rows are dropped from indicator points, never nulls
    assert all(v is not None for _, v in sma["series"]["sma"]["points"])
    assert r["indicators"]["rsi(length=14)"]["overlay"] is False


def test_error_paths(client):
    assert client.get("/api/candles", params={
        "provider": "nope", "symbol": "X", "timeframe": "1h"}).status_code == 404
    assert client.get("/api/candles", params={
        "provider": "demo", "symbol": "DEMO:BTC", "timeframe": "1h",
        "indicators": "bogus:length=1"}).status_code == 400


def test_key_save_configures_lse(client, tmp_path, monkeypatch):
    # The endpoint now proves a key against the live gate before storing it,
    # so a dummy key would really be refused. This test is about "a saved key
    # configures the provider", not about the gate, hence the stub. The
    # refusal path has its own test below.
    import lse_terminal.providers.lse as lse_mod
    monkeypatch.setattr(lse_mod, "verify_key", lambda k, timeout=8.0: (True, "ok"))
    assert client.post("/api/config/lse_key", json={"key": "  "}).status_code == 400
    assert client.post("/api/config/lse_key",
                       json={"key": "test-key-123"}).status_code == 200
    cfg = json.loads((tmp_path / "config.json").read_text())
    assert cfg["lse_api_key"] == "test-key-123"
    provs = {p["name"]: p for p in client.get("/api/providers").json()}
    assert provs["lse"]["configured"] is True


def test_rejected_key_is_not_saved(client, tmp_path, monkeypatch):
    """A key the gate refuses must never reach config.json.

    lse_configured is merely bool(saved key) and MARKETS only shows the
    connect form while nothing is saved, so persisting a refused key used to
    strand the user on a live-looking tab where every call 401'd.
    """
    import lse_terminal.providers.lse as lse_mod
    monkeypatch.setattr(lse_mod, "verify_key",
                        lambda k, timeout=8.0: (False, "The LSE API rejected this key."))
    r = client.post("/api/config/lse_key", json={"key": "lse_live_bad"})
    assert r.status_code == 400
    assert "rejected" in r.json()["detail"]
    assert not (tmp_path / "config.json").exists()
    provs = {p["name"]: p for p in client.get("/api/providers").json()}
    assert provs["lse"]["configured"] is False


def test_offline_does_not_block_saving(client, tmp_path, monkeypatch):
    """No network is 'we could not ask', not 'the key is bad'."""
    import lse_terminal.providers.lse as lse_mod
    monkeypatch.setattr(lse_mod, "verify_key",
                        lambda k, timeout=8.0: (True, "unverified (URLError)"))
    assert client.post("/api/config/lse_key",
                       json={"key": "lse_live_offline"}).status_code == 200
    cfg = json.loads((tmp_path / "config.json").read_text())
    assert cfg["lse_api_key"] == "lse_live_offline"


def test_ws_streams_demo_ticks(client):
    # starlette's websocket_connect ignores base_url for the Host header,
    # so satisfy the local-only guard (c5d50f3) explicitly.
    with client.websocket_connect("/api/ws?provider=demo&symbols=DEMO:BTC,DEMO:VIX",
                                  headers={"host": "127.0.0.1"}) as ws:
        msg = ws.receive_json()
    assert msg["type"] == "tick"
    assert msg["symbol"] in ("DEMO:BTC", "DEMO:VIX")


def test_ui_served(client):
    page = client.get("/")
    assert page.status_code == 200
    assert "LSE Terminal" in page.text


# ── workspace: the user's chart work is stored in a file, not the browser ──


def test_workspace_starts_empty(client):
    assert client.get("/api/workspace").json() == {}


def test_workspace_round_trip_and_persists_to_disk(client, tmp_path):
    drawings = {"demo:BTC": [{"id": "d1", "type": "trend"}]}
    assert client.put("/api/workspace/drawings", json=drawings).json()["ok"] is True

    assert client.get("/api/workspace/drawings").json()["value"] == drawings
    # The point of the file: it is readable on disk, so a user can back it up
    # or move it to another machine.
    on_disk = json.loads((tmp_path / "workspace.json").read_text())
    assert on_disk["drawings"] == drawings


def test_workspace_sections_are_independent(client):
    client.put("/api/workspace/drawings", json={"a": [1]})
    client.put("/api/workspace/watchlist", json=["BTC", "ETH"])
    # Writing one section must not disturb another.
    assert client.get("/api/workspace/drawings").json()["value"] == {"a": [1]}
    assert client.get("/api/workspace/watchlist").json()["value"] == ["BTC", "ETH"]


def test_workspace_rejects_unknown_section(client):
    # Deny-by-default: an unknown key must not be able to grow the file.
    assert client.put("/api/workspace/evil", json={}).status_code == 404
    assert client.get("/api/workspace/evil").status_code == 404


def test_workspace_survives_a_corrupt_file(client, tmp_path):
    (tmp_path / "workspace.json").write_text("{not json")
    # A hand-mangled file must degrade to "nothing saved", never 500 the chart.
    assert client.get("/api/workspace").json() == {}
    assert client.put("/api/workspace/watchlist", json=["OK"]).status_code == 200
    assert client.get("/api/workspace/watchlist").json()["value"] == ["OK"]


# ── indicator compute belongs to the user's machine, not ours ──────────────


def test_local_mode_computes_indicators(client):
    """A downloaded terminal computes on the user's own CPU, so it does the work."""
    body = client.get("/api/candles", params={
        "provider": "demo", "symbol": "DEMO:BTC", "timeframe": "1h",
        "limit": 200, "indicators": "sma,rsi",
    }).json()
    assert set(body["indicators"]) == {"sma", "rsi"}
    assert body["indicators"]["sma"]["series"]["sma"]["points"]


def test_hosted_mode_does_not_compute_indicators_on_our_cpu(tmp_path, monkeypatch):
    """Hosted mode serves many visitors from shared hardware, so indicator
    maths is left to the browser (which is the visitor's own CPU) instead of
    being computed per-request on the server."""
    monkeypatch.setenv("LSE_TERMINAL_CONFIG_DIR", str(tmp_path))
    monkeypatch.setenv("LSE_TERMINAL_HOSTED", "1")
    hosted_client = TestClient(create_app(), base_url="http://127.0.0.1")

    body = hosted_client.get("/api/candles", params={
        "provider": "demo", "symbol": "DEMO:BTC", "timeframe": "1h",
        "limit": 200, "indicators": "sma,rsi",
    }).json()
    # Candles still serve; only the indicator maths is declined.
    assert len(body["candles"]) > 0
    assert body["indicators"] == {}


# ── broker connections (brue-connect) ──────────────────────────────────────
# A broker is a subprocess on the user's own machine, so these exercise the
# bundled paper adapter rather than any network. The rules being pinned are the
# ones with a cost when they break: real money is never reached unarmed, and a
# hosted terminal offers no broker it cannot connect.

def _brokers(client):
    return {b["broker"]: b for b in client.get("/api/broker/list").json()}


def test_broker_list_names_each_broker_from_its_own_handshake(client):
    """The picker's rows come from the brokers, not from a table we ship."""
    assert client.post("/api/broker/probe", json={"broker": "paper-fast"}).is_success
    row = _brokers(client)["paper-fast"]
    # The paper adapter's handshake supplies this; nothing in the terminal
    # hardcodes the display name.
    assert row["identity"]["display_name"] == "Paper simulator"
    assert row["identity"]["mode"] == "paper"
    assert row["connected"] is False        # a name costs no session
    assert row["broker"] == "paper-fast"    # the user's own profile name


def test_probe_does_not_open_a_session(client):
    client.post("/api/broker/probe", json={"broker": "paper-fast"})
    assert _brokers(client)["paper-fast"]["connected"] is False


def test_paper_brokers_trade_without_arming(client):
    assert client.post("/api/broker/connect", json={"broker": "paper"}).is_success
    r = client.post("/api/broker/order", json={
        "broker": "paper", "symbol": "EURUSD", "side": "buy", "qty": 0.01})
    assert r.status_code == 200, r.text
    client.post("/api/broker/disconnect", json={"broker": "paper"})


def test_an_unknown_broker_is_a_404_not_a_crash(client):
    assert client.post("/api/broker/connect",
                       json={"broker": "nope"}).status_code == 404


def test_arming_is_required_for_anything_that_is_not_paper(tmp_path, monkeypatch):
    """SPEC section 3: a live adapter gets no mutating call until the user says
    so. Enforced in the ENGINE, not only in the dialog, because a cached or
    stale `paper` must never be able to authorise a live order.

    The rule itself belongs to brueconnect.Connector, so that one
    implementation is shared with the strategy runner and the brue package;
    what is tested here is that the terminal's path goes through it.

    The paper adapter is honest about being paper, so the live case is made by
    connecting it and then changing what the handshake says: the gate's only
    input is the broker's declared mode, which is exactly what is under test.
    """
    monkeypatch.setenv("LSE_TERMINAL_CONFIG_DIR", str(tmp_path))
    from lse_terminal.engine import broker_hub

    hub = broker_hub.BrokerHub(broker_hub.connect_base(None))
    # An unknown broker is never assumed safe.
    assert hub.is_paper("nobody-has-connected-this") is False
    with pytest.raises(KeyError):
        hub.arm("nobody-has-connected-this")

    hub.connect("paper")
    assert hub.is_paper("paper") is True
    hub.conns["paper"].handshake["mode"] = "live"
    assert hub.is_paper("paper") is False
    from brueconnect import NotArmed
    with pytest.raises(NotArmed):
        hub.order("paper", "EURUSD", "buy", 0.01)
    with pytest.raises(NotArmed):
        hub.close_position("paper", "whatever")

    armed = hub.arm("paper", True, "a test decided to")
    assert armed["armed"] is True and armed["reason"] == "a test decided to"
    hub.order("paper", "EURUSD", "buy", 0.01)  # armed: reaches the broker

    # Consent lives on the connection, so it cannot outlive it: reconnecting
    # to real money is a new decision by construction, with no cleanup step
    # for anyone to forget.
    hub.disconnect("paper")
    hub.connect("paper")
    assert hub.conns["paper"].armed is False
    hub.shutdown()


def test_hosted_mode_offers_no_brokers(tmp_path, monkeypatch):
    """Every other broker endpoint is local-only, so listing them in a hosted
    terminal would show rows that can never connect."""
    monkeypatch.setenv("LSE_TERMINAL_CONFIG_DIR", str(tmp_path))
    monkeypatch.setenv("LSE_TERMINAL_HOSTED", "1")
    hosted = TestClient(create_app(), base_url="http://127.0.0.1")
    assert hosted.get("/api/broker/list").status_code == 403
    assert hosted.post("/api/broker/arm",
                       json={"broker": "paper"}).status_code == 403
    assert hosted.get("/api/config").json()["hosted"] is True


def test_run_pin_contract():
    """The `# run:` pin: parsing and the pin-invariant code hash."""
    from lse_terminal.backtest.contract import parse_run_pin, run_pin_hash
    assert parse_run_pin("# run: EURUSD 1h\nimport pandas as pd\n") == {
        "symbol": "EURUSD", "timeframe": "1h"}
    # Spaced dataset symbols survive; a trailing timeframe token splits off.
    assert parse_run_pin("#run-on: US Large Caps 20\nx")["symbol"] == \
        "US Large Caps 20"
    assert parse_run_pin("# run: GOLD")["timeframe"] is None
    assert parse_run_pin("import x\n# just a comment") is None
    # A `# run:` line buried past the header never retargets a run.
    assert parse_run_pin("\n" * 20 + "# run: GOLD") is None
    # Hash ignores the pin line and whitespace: a stamped script still
    # matches the unstamped run that vouched for it.
    a = run_pin_hash("import pandas\ntrades = []")
    assert run_pin_hash("# run: EURUSD 1h\nimport pandas\ntrades = []  ") == a
    assert run_pin_hash("import numpy\ntrades = []") != a


def test_assistant_stamp(client, tmp_path):
    """The handoff stamp: unknown code passes through, a recorded tested
    run pins the delivered block, a pinned block is left alone."""
    from lse_terminal.backtest.contract import run_pin_hash
    code = "import pandas as pd\ntrades = []\n"
    r = client.post("/api/assistant/stamp", json={"script": code}).json()
    assert r["source"] is None and r["script"] == code

    ws = tmp_path / "ai-workspace"
    ws.mkdir(exist_ok=True)
    (ws / "tested_runs.json").write_text(json.dumps(
        [{"hash": run_pin_hash(code), "symbol": "EURUSD", "timeframe": "1h",
          "trades": 151, "net_profit": 986.75, "ts": 1}]))
    r = client.post("/api/assistant/stamp", json={"script": code}).json()
    assert r["source"] == "tested" and r["symbol"] == "EURUSD"
    assert r["script"].startswith("# run: EURUSD 1h\n")

    r2 = client.post("/api/assistant/stamp",
                     json={"script": r["script"]}).json()
    assert r2["source"] == "pin" and r2["script"] == r["script"]


def test_assistant_stamp_denied_hosted(tmp_path, monkeypatch):
    monkeypatch.setenv("LSE_TERMINAL_CONFIG_DIR", str(tmp_path))
    monkeypatch.setenv("LSE_TERMINAL_HOSTED", "1")
    hosted = TestClient(create_app(), base_url="http://127.0.0.1")
    assert hosted.post("/api/assistant/stamp",
                       json={"script": "x"}).status_code == 403
