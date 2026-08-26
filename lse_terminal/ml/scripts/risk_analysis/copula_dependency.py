#!/usr/bin/env python3
"""
Copula Dependency Model - CPU Training Script
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
    high, low = data["high"], data["low"]
    n = len(close)
    returns = np.diff(np.log(close))

    # Create pseudo multi-asset returns from different transformations
    ret_close = returns
    ret_hl = np.diff(np.log(high / low))
    ret_vol = np.diff(np.log(data["volume"] + 1))

    # Ensure all arrays are the same length
    min_len = min(len(ret_close), len(ret_hl), len(ret_vol))
    ret_close = ret_close[:min_len]
    ret_hl = ret_hl[:min_len]
    ret_vol = ret_vol[:min_len]

    from scipy import stats

    # Rank transform to uniform marginals (empirical copula)
    def to_uniform(x):
        ranks = stats.rankdata(x)
        return ranks / (len(ranks) + 1)

    u1 = to_uniform(ret_close)
    u2 = to_uniform(ret_hl)
    u3 = to_uniform(ret_vol)

    U = np.column_stack([u1, u2, u3])

    # Correlation matrix
    corr = np.corrcoef(U.T)

    # Kendall tau and Spearman rho
    tau_12, _ = stats.kendalltau(U[:, 0], U[:, 1])
    tau_13, _ = stats.kendalltau(U[:, 0], U[:, 2])
    rho_12, _ = stats.spearmanr(U[:, 0], U[:, 1])

    # Tail dependence (empirical)
    q = 0.05
    lower_tail = np.mean((U[:, 0] < q) & (U[:, 1] < q)) / q
    upper_tail = np.mean((U[:, 0] > 1-q) & (U[:, 1] > 1-q)) / q

    return {
        "metrics": {
            "kendall_tau_price_range": float(tau_12),
            "kendall_tau_price_volume": float(tau_13),
            "spearman_rho": float(rho_12),
            "lower_tail_dependence": float(lower_tail),
            "upper_tail_dependence": float(upper_tail),
            "correlation_price_range": float(corr[0, 1]),
            "correlation_price_volume": float(corr[0, 2]),
            "copula_type": args.copula_type,
        },
        "distribution": {
            "marginal_1_mean": float(np.mean(ret_close)),
            "marginal_1_std": float(np.std(ret_close)),
            "marginal_2_mean": float(np.mean(ret_hl)),
            "marginal_2_std": float(np.std(ret_hl)),
        }
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Copula Dependency Model")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--copula_type", default="gaussian")
    parser.add_argument("--num_assets", type=int, default=3)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    print(f"[INFO] Starting Copula Dependency Model...")
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
            "model_type": "Copula",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
    print(f"[INFO] Completed in {elapsed:.1f}s")
