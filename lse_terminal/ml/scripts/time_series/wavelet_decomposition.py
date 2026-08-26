#!/usr/bin/env python3
"""
Wavelet Decomposition - CPU Training Script
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
    n = len(close)
    levels = args.levels

    # Manual Haar-like wavelet decomposition (no pywt needed)
    # Multi-resolution analysis using iterative filtering
    signal = close.copy()
    details = []
    approximations = []

    for level in range(levels):
        # Low-pass (approximation) and high-pass (detail)
        kernel_size = 2 ** (level + 1)
        if len(signal) < kernel_size * 2:
            break

        # Moving average as low-pass
        approx = np.convolve(signal, np.ones(kernel_size)/kernel_size, mode="same")
        detail = signal - approx

        details.append(detail)
        approximations.append(approx)
        signal = approx

        print(f"  Level {level+1}: detail energy={np.sum(detail**2):.2f}, approx energy={np.sum(approx**2):.2f}")

    # Energy distribution across levels
    total_energy = np.sum(close ** 2)
    detail_energies = [float(np.sum(d**2) / total_energy) for d in details]
    approx_energy = float(np.sum(approximations[-1]**2) / total_energy) if approximations else 0

    # Denoise: reconstruct without high-frequency detail
    denoised = approximations[-1] if approximations else close
    for d in details[1:]:  # Skip finest detail level
        denoised = denoised + d

    # Forecast using trend from approximation
    trend = approximations[-1] if approximations else close
    recent = min(100, len(trend))
    x = np.arange(recent)
    slope = np.polyfit(x, trend[-recent:], 1)
    forecast_x = np.arange(recent, recent + args.forecast_steps)
    forecast = np.polyval(slope, forecast_x)

    # Signal-to-noise ratio
    noise = details[0] if details else np.zeros_like(close)
    snr = 10 * np.log10(np.sum(denoised**2) / (np.sum(noise**2) + 1e-8))

    return {
        "metrics": {
            "decomposition_levels": len(details),
            "signal_to_noise_db": float(snr),
            "trend_slope": float(slope[0]),
            "denoised_vs_original_corr": float(np.corrcoef(close[-len(denoised):], denoised[-len(close):])[0, 1]),
            **{f"detail_{i+1}_energy_pct": e for i, e in enumerate(detail_energies)},
            "approximation_energy_pct": approx_energy,
        },
        "forecast": {
            "current_price": float(close[-1]),
            "values": forecast.tolist(),
            "horizon": args.forecast_steps,
            "model": f"wavelet_haar_L{len(details)}",
        }
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Wavelet Decomposition")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--wavelet", default="db4")
    parser.add_argument("--levels", type=int, default=4)
    parser.add_argument("--forecast_steps", type=int, default=10)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    print(f"[INFO] Starting Wavelet Decomposition...")
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
            "model_type": "Wavelet",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
    print(f"[INFO] Completed in {elapsed:.1f}s")
