#!/usr/bin/env python3
"""
PCA Factor Analysis - CPU Training Script
Loads OHLCV from the local dataset file, computes the selected feature set,
runs principal component analysis and emits a 3D projection of every bar
onto the three dominant components for the terminal's interactive 3D view.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from utils import fetch_ohlcv, compute_features, save_model_weights
import argparse, json, time, numpy as np, pandas as pd


def _epoch_seconds(ts):
    """Epoch seconds regardless of the Series' datetime64 unit. pandas 2.x
    keeps whatever resolution the source had ([s] for the terminal's export),
    so a bare astype('int64')/1e9 is wrong for anything but [ns]."""
    naive = ts.dt.tz_convert("UTC").dt.tz_localize(None) if ts.dt.tz is not None else ts
    return naive.to_numpy().astype("datetime64[s]").astype("int64")


def fetch_data(dataset, timeframe, start_date=None, end_date=None, limit=50000):
    """Load OHLCV via utils.fetch_ohlcv (local dataset file; raises if empty)."""
    return fetch_ohlcv(dataset, timeframe=timeframe, start_date=start_date,
                       end_date=end_date, limit=limit)


def run_model(df, args, feature_names):
    X_raw = df[feature_names].values.astype(float)
    close = df["close"].values.astype(float)
    ts = pd.to_datetime(df["timestamp"], utc=True)

    valid = ~np.isnan(X_raw).any(axis=1) & ~np.isinf(X_raw).any(axis=1)
    X_raw, close, ts = X_raw[valid], close[valid], ts[valid]
    n, p = X_raw.shape
    if n < 50:
        print(f"[ERROR] Only {n} clean rows after dropping NaN/inf; need at least 50.")
        sys.exit(1)

    # Standardize. Correlation basis (z-scores) is the default: raw feature
    # scales differ by orders of magnitude (price levels vs oscillators), so
    # covariance-basis PCA on unscaled features is dominated by whichever
    # column has the biggest units, not the strongest common factor.
    mu = X_raw.mean(axis=0)
    if args.basis == "covariance":
        Xc = X_raw - mu
        dropped_const = []
    else:
        sd = X_raw.std(axis=0)
        const = sd < 1e-12
        dropped_const = [f for f, c in zip(feature_names, const) if c]
        keep = ~const
        feature_names = [f for f, k in zip(feature_names, keep) if k]
        X_raw = X_raw[:, keep]
        mu, sd = mu[keep], sd[keep]
        Xc = (X_raw - mu) / sd
        p = Xc.shape[1]
    if dropped_const:
        print(f"[INFO] Dropped constant feature(s): {', '.join(dropped_const)}")
    if p < 3:
        print(f"[ERROR] PCA 3D needs at least 3 non-constant features; got {p}. "
              "Pick more features in BAKED FEATURES (e.g. momentum + volatility + returns).")
        sys.exit(1)

    print(f"[TRAINING] Eigendecomposition of the {p}x{p} {args.basis} matrix ({n} bars)...")
    C = (Xc.T @ Xc) / (n - 1)
    eigvals, eigvecs = np.linalg.eigh(C)
    order = np.argsort(eigvals)[::-1]
    eigvals = np.clip(eigvals[order], 0, None)
    eigvecs = eigvecs[:, order]

    total_var = float(eigvals.sum()) or 1.0
    var_ratio = eigvals / total_var

    # Deterministic sign: orient each PC so its largest-magnitude loading is
    # positive. Eigenvector signs are otherwise arbitrary and would flip the
    # 3D cloud between runs on the same data.
    for j in range(eigvecs.shape[1]):
        k = int(np.argmax(np.abs(eigvecs[:, j])))
        if eigvecs[k, j] < 0:
            eigvecs[:, j] = -eigvecs[:, j]

    scores = Xc @ eigvecs[:, :3]

    cum = np.cumsum(var_ratio)
    n90 = int(np.searchsorted(cum, 0.90) + 1)
    # Participation ratio: how many "effective" independent factors the
    # feature set really has (p if all equal, 1 if one factor explains all).
    eff_dim = float(eigvals.sum() ** 2 / (np.sum(eigvals ** 2) + 1e-12))

    for j in range(min(3, p)):
        top = np.argsort(np.abs(eigvecs[:, j]))[::-1][:3]
        drivers = ", ".join(f"{feature_names[i]} ({eigvecs[i, j]:+.2f})" for i in top)
        print(f"  PC{j+1}: {var_ratio[j]*100:.1f}% of variance; top loadings: {drivers}")

    # Point coloring for the 3D view.
    horizon = max(1, args.forward_horizon)
    if args.color_by == "time":
        cvals = _epoch_seconds(ts).astype(float)
        color_label = "time"
    elif args.color_by == "volume":
        vol = df["volume"].values.astype(float)[valid]
        vsd = vol.std() or 1.0
        cvals = (vol - vol.mean()) / vsd
        color_label = "volume z-score"
    else:
        fwd = np.full(n, np.nan)
        fwd[:-horizon] = (close[horizon:] / close[:-horizon] - 1.0) * 100.0
        cvals = fwd
        color_label = f"{horizon}-bar forward return %"

    # Even stride subsample, chronological order kept so the UI can draw the
    # market's recent trajectory through factor space as a trail.
    max_pts = max(200, args.max_points)
    idx = np.arange(n) if n <= max_pts else np.linspace(0, n - 1, max_pts).astype(int)
    epoch = _epoch_seconds(ts)

    pts = []
    for i in idx:
        c = cvals[i]
        pts.append([round(float(scores[i, 0]), 4), round(float(scores[i, 1]), 4),
                    round(float(scores[i, 2]), 4),
                    None if np.isnan(c) else round(float(c), 4),
                    int(epoch[i])])

    finite = cvals[~np.isnan(cvals)]
    if args.color_by == "forward_return" and len(finite):
        # Symmetric domain clipped at the 95th percentile of |value| so a few
        # outlier bars do not wash the whole cloud into the gray midpoint.
        lim = float(np.percentile(np.abs(finite), 95)) or 1.0
        domain = [-lim, lim]
        diverging = True
    elif len(finite):
        domain = [float(finite.min()), float(finite.max())]
        diverging = False
    else:
        domain, diverging = [0, 1], False

    loadings = {
        "features": feature_names,
        "pc1": [round(float(v), 4) for v in eigvecs[:, 0]],
        "pc2": [round(float(v), 4) for v in eigvecs[:, 1]],
        "pc3": [round(float(v), 4) for v in eigvecs[:, 2]],
    }

    return {
        "metrics": {
            "pc1_variance_pct": round(float(var_ratio[0] * 100), 2),
            "pc2_variance_pct": round(float(var_ratio[1] * 100), 2),
            "pc3_variance_pct": round(float(var_ratio[2] * 100), 2),
            "top3_variance_pct": round(float(cum[min(2, p - 1)] * 100), 2),
            "components_for_90pct": n90,
            "effective_dimensionality": round(eff_dim, 2),
            "features_used": p,
            "bars_analysed": n,
        },
        "explained_variance_pct": [round(float(v * 100), 3) for v in var_ratio[:min(10, p)]],
        "pca3d": {
            "points": pts,
            "axes": [{"label": f"PC{j+1}", "var_pct": round(float(var_ratio[j] * 100), 1)}
                     for j in range(3)],
            "color": {"label": color_label, "domain": domain, "diverging": diverging,
                      "mode": args.color_by},
            "loadings": loadings,
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PCA Factor Analysis")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--basis", default="correlation", choices=["correlation", "covariance"])
    parser.add_argument("--color_by", default="forward_return",
                        choices=["forward_return", "time", "volume"])
    parser.add_argument("--forward_horizon", type=int, default=10)
    parser.add_argument("--max_points", type=int, default=2000)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    print(f"[INFO] Starting PCA Factor Analysis...")
    print(f"[INFO] Dataset: {args.dataset}, Timeframe: {args.timeframe}")
    start_time = time.time()

    data = fetch_data(args.dataset, args.timeframe, args.start_date, args.end_date)
    print(f"[INFO] Loaded {len(data['close'])} data points")

    df = pd.DataFrame({"timestamp": data["timestamp"], "open": data["open"],
                       "high": data["high"], "low": data["low"],
                       "close": data["close"], "volume": data["volume"]})
    df = compute_features(df, args.features)
    feature_names = [f for f in args.features if f in df.columns and f != "timestamp"]
    print(f"[INFO] Feature matrix: {len(df)} rows x {len(feature_names)} features")

    results = run_model(df, args, feature_names)

    elapsed = time.time() - start_time
    results["config"] = {"dataset": args.dataset, "timeframe": args.timeframe,
                         "basis": args.basis, "color_by": args.color_by,
                         "data_points": int(len(df)), "training_time_s": round(elapsed, 2)}

    if args.job_id:
        weight_path = save_model_weights(results["pca3d"]["loadings"], args.job_id, metadata={
            "model_type": "PCA",
            "basis": args.basis,
            "explained_variance_pct": results["explained_variance_pct"],
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
    print(f"[INFO] Completed in {elapsed:.1f}s")
