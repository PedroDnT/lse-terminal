import pytest
from fastapi.testclient import TestClient

from lse_terminal.engine.server import create_app

GOOD = '''
from lse_terminal.contracts import indicator

@indicator("double_close", title="Double Close", params={})
def double_close(df):
    return df["close"] * 2
'''

GOOD_V2 = '''
from lse_terminal.contracts import indicator

@indicator("triple_close", title="Triple Close", params={})
def triple_close(df):
    return df["close"] * 3
'''

BROKEN = "this is not python at all ((("


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("LSE_TERMINAL_CONFIG_DIR", str(tmp_path))
    monkeypatch.delenv("LSE_API_KEY", raising=False)
    return TestClient(create_app(), base_url="http://127.0.0.1")


def names(client):
    return {s["name"] for s in client.get("/api/indicators").json()}


def test_template_is_valid_source(client):
    template = client.get("/api/user-indicators/template").json()["source"]
    r = client.post("/api/user-indicators/from_template.py",
                    json={"source": template}).json()
    assert r["ok"] is True
    assert r["names"] == ["my_indicator"]
    assert "my_indicator" in names(client)


def test_save_compute_and_reload(client):
    r = client.post("/api/user-indicators/mine.py", json={"source": GOOD}).json()
    assert r["ok"] is True and r["names"] == ["double_close"]

    # End to end: the user indicator computes through the candles endpoint.
    body = client.get("/api/candles", params={
        "provider": "demo", "symbol": "DEMO:BTC", "timeframe": "1h",
        "limit": 20, "indicators": "double_close",
    }).json()
    pts = body["indicators"]["double_close"]["series"]["double_close"]["points"]
    closes = {c[0]: c[4] for c in body["candles"]}
    assert all(abs(v - 2 * closes[t]) < 1e-9 for t, v in pts)

    # Reload with different content: old name must vanish, new must appear.
    r2 = client.post("/api/user-indicators/mine.py", json={"source": GOOD_V2}).json()
    assert r2["names"] == ["triple_close"]
    have = names(client)
    assert "triple_close" in have and "double_close" not in have


def test_broken_file_is_isolated(client):
    r = client.post("/api/user-indicators/broken.py", json={"source": BROKEN}).json()
    assert r["ok"] is False and "SyntaxError" in r["error"]
    listing = client.get("/api/user-indicators").json()
    entry = next(x for x in listing if x["file"] == "broken.py")
    assert entry["error"]
    # The terminal stays alive and built-ins are untouched.
    assert client.get("/api/health").json()["ok"] is True
    assert "sma" in names(client)


def test_delete_unregisters(client):
    client.post("/api/user-indicators/gone.py", json={"source": GOOD})
    assert "double_close" in names(client)
    client.delete("/api/user-indicators/gone.py")
    assert "double_close" not in names(client)
    assert client.get("/api/user-indicators/gone.py").status_code == 404


def test_bad_filenames_rejected(client):
    for bad in ["../evil.py", "no_extension", ".hidden.py", "a/b.py"]:
        r = client.post(f"/api/user-indicators/{bad.replace('/', '%2F')}",
                        json={"source": GOOD})
        # Rejection may be routing-level (404/405 after path normalization)
        # or manager-level (200 with ok=False); anything but a successful
        # write is correct.
        assert r.status_code in (200, 404, 405)
        if r.status_code == 200:
            assert r.json()["ok"] is False
