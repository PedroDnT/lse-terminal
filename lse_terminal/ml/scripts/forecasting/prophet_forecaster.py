#!/usr/bin/env python3
"""
Prophet Forecast - CPU Training Script
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
    horizon = args.forecast_horizon

    # Decompose into trend + seasonal + residual using moving averages
    # (Pure NumPy Prophet-like decomposition without the prophet library)
    n = len(close)
    window = min(60, n // 5)

    # Trend extraction via moving average
    trend = np.convolve(close, np.ones(window)/window, mode="same")
    detrended = close / (trend + 1e-8)

    # Seasonal component (periodic patterns)
    period = min(60, n // 10)
    seasonal = np.zeros(n)
    for i in range(period):
        indices = list(range(i, n, period))
        seasonal[indices] = np.mean(detrended[indices]) if indices else 1.0

    # Residual
    residual = close / ((trend * seasonal) + 1e-8)

    # Forecast trend using linear regression on recent data
    recent = min(500, n)
    x = np.arange(recent)
    t_recent = trend[-recent:]
    slope = np.polyfit(x, t_recent, 1)
    future_x = np.arange(recent, recent + horizon)
    trend_forecast = np.polyval(slope, future_x)

    # Extend seasonal pattern
    seasonal_forecast = np.array([seasonal[-(period - i % period)] for i in range(horizon)])

    # Final forecast
    forecast_values = trend_forecast * seasonal_forecast

    # Confidence intervals
    std = np.std(residual[-recent:])
    upper = forecast_values * (1 + 1.96 * std)
    lower = forecast_values * (1 - 1.96 * std)

    # Metrics on holdout
    holdout = min(horizon, n // 5)
    train_close = close[:-holdout]
    test_close = close[-holdout:]

    t_train = np.convolve(train_close, np.ones(window)/window, mode="same")
    x_t = np.arange(len(train_close))
    slope_t = np.polyfit(x_t[-recent:], t_train[-recent:], 1)
    fx = np.arange(len(train_close), len(train_close) + holdout)
    pred_holdout = np.polyval(slope_t, fx)

    mae = float(np.mean(np.abs(pred_holdout[:len(test_close)] - test_close)))
    mape = float(np.mean(np.abs((test_close - pred_holdout[:len(test_close)]) / (test_close + 1e-8))) * 100)

    return {
        "metrics": {"mae": mae, "mape": mape, "trend_slope": float(slope[0]),
                    "seasonality_strength": float(np.std(seasonal)), "residual_std": float(std)},
        "forecast": {"current_price": float(close[-1]), "values": forecast_values.tolist(),
                     "upper_bound": upper.tolist(), "lower_bound": lower.tolist(),
                     "horizon": horizon, "model": f"prophet_{args.growth}"}
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prophet Forecast")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--forecast_horizon", type=int, default=30)
    parser.add_argument("--growth", default="linear")
    parser.add_argument("--seasonality_mode", default="multiplicative")
    parser.add_argument("--changepoint_scale", type=float, default=0.05)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    print(f"[INFO] Starting Prophet Forecast...")
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
            "model_type": "Prophet",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
    print(f"[INFO] Completed in {elapsed:.1f}s")
