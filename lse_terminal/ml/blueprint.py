"""
Code-first ML training for the BACKTEST > MACHINE LEARNING section.

A training run is a small Python script (a "blueprint") the user or the AI
agent can read, edit, and run:

    from lse_terminal.ml import blueprint

    run = blueprint.train(
        model="lstm_forecast",
        dataset="EURJPY_H1",          # MY DATA import or a built ML dataset
        timeframe="1h",
        bars=5000,
        features=["close", "volume", "rsi_14"],
        params={"epochs": 50, "sequence_length": 60},
    )
    blueprint.report(run)

train() resolves the dataset locally (nothing leaves this machine), runs the
packaged model script as a subprocess on this machine's CPU/GPU, streams its
log through, and returns the parsed results. Blueprints are executed by the
engine's ML job runner, but they are plain Python: they also run standalone
with the terminal's own interpreter.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from lse_terminal.ml import catalog
from lse_terminal.ml.env import python_argv

# Custom datasets built in the ML section (full frames: ts/OHLCV + any baked
# feature columns; MY DATA's importer strips non-OHLCV columns, so these get
# their own store).
def datasets_dir() -> Path:
    from lse_terminal.engine import config as cfg
    d = cfg.config_dir() / "ml" / "datasets"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _dataset_manifest_path() -> Path:
    return datasets_dir() / "manifest.json"


def list_datasets() -> List[Dict[str, Any]]:
    try:
        return list(json.loads(_dataset_manifest_path().read_text()).values())
    except (OSError, ValueError):
        return []


def _slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9:_-]", "_", name.strip()).strip("_")
    if not s:
        raise ValueError("dataset needs a name")
    return s


def build_dataset(
    name: str,
    source: str,
    timeframe: str = "1h",
    bars: int = 5000,
    start: Optional[str] = None,
    end: Optional[str] = None,
    features: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Compose a named training dataset from an imported MY DATA file:
    resample to `timeframe`, slice to the window, optionally bake feature
    columns in, and save under the ML dataset store.
    """
    from lse_terminal.providers import userdata

    df = userdata.UserDataProvider().candles(
        source, timeframe, limit=max(200, min(int(bars), 500_000)),
        start=start, end=end)
    if df is None or len(df) < 200:
        raise ValueError(
            f"'{source}' yields {0 if df is None else len(df)} bars at "
            f"{timeframe}; need at least 200. Import more history or widen "
            "the window.")

    out = df.rename(columns={"ts": "timestamp"})
    if features:
        bad = sorted(set(features) - set(catalog_feature_ids()))
        if bad:
            raise ValueError(f"unknown features: {', '.join(bad)}. "
                             f"Valid ids come from list_ml_models.")
        sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
        try:
            from utils import compute_features
        finally:
            sys.path.pop(0)
        feat = out.copy()
        feat["timestamp"] = pd.to_datetime(feat["timestamp"], unit="s", utc=True)
        feat = compute_features(feat, [f for f in features
                                       if f not in ("open", "high", "low",
                                                    "close", "volume")])
        # Back to epoch seconds resolution-safely: pandas 3 parses unit="s"
        # into datetime64[s], where astype(int64)//1e9 collapsed every
        # timestamp to ~1 and scrambled training row order on reload.
        # Timedelta floor-div is unit-independent.
        feat["timestamp"] = ((feat["timestamp"] - pd.Timestamp(0, tz="UTC"))
                             // pd.Timedelta(seconds=1))
        out = feat

    slug = _slug(name)
    path = datasets_dir() / f"{slug}.csv"
    out.to_csv(path, index=False)

    entry = {"name": slug, "source": source, "timeframe": timeframe,
             "rows": int(len(out)), "columns": list(out.columns),
             "start": start, "end": end, "features": features or [],
             "file": str(path)}
    try:
        manifest = json.loads(_dataset_manifest_path().read_text())
    except (OSError, ValueError):
        manifest = {}
    manifest[slug] = entry
    _dataset_manifest_path().write_text(json.dumps(manifest, indent=1))
    return entry


def catalog_feature_ids() -> List[str]:
    return [f["id"] for f in catalog.FEATURES]


def _resolve_dataset_frame(dataset: str, timeframe: str, bars: int,
                           start: Optional[str], end: Optional[str]) -> pd.DataFrame:
    """A built ML dataset by name, else a MY DATA import (resampled live)."""
    for entry in list_datasets():
        if entry["name"] == dataset:
            df = pd.read_csv(entry["file"])
            if len(df) > bars:
                df = df.iloc[-bars:].reset_index(drop=True)
            return df
    from lse_terminal.providers import userdata
    df = userdata.UserDataProvider().candles(
        dataset, timeframe, limit=max(200, min(int(bars), 500_000)),
        start=start, end=end)
    return df.rename(columns={"ts": "timestamp"})


def train(
    model: str,
    dataset: str,
    timeframe: str = "1h",
    bars: int = 5000,
    features: Optional[List[str]] = None,
    params: Optional[Dict[str, Any]] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    timeout_s: int = 1800,
) -> Dict[str, Any]:
    """Run one training locally and return {'results': ..., 'model': ...}."""
    spec = catalog.get_model(model)
    if spec is None:
        raise ValueError(f"unknown model '{model}'. Valid: "
                         + ", ".join(catalog.MODEL_KEYS))
    valid_params = {p["id"]: p for p in spec.get("params", [])}
    params = params or {}
    bad = sorted(set(params) - set(valid_params))
    if bad:
        raise ValueError(
            f"{model} does not take: {', '.join(bad)}. Valid parameters: "
            + ", ".join(sorted(valid_params)))

    df = _resolve_dataset_frame(dataset, timeframe, bars, start, end)
    if df is None or len(df) < 200:
        raise ValueError(f"dataset '{dataset}' yields "
                         f"{0 if df is None else len(df)} rows; need >= 200")

    scripts_dir = Path(__file__).resolve().parent / "scripts"
    work = Path(tempfile.mkdtemp(prefix="lse-ml-bp-"))
    data_file = work / "data.csv"
    df.to_csv(data_file, index=False)

    env = dict(os.environ)
    env["LSE_ML_DATA_FILE"] = str(data_file)
    env.setdefault("LSE_ML_WEIGHTS_DIR", str(datasets_dir().parent / "weights"))
    env["PYTHONUNBUFFERED"] = "1"

    # python_argv, not a bare sys.executable: in the frozen desktop build
    # the latter is the lset app itself and exits 2 on any script argv.
    cmd = python_argv(scripts_dir / spec["script"],
                      "--dataset", dataset, "--timeframe", timeframe)
    for key, value in params.items():
        if valid_params[key].get("type") in ("boolean", "toggle"):
            cmd += [f"--{key}",
                    "true" if value in (True, "true", "True", 1) else "false"]
        else:
            cmd += [f"--{key}", str(value)]
    if features and spec.get("features_arg"):
        cmd += ["--features", *[str(f) for f in features]]

    print(f"[BLUEPRINT] {spec['name']} on {dataset} "
          f"({len(df):,} rows x {len(df.columns)} cols)")
    sys.stdout.flush()

    # Stream the model script's log through verbatim, INCLUDING its
    # [RESULTS_JSON] block: when a blueprint runs under the engine's job
    # runner, the runner parses that block for the results pane.
    # The whole run is fenced so the work dir (dataset CSV + artifacts the
    # script drops into cwd, e.g. catboost_info/) is removed on every exit
    # path; without it each RUN leaked a bars-sized directory into /tmp
    # (runner.py always cleaned its job dirs, this path never did).
    # encoding stated: the child writes UTF-8 (cli._utf8_streams), and a
    # locale-decoded pipe on Windows would raise on the first non-cp1252
    # character instead of showing it.
    proc = subprocess.Popen(cmd, cwd=str(work), env=env, text=True,
                            encoding="utf-8", errors="replace",
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            bufsize=1)
    in_results, buf = False, []
    assert proc.stdout is not None
    try:
        try:
            for line in proc.stdout:
                line = line.rstrip("\n")
                print(line)
                sys.stdout.flush()
                if line == "[RESULTS_JSON]":
                    in_results = True
                elif line == "[/RESULTS_JSON]":
                    in_results = False
                elif in_results:
                    buf.append(line)
            rc = proc.wait(timeout=timeout_s)
        finally:
            if proc.poll() is None:
                proc.kill()
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if rc != 0:
        raise RuntimeError(f"{model} training exited with code {rc}; "
                           "see the log above")
    results = json.loads("\n".join(buf)) if buf else None
    return {"model": model, "dataset": dataset, "results": results}


def report(run: Dict[str, Any]) -> None:
    """Human summary of a train() return; full detail is in the results pane."""
    res = run.get("results") or {}
    metrics = res.get("metrics") if isinstance(res, dict) else None
    print(f"[BLUEPRINT] {run.get('model')} on {run.get('dataset')}: done")
    if isinstance(metrics, dict):
        for k, v in list(metrics.items())[:12]:
            print(f"  {k}: {v}")
    sys.stdout.flush()


# ── Code generation: the settings schema rendered as a runnable script ──

def generate_code(model_key: str, dataset: str = "", timeframe: str = "1h",
                  bars: int = 5000) -> str:
    """The blueprint template for a model: every parameter spelled out with
    its default, ready for a human or the AI agent to edit and run."""
    spec = catalog.get_model(model_key)
    if spec is None:
        raise ValueError(f"unknown model '{model_key}'")
    lines = [
        f"# {spec['name']}: {spec['description']}",
        "# Edit anything below, then RUN. The AI assistant can rewrite this",
        "# blueprint for you: it knows every model and parameter.",
        "from lse_terminal.ml import blueprint",
        "",
        "run = blueprint.train(",
        f"    model={spec['key']!r},",
        f"    dataset={dataset or 'YOUR_DATASET'!r},   # a MY DATA import or a built dataset",
        f"    timeframe={timeframe!r},",
        f"    bars={int(bars)},",
    ]
    if spec.get("features_arg"):
        lines.append('    features=["open", "high", "low", "close", "volume"],')
    if spec.get("params"):
        lines.append("    params=dict(")
        for p in spec["params"]:
            default = p.get("default")
            if p.get("type") in ("boolean", "toggle"):
                value = "True" if default in (True, "true") else "False"
            elif isinstance(default, str):
                value = repr(default)
            else:
                value = repr(default) if default is not None else "None"
            label = p.get("label", p["id"])
            opts = p.get("options")
            hint = (" | ".join(str(o.get("value", o)) if isinstance(o, dict)
                               else str(o) for o in opts)
                    if opts else label)
            lines.append(f"        {p['id']}={value},  # {hint}")
        lines.append("    ),")
    lines += [")", "", "blueprint.report(run)", ""]
    return "\n".join(lines)
