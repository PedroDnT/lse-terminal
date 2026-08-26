#!/usr/bin/env python3
"""
Kalman Filter - CPU Training Script
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
    # on purpose: the original script fell back to synthetic prices, which
    # would silently produce fake training results on an end user's machine.
    return fetch_ohlcv(dataset, timeframe=timeframe, start_date=start_date,
                       end_date=end_date, limit=limit)


def run_model(data, args):
    close = data["close"]
    n = len(close)
    Q = args.process_noise
    R = args.measurement_noise

    if args.model_type == "level_trend":
        # State: [level, trend]
        dim = 2
        F = np.array([[1, 1], [0, 1]])  # State transition
        H = np.array([[1, 0]])           # Observation
        x = np.array([close[0], 0.0])    # Initial state
        P = np.eye(dim) * 1.0            # Initial covariance
        Q_mat = np.eye(dim) * Q
        R_mat = np.array([[R]])
    else:
        dim = 1
        F = np.array([[1]])
        H = np.array([[1]])
        x = np.array([close[0]])
        P = np.eye(dim) * 1.0
        Q_mat = np.eye(dim) * Q
        R_mat = np.array([[R]])

    # Forward pass (filtering)
    filtered_states = []
    filtered_covs = []
    innovations = []

    for t in range(n):
        # Predict
        x_pred = F @ x
        P_pred = F @ P @ F.T + Q_mat

        # Update
        y_innov = close[t] - (H @ x_pred)[0]
        S = (H @ P_pred @ H.T + R_mat)[0, 0]
        K = P_pred @ H.T / S
        x = x_pred + (K * y_innov).flatten()
        P = (np.eye(dim) - K @ H) @ P_pred

        filtered_states.append(x.copy())
        filtered_covs.append(P.copy())
        innovations.append(y_innov)

    states = np.array(filtered_states)
    filtered_level = states[:, 0]

    # Smoothing (backward pass)
    if args.smoothing.lower() == "true" and n > 2:
        smoothed = states.copy()
        for t in range(n - 2, -1, -1):
            P_pred = F @ filtered_covs[t] @ F.T + Q_mat
            L = filtered_covs[t] @ F.T @ np.linalg.inv(P_pred)
            smoothed[t] = filtered_states[t] + L @ (smoothed[t+1] - F @ filtered_states[t])
        smoothed_level = smoothed[:, 0]
    else:
        smoothed_level = filtered_level

    # Forecast
    x_forecast = states[-1].copy()
    forecasts = []
    for step in range(args.forecast_steps):
        x_forecast = F @ x_forecast
        forecasts.append(float(x_forecast[0]))

    # Metrics
    mae = float(np.mean(np.abs(filtered_level - close)))
    rmse = float(np.sqrt(np.mean((filtered_level - close) ** 2)))
    innov_std = float(np.std(innovations))

    return {
        "metrics": {
            "mae": mae, "rmse": rmse,
            "innovation_std": innov_std,
            "process_noise": Q, "measurement_noise": R,
            "estimated_trend": float(states[-1, 1]) if dim == 2 else 0,
            "smoothing_applied": args.smoothing.lower() == "true",
        },
        "forecast": {
            "current_price": float(close[-1]),
            "values": forecasts,
            "horizon": args.forecast_steps,
            "model": f"kalman_{args.model_type}",
        }
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Kalman Filter")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--process_noise", type=float, default=0.01)
    parser.add_argument("--measurement_noise", type=float, default=0.1)
    parser.add_argument("--forecast_steps", type=int, default=10)
    parser.add_argument("--model_type", default="level_trend")
    parser.add_argument("--smoothing", type=str, default="true")
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    print(f"[INFO] Starting Kalman Filter...")
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
            "model_type": "KalmanFilter",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
    print(f"[INFO] Completed in {elapsed:.1f}s")
