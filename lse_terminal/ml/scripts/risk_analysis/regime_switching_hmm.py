#!/usr/bin/env python3
"""
Regime Switching (HMM) - CPU Training Script
Loads OHLCV from the local dataset file, trains/runs the model, outputs JSON results.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from utils import compute_features, save_model_weights, fetch_ohlcv
import argparse, json, sys, time, numpy as np
from datetime import datetime

def fetch_data(dataset, timeframe, start_date=None, end_date=None, limit=5000):
    """Load OHLCV as numpy arrays via utils.fetch_ohlcv (local dataset file)."""
    # Delegates to utils so the data always comes from the file the terminal
    # exported (LSE_ML_DATA_FILE). A missing or empty file raises inside utils
    # on purpose: an earlier version fell back to synthetic prices, which
    # would silently produce fake training results on an end user's machine.
    return fetch_ohlcv(dataset, timeframe=timeframe, start_date=start_date,
                       end_date=end_date, limit=limit)


def run_model(data, args):
    close = data["close"]
    returns = np.diff(np.log(close))
    n_regimes = args.n_regimes

    # Simple K-means based regime detection (no hmmlearn needed)
    # Compute rolling features
    window = 20
    n = len(returns)
    roll_mean = np.array([np.mean(returns[max(0,i-window):i+1]) for i in range(n)])
    roll_vol = np.array([np.std(returns[max(0,i-window):i+1]) for i in range(n)])

    X = np.column_stack([roll_mean, roll_vol])
    valid = ~np.isnan(X).any(axis=1)
    X = X[valid]

    # K-means clustering for regime detection
    from sklearn.cluster import KMeans
    kmeans = KMeans(n_clusters=n_regimes, random_state=42, n_init=10)
    labels = kmeans.fit_predict(X)

    # Sort regimes by volatility (low vol = 0, high vol = n-1)
    regime_vols = [np.mean(roll_vol[valid][labels == i]) for i in range(n_regimes)]
    sort_idx = np.argsort(regime_vols)
    label_map = {sort_idx[i]: i for i in range(n_regimes)}
    labels = np.array([label_map[l] for l in labels])

    regime_names = {0: "Low Volatility", 1: "Normal", 2: "High Volatility"} if n_regimes == 3 else {}

    # Transition matrix
    trans = np.zeros((n_regimes, n_regimes))
    for i in range(len(labels) - 1):
        trans[labels[i], labels[i+1]] += 1
    trans = trans / (trans.sum(axis=1, keepdims=True) + 1e-8)

    # Current regime
    current = int(labels[-1])

    # Regime statistics
    regime_stats = {}
    for r in range(n_regimes):
        mask = labels == r
        name = regime_names.get(r, f"Regime {r}")
        regime_stats[name] = {
            "mean_return": float(np.mean(roll_mean[valid][mask])),
            "mean_volatility": float(np.mean(roll_vol[valid][mask])),
            "proportion": float(np.mean(mask)),
            "avg_duration": float(len(mask) / (np.sum(np.diff(mask.astype(int)) != 0) + 1)),
        }

    return {
        "metrics": {
            "current_regime": regime_names.get(current, f"Regime {current}"),
            "current_regime_id": current,
            "n_regimes": n_regimes,
            "regime_stability": float(np.max(trans[current])),
        },
        "regimes": regime_stats,
        "transition_matrix": trans.tolist(),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Regime Switching (HMM)")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--n_regimes", type=int, default=3)
    parser.add_argument("--n_iterations", type=int, default=100)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    print(f"[INFO] Starting Regime Switching (HMM)...")
    print(f"[INFO] Dataset: {args.dataset}, Timeframe: {args.timeframe}")
    start_time = time.time()

    data = fetch_data(args.dataset, args.timeframe, args.start_date, args.end_date)
    print(f"[INFO] Loaded {len(data['close'])} data points")

    print("[TRAINING] Running model...")
    results = run_model(data, args)

    elapsed = time.time() - start_time
    results["config"] = {"dataset": args.dataset, "timeframe": args.timeframe,
                         "data_points": int(len(data["close"])), "training_time_s": round(elapsed, 2)}

    # Save model weights if job_id provided
    if args.job_id:
        weight_path = save_model_weights(results, args.job_id, metadata={
            "model_type": "HMM",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
    print(f"[INFO] Completed in {elapsed:.1f}s")
