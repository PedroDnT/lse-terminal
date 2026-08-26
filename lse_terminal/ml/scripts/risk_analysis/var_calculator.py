#!/usr/bin/env python3
"""
Value at Risk (VaR) Calculator - CPU Training Script
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
    confidence = args.confidence / 100.0
    hp = args.holding_period

    # Scale returns to holding period
    if hp > 1:
        scaled_returns = np.array([np.sum(returns[i:i+hp]) for i in range(len(returns)-hp)])
    else:
        scaled_returns = returns

    # Historical VaR
    var_hist = -np.percentile(scaled_returns, (1 - confidence) * 100)
    cvar_hist = -np.mean(scaled_returns[scaled_returns <= -var_hist])

    # Parametric VaR (Gaussian)
    from scipy import stats
    mu = np.mean(scaled_returns)
    sigma = np.std(scaled_returns)
    z = stats.norm.ppf(1 - confidence)
    var_param = -(mu + z * sigma)
    cvar_param = -(mu - sigma * stats.norm.pdf(z) / (1 - confidence))

    # Cornish-Fisher VaR (adjusted for skewness/kurtosis)
    skew = float(stats.skew(scaled_returns))
    kurt = float(stats.kurtosis(scaled_returns))
    z_cf = z + (z**2 - 1) * skew / 6 + (z**3 - 3*z) * kurt / 24
    var_cf = -(mu + z_cf * sigma)

    pv = args.portfolio_value

    return {
        "metrics": {
            "var_historical": float(var_hist), "cvar_historical": float(cvar_hist),
            "var_parametric": float(var_param), "cvar_parametric": float(cvar_param),
            "var_cornish_fisher": float(var_cf),
            "var_dollar_hist": float(var_hist * pv), "cvar_dollar_hist": float(cvar_hist * pv),
            "daily_volatility": float(np.std(returns)), "annualised_vol": float(np.std(returns) * np.sqrt(252)),
            "skewness": skew, "kurtosis": kurt,
            "confidence_level": args.confidence, "holding_period": hp,
            "max_drawdown": float(np.min(np.minimum.accumulate(np.cumsum(returns)) - np.cumsum(returns))),
        },
        "distribution": {
            "mean_return": float(mu), "std_return": float(sigma),
            "min_return": float(np.min(scaled_returns)), "max_return": float(np.max(scaled_returns)),
            "percentile_1": float(np.percentile(scaled_returns, 1)),
            "percentile_5": float(np.percentile(scaled_returns, 5)),
            "percentile_95": float(np.percentile(scaled_returns, 95)),
            "percentile_99": float(np.percentile(scaled_returns, 99)),
        }
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Value at Risk (VaR) Calculator")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--confidence", type=float, default=95)
    parser.add_argument("--holding_period", type=int, default=1)
    parser.add_argument("--method", default="historical")
    parser.add_argument("--portfolio_value", type=float, default=100000)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    print(f"[INFO] Starting Value at Risk (VaR) Calculator...")
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
            "model_type": "VaR",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
    print(f"[INFO] Completed in {elapsed:.1f}s")
