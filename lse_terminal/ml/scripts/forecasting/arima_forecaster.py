#!/usr/bin/env python3
"""
ARIMA/SARIMA Time Series Forecaster
=====================================
Fits ARIMA or SARIMA models to price data for multi-step forecasting.

Output format matches the LSE Terminal API contract:
  - Progress markers: [INFO], [TRAINING], [RESULTS], [DONE]
  - Final JSON block after '--- JSON RESULTS ---'
"""

import argparse
import json
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from utils import compute_features, fetch_dataset, save_model_weights
import os
import warnings
from datetime import datetime

import pandas as pd
import numpy as np

warnings.filterwarnings("ignore")


# Data fetching is handled in utils.py (reads the local dataset file)


def main(params: dict) -> dict:
    try:
        from statsmodels.tsa.arima.model import ARIMA
        from statsmodels.tsa.statespace.sarimax import SARIMAX
        HAS_STATSMODELS = True
    except ImportError:
        HAS_STATSMODELS = False
        print("[INFO] statsmodels not installed, using numpy AR fallback")

    from sklearn.metrics import mean_absolute_error, mean_squared_error

    print("=" * 60)
    print("ARIMA/SARIMA Time Series Forecaster")
    print("=" * 60)
    print(f"Started at: {datetime.now().isoformat()}")

    dataset = params.get('dataset', 'candles_15m')
    forecast_horizon = int(params.get("forecast_horizon", 30))
    test_size_pct = int(params.get("test_size", 20)) / 100
    p = int(params.get("p", 2))
    d = int(params.get("d", 1))
    q = int(params.get("q", 2))
    seasonal_p = int(params.get("seasonal_p", 0))
    seasonal_d = int(params.get("seasonal_d", 0))
    seasonal_q = int(params.get("seasonal_q", 0))
    seasonal_period = int(params.get("seasonal_period", 0))
    trend = params.get("trend", "c")
    auto_order = params.get("auto_order", "false") == "true"

    # Auto-adjust trend for compatibility with differencing
    total_d = d + seasonal_d
    if total_d > 0 and trend == "c":
        trend = "t"
    elif total_d > 1 and trend in ("c", "t"):
        trend = None

    print(f"\n[CONFIG] Dataset: {dataset}")
    print(f"[CONFIG] Forecast Horizon: {forecast_horizon}")
    print(f"[CONFIG] ARIMA Order: ({p},{d},{q})")
    if seasonal_period > 0:
        print(f"[CONFIG] Seasonal Order: ({seasonal_p},{seasonal_d},{seasonal_q},{seasonal_period})")
    print(f"[CONFIG] Auto-Select Orders: {auto_order}")

    # Fetch data
    df = fetch_dataset(dataset)
    series = df["close"].astype(float).values

    # Limit to last 5000 rows for speed on CPU
    if len(series) > 5000:
        print(f"[INFO] Trimming series from {len(series):,} to last 5,000 for performance")
        series = series[-5000:]

    # Train/test split
    split_idx = int(len(series) * (1 - test_size_pct))
    train = series[:split_idx]
    test = series[split_idx:]
    print(f"\n[INFO] Train size: {len(train):,}, Test size: {len(test):,}")
    sys.stdout.flush()

    if HAS_STATSMODELS:
        # === STATSMODELS PATH ===
        if auto_order:
            print("\n[TRAINING] Running Auto-ARIMA (AIC selection)...")
            sys.stdout.flush()
            try:
                from statsmodels.tsa.stattools import adfuller
                adf_result = adfuller(train, maxlag=20)
                if adf_result[1] > 0.05:
                    d = 1
                    print(f"[INFO] ADF p-value={adf_result[1]:.4f} > 0.05 -> d=1 (non-stationary)")
                else:
                    d = 0
                    print(f"[INFO] ADF p-value={adf_result[1]:.4f} <= 0.05 -> d=0 (stationary)")

                best_aic = float("inf")
                best_order = (p, d, q)
                candidates = [(pp, d, qq) for pp in range(0, 4) for qq in range(0, 4)]
                total = len(candidates)
                for i, order in enumerate(candidates):
                    try:
                        model = ARIMA(train, order=order, trend=trend)
                        fit = model.fit()
                        if fit.aic < best_aic:
                            best_aic = fit.aic
                            best_order = order
                    except:
                        pass
                    if (i + 1) % 4 == 0:
                        print(f"  [Search] {i+1}/{total} combinations tested...")
                        sys.stdout.flush()

                p, d, q = best_order
                print(f"[INFO] Best order: ({p},{d},{q}) with AIC={best_aic:.2f}")
            except Exception as e:
                print(f"[WARNING] Auto-ARIMA failed: {e}, using manual orders")
            sys.stdout.flush()

        print(f"\n[TRAINING] Fitting ARIMA({p},{d},{q})...")
        sys.stdout.flush()

        use_sarima = seasonal_period > 0 and (seasonal_p > 0 or seasonal_d > 0 or seasonal_q > 0)

        try:
            if use_sarima:
                seasonal_order = (seasonal_p, seasonal_d, seasonal_q, seasonal_period)
                print(f"[TRAINING] Using SARIMAX with seasonal order {seasonal_order}")
                model = SARIMAX(train, order=(p, d, q), seasonal_order=seasonal_order, trend=trend)
            else:
                model = ARIMA(train, order=(p, d, q), trend=trend)

            fit_result = model.fit()
            print(f"[INFO] Model fitted successfully")
            print(f"[INFO] AIC: {fit_result.aic:.2f}, BIC: {fit_result.bic:.2f}")
            sys.stdout.flush()
        except Exception as e:
            raise Exception(f"Model fitting failed: {e}")

        # Walk-forward evaluation
        print(f"\n[TRAINING] Walk-forward evaluation on {len(test)} test points...")
        sys.stdout.flush()

        predictions = []
        actuals = []
        history = list(train)
        eval_steps = min(len(test), forecast_horizon * 3, 50)

        for i in range(eval_steps):
            try:
                # Refit only every 5 steps for speed; reuse last forecast otherwise
                if i % 5 == 0:
                    model_eval = ARIMA(history, order=(p, d, q), trend=trend)
                    fit_eval = model_eval.fit()
                yhat = fit_eval.forecast(steps=1)[0]
                predictions.append(float(yhat))
                actuals.append(float(test[i]))
                history.append(test[i])
            except:
                predictions.append(float(history[-1]))
                actuals.append(float(test[i]))
                history.append(test[i])

            if (i + 1) % max(1, eval_steps // 10) == 0:
                print(f"  [Eval] Step {i+1}/{eval_steps}")
                print(f"[PROGRESS] {int(30 + (i+1) / eval_steps * 50)}")
                sys.stdout.flush()

        # Forecast future
        print(f"\n[TRAINING] Generating {forecast_horizon}-step forecast...")
        sys.stdout.flush()
        forecast = fit_result.forecast(steps=forecast_horizon)
        forecast_values = [float(v) for v in forecast]

        try:
            pred_summary = fit_result.get_forecast(steps=forecast_horizon).summary_frame()
            conf_lower = pred_summary["mean_ci_lower"].tolist()
            conf_upper = pred_summary["mean_ci_upper"].tolist()
        except:
            conf_lower = forecast_values
            conf_upper = forecast_values

        aic_val = round(float(fit_result.aic), 2)
        bic_val = round(float(fit_result.bic), 2)
    else:
        # === NUMPY FALLBACK: Simple AR(p) with differencing ===
        print(f"\n[TRAINING] Fitting AR({p}) with d={d} differencing (numpy fallback)...")
        sys.stdout.flush()

        # Apply differencing
        diffed = train.copy()
        for _ in range(d):
            diffed = np.diff(diffed)

        # Fit AR(p) using least squares
        ar_order = max(p, 1)
        X_ar = np.column_stack([diffed[ar_order - 1 - i:len(diffed) - 1 - i] for i in range(ar_order)])
        y_ar = diffed[ar_order:]

        # Solve normal equations: coeffs = (X^T X)^-1 X^T y
        try:
            coeffs = np.linalg.lstsq(X_ar, y_ar, rcond=None)[0]
        except:
            coeffs = np.zeros(ar_order)

        print(f"[INFO] AR coefficients: {[round(c, 6) for c in coeffs]}")

        # Walk-forward evaluation
        print(f"\n[TRAINING] Walk-forward evaluation...")
        sys.stdout.flush()

        predictions = []
        actuals = []
        history = list(train)
        eval_steps = min(len(test), forecast_horizon * 3, 200)

        for i in range(eval_steps):
            # Apply differencing to history
            h = np.array(history)
            dh = h.copy()
            for _ in range(d):
                dh = np.diff(dh)

            # Predict next diff
            last_vals = dh[-ar_order:][::-1]  # Most recent first
            pred_diff = float(np.dot(coeffs, last_vals))

            # Undo differencing
            yhat = history[-1] + pred_diff
            predictions.append(float(yhat))
            actuals.append(float(test[i]))
            history.append(test[i])

            if (i + 1) % max(1, eval_steps // 5) == 0:
                print(f"  [Eval] Step {i+1}/{eval_steps}")
                sys.stdout.flush()

        # Forecast future
        print(f"\n[TRAINING] Generating {forecast_horizon}-step forecast...")
        sys.stdout.flush()

        forecast_values = []
        fh = list(series)
        for step in range(forecast_horizon):
            h = np.array(fh)
            dh = h.copy()
            for _ in range(d):
                dh = np.diff(dh)
            last_vals = dh[-ar_order:][::-1]
            pred_diff = float(np.dot(coeffs, last_vals))
            yhat = fh[-1] + pred_diff
            forecast_values.append(float(yhat))
            fh.append(yhat)

        # Confidence intervals (simple ± std)
        residuals = np.array(predictions) - np.array(actuals)
        res_std = float(np.std(residuals)) if len(residuals) > 0 else 0
        conf_lower = [v - 1.96 * res_std for v in forecast_values]
        conf_upper = [v + 1.96 * res_std for v in forecast_values]

        aic_val = 0.0
        bic_val = 0.0

    # Metrics
    predictions_arr = np.array(predictions)
    actuals_arr = np.array(actuals)
    mae = float(mean_absolute_error(actuals_arr, predictions_arr))
    rmse = float(np.sqrt(mean_squared_error(actuals_arr, predictions_arr)))
    mape = float(np.mean(np.abs((actuals_arr - predictions_arr) / (actuals_arr + 1e-10))) * 100)

    # Direction accuracy
    if len(actuals) > 1:
        actual_dir = np.diff(actuals_arr) > 0
        pred_dir = np.diff(predictions_arr) > 0
        direction_accuracy = float(np.mean(actual_dir == pred_dir))
    else:
        direction_accuracy = 0.0

    print(f"\n[RESULTS] Model Performance:")
    print(f"  - MAE:  {mae:.4f}")
    print(f"  - RMSE: {rmse:.4f}")
    print(f"  - MAPE: {mape:.2f}%")
    print(f"  - Direction Accuracy: {direction_accuracy:.2%}")
    print(f"\n[RESULTS] Forecast (next {forecast_horizon} steps):")
    print(f"  - Current price: {series[-1]:.2f}")
    print(f"  - Forecast end:  {forecast_values[-1]:.2f}")
    print(f"  - Change:        {((forecast_values[-1] / series[-1]) - 1) * 100:.2f}%")

    use_sarima = seasonal_period > 0 and (seasonal_p > 0 or seasonal_d > 0 or seasonal_q > 0)

    results = {
        "metrics": {
            "mae": round(mae, 4),
            "rmse": round(rmse, 4),
            "mape": round(mape, 2),
            "direction_accuracy": round(direction_accuracy, 4),
            "aic": aic_val,
            "bic": bic_val,
        },
        "forecast": {
            "values": forecast_values,
            "confidence_lower": [float(v) for v in conf_lower],
            "confidence_upper": [float(v) for v in conf_upper],
            "current_price": float(series[-1]),
        },
        "config": {
            "dataset": dataset,
            "order": [p, d, q],
            "seasonal_order": [seasonal_p, seasonal_d, seasonal_q, seasonal_period] if use_sarima else None,
            "trend": trend,
            "auto_order": auto_order,
            "forecast_horizon": forecast_horizon,
            "train_size": len(train),
            "test_size": len(test),
            "mode": "statsmodels" if HAS_STATSMODELS else "numpy_ar_fallback",
        },
    }

    print(f"\n[DONE] Completed at: {datetime.now().isoformat()}")
    print("=" * 60)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ARIMA/SARIMA Forecaster")
    parser.add_argument("--dataset", type=str, default='candles_15m')
    parser.add_argument("--forecast_horizon", type=int, default=30)
    parser.add_argument("--test_size", type=int, default=20)
    parser.add_argument("--p", type=int, default=2)
    parser.add_argument("--d", type=int, default=1)
    parser.add_argument("--q", type=int, default=2)
    parser.add_argument("--seasonal_p", type=int, default=0)
    parser.add_argument("--seasonal_d", type=int, default=0)
    parser.add_argument("--seasonal_q", type=int, default=0)
    parser.add_argument("--seasonal_period", type=int, default=0)
    parser.add_argument("--trend", type=str, default="c")
    parser.add_argument("--auto_order", type=str, default="false")
    parser.add_argument("--start_date", type=str, default="")
    parser.add_argument("--end_date", type=str, default="")
    parser.add_argument("--features", type=str, nargs="*")
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()
    params = dict(vars(args))
    job_id = args.job_id if hasattr(args, "job_id") else ""
    params.pop("job_id", None)
    results = main(params)
    print("\n--- JSON RESULTS ---")
    # Save model weights if job_id provided
    if args.job_id:
        weight_path = save_model_weights(results, args.job_id, trained_model=None, metadata={
            "model_type": "ARIMA",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, indent=2))
    print("[/RESULTS_JSON]")
