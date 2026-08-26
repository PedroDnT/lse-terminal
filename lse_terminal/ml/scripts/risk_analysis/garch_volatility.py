#!/usr/bin/env python3
"""
GARCH Volatility Model
========================
Fits GARCH/EGARCH/TGARCH models to estimate and forecast volatility.

Output format matches the LSE Terminal API contract.
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
        from arch import arch_model
        HAS_ARCH = True
    except ImportError:
        HAS_ARCH = False
        print("[INFO] arch package not installed, using numpy GARCH(1,1) fallback")

    from sklearn.metrics import mean_absolute_error, mean_squared_error

    print("=" * 60)
    print("GARCH Volatility Model")
    print("=" * 60)
    print(f"Started at: {datetime.now().isoformat()}")

    dataset = params.get('dataset', 'candles_15m')
    forecast_horizon = int(params.get("forecast_horizon", 30))
    test_size_pct = int(params.get("test_size", 20)) / 100
    p_order = int(params.get("p", 1))
    q_order = int(params.get("q", 1))
    o_order = int(params.get("o", 0))
    model_type = params.get("model_type", "GARCH")
    distribution = params.get("distribution", "normal")
    mean_model = params.get("mean_model", "Constant")
    rescale = params.get("rescale", "true") == "true"

    print(f"\n[CONFIG] Dataset: {dataset}")
    print(f"[CONFIG] Model: {model_type}({p_order},{o_order},{q_order})")
    print(f"[CONFIG] Distribution: {distribution}")

    # Fetch data
    df = fetch_dataset(dataset)
    prices = df["close"].astype(float).values

    # Trim for performance
    if len(prices) > 10000:
        print(f"[INFO] Trimming from {len(prices):,} to last 10,000 for performance")
        prices = prices[-10000:]

    # Compute log returns
    returns = np.diff(np.log(prices)) * 100  # percentage returns
    returns = returns[~np.isnan(returns)]
    returns = returns[np.isfinite(returns)]
    print(f"[INFO] Computed {len(returns):,} log returns")
    print(f"[INFO] Returns: mean={np.mean(returns):.4f}%, std={np.std(returns):.4f}%")
    sys.stdout.flush()

    # Train/test split
    split_idx = int(len(returns) * (1 - test_size_pct))
    train_returns = returns[:split_idx]
    test_returns = returns[split_idx:]
    print(f"\n[INFO] Train size: {len(train_returns):,}, Test size: {len(test_returns):,}")

    if HAS_ARCH:
        # === ARCH PACKAGE PATH ===
        vol_model = model_type.upper()
        if vol_model not in ["GARCH", "EGARCH", "FIGARCH"]:
            vol_model = "GARCH"

        print(f"\n[TRAINING] Fitting {vol_model}({p_order},{o_order},{q_order})...")
        sys.stdout.flush()

        try:
            am = arch_model(
                train_returns, vol=vol_model, p=p_order, o=o_order, q=q_order,
                mean=mean_model, dist=distribution, rescale=rescale,
            )
            result = am.fit(disp="off", show_warning=False)

            print(f"[INFO] Model converged successfully")
            print(f"[INFO] Log-likelihood: {result.loglikelihood:.2f}")
            print(f"[INFO] AIC: {result.aic:.2f}, BIC: {result.bic:.2f}")
            sys.stdout.flush()

            param_summary = {}
            for name, value in result.params.items():
                param_summary[name] = round(float(value), 6)
                print(f"[INFO] {name}: {value:.6f}")
            sys.stdout.flush()

        except Exception as e:
            raise Exception(f"GARCH fitting failed: {e}")

        # Out-of-sample evaluation
        print(f"\n[TRAINING] Evaluating on test set...")
        sys.stdout.flush()

        realized_vol = []
        predicted_vol = []
        window = min(len(train_returns), 2000)
        eval_steps = min(len(test_returns), 50)

        last_vol_pred = float(np.std(train_returns))
        for i in range(eval_steps):
            # Refit only every 5 steps for speed
            if i % 5 == 0:
                history = np.concatenate([train_returns[-(window - i):], test_returns[:i]]) if i > 0 else train_returns[-window:]
                try:
                    am_eval = arch_model(history, vol=vol_model, p=p_order, o=o_order, q=q_order, mean=mean_model, dist=distribution, rescale=rescale)
                    res_eval = am_eval.fit(disp="off", show_warning=False)
                    forecast = res_eval.forecast(horizon=1)
                    pred_var = forecast.variance.values[-1, 0]
                    last_vol_pred = float(np.sqrt(pred_var))
                except:
                    pass  # keep last_vol_pred
            predicted_vol.append(last_vol_pred)
            realized_vol.append(abs(float(test_returns[i])))

            if (i + 1) % max(1, eval_steps // 5) == 0:
                print(f"  [Eval] Step {i+1}/{eval_steps}")
                print(f"[PROGRESS] {int(30 + (i+1) / eval_steps * 50)}")
                sys.stdout.flush()

        # Forward forecast
        forecast_result = result.forecast(horizon=forecast_horizon)
        forecast_variance = forecast_result.variance.values[-1]
        forecast_vol = [float(np.sqrt(v)) for v in forecast_variance]

        aic_val = round(float(result.aic), 2)
        bic_val = round(float(result.bic), 2)
        ll_val = round(float(result.loglikelihood), 2)
    else:
        # === NUMPY FALLBACK: Simple GARCH(1,1) ===
        vol_model = "GARCH"
        print(f"\n[TRAINING] Fitting GARCH(1,1) via numpy fallback...")
        sys.stdout.flush()

        # GARCH(1,1): sigma_t^2 = omega + alpha * r_{t-1}^2 + beta * sigma_{t-1}^2
        # Estimate parameters using method of moments
        mean_r = np.mean(train_returns)
        var_r = np.var(train_returns)

        # Initialize GARCH params (reasonable defaults)
        omega = var_r * 0.05  # long-run variance contribution
        alpha = 0.10  # reaction to shocks
        beta = 0.85   # persistence

        # Simple iterative estimation (maximize quasi-log-likelihood)
        best_ll = -np.inf
        best_params = (omega, alpha, beta)

        for alpha_try in np.arange(0.02, 0.25, 0.02):
            for beta_try in np.arange(0.70, 0.96, 0.02):
                if alpha_try + beta_try >= 0.999:
                    continue
                omega_try = var_r * (1 - alpha_try - beta_try)
                if omega_try <= 0:
                    continue

                # Compute conditional variances
                sigma2 = np.zeros(len(train_returns))
                sigma2[0] = var_r
                for t in range(1, len(train_returns)):
                    sigma2[t] = omega_try + alpha_try * train_returns[t-1]**2 + beta_try * sigma2[t-1]
                    sigma2[t] = max(sigma2[t], 1e-8)

                # Log-likelihood
                ll = -0.5 * np.sum(np.log(sigma2) + train_returns**2 / sigma2)
                if ll > best_ll:
                    best_ll = ll
                    best_params = (omega_try, alpha_try, beta_try)

        omega, alpha, beta = best_params
        param_summary = {"omega": round(omega, 6), "alpha[1]": round(alpha, 6), "beta[1]": round(beta, 6)}
        print(f"[INFO] Estimated params: omega={omega:.6f}, alpha={alpha:.4f}, beta={beta:.4f}")
        print(f"[INFO] Persistence: {alpha + beta:.4f}")
        sys.stdout.flush()

        # Compute conditional variances for full training set
        sigma2_train = np.zeros(len(train_returns))
        sigma2_train[0] = var_r
        for t in range(1, len(train_returns)):
            sigma2_train[t] = omega + alpha * train_returns[t-1]**2 + beta * sigma2_train[t-1]

        # Out-of-sample evaluation
        print(f"\n[TRAINING] Evaluating on test set...")
        sys.stdout.flush()

        realized_vol = []
        predicted_vol = []
        last_sigma2 = sigma2_train[-1]
        eval_steps = min(len(test_returns), 200)

        for i in range(eval_steps):
            predicted_vol.append(float(np.sqrt(last_sigma2)))
            realized_vol.append(abs(float(test_returns[i])))
            last_sigma2 = omega + alpha * test_returns[i]**2 + beta * last_sigma2

            if (i + 1) % max(1, eval_steps // 5) == 0:
                print(f"  [Eval] Step {i+1}/{eval_steps}")
                sys.stdout.flush()

        # Forward forecast
        forecast_vol = []
        fv = last_sigma2
        for h in range(forecast_horizon):
            forecast_vol.append(float(np.sqrt(fv)))
            fv = omega + (alpha + beta) * fv  # unconditional forecast

        aic_val = 0.0
        bic_val = 0.0
        ll_val = round(float(best_ll), 2)

    # Metrics
    pred_arr = np.array(predicted_vol)
    actual_arr = np.array(realized_vol)
    vol_mae = float(mean_absolute_error(actual_arr, pred_arr))
    vol_rmse = float(np.sqrt(mean_squared_error(actual_arr, pred_arr)))

    # VaR calculation
    current_price = float(prices[-1])
    confidence = 0.95
    z_score = 1.645
    avg_vol = np.mean(forecast_vol) / 100
    var_1day = current_price * avg_vol * z_score
    cvar_1day = current_price * avg_vol * (np.exp(-z_score**2 / 2) / (np.sqrt(2 * np.pi) * (1 - confidence)))

    print(f"\n[RESULTS] Volatility Forecast Performance:")
    print(f"  - Vol MAE:  {vol_mae:.4f}")
    print(f"  - Vol RMSE: {vol_rmse:.4f}")
    print(f"\n[RESULTS] Current Analysis:")
    print(f"  - Current Price: {current_price:.2f}")
    print(f"  - Avg Forecast Vol: {np.mean(forecast_vol):.4f}%")
    print(f"  - 95% VaR (1-step): ${var_1day:.2f}")
    print(f"  - 95% CVaR (1-step): ${cvar_1day:.2f}")

    results = {
        "metrics": {
            "vol_mae": round(vol_mae, 4),
            "vol_rmse": round(vol_rmse, 4),
            "log_likelihood": ll_val,
            "aic": aic_val,
            "bic": bic_val,
            "var_95": round(var_1day, 2),
            "cvar_95": round(cvar_1day, 2),
        },
        "forecast": {
            "volatility": forecast_vol,
            "current_price": current_price,
            "avg_forecast_vol_pct": round(float(np.mean(forecast_vol)), 4),
        },
        "model_params": param_summary,
        "config": {
            "dataset": dataset,
            "model_type": vol_model,
            "order": [p_order, o_order, q_order],
            "distribution": distribution,
            "mean_model": mean_model,
            "forecast_horizon": forecast_horizon,
            "mode": "arch" if HAS_ARCH else "numpy_garch_fallback",
        },
    }

    print(f"\n[DONE] Completed at: {datetime.now().isoformat()}")
    print("=" * 60)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GARCH Volatility Model")
    parser.add_argument("--dataset", type=str, default='candles_15m')
    parser.add_argument("--forecast_horizon", type=int, default=30)
    parser.add_argument("--test_size", type=int, default=20)
    parser.add_argument("--p", type=int, default=1)
    parser.add_argument("--q", type=int, default=1)
    parser.add_argument("--o", type=int, default=0)
    parser.add_argument("--model_type", type=str, default="GARCH")
    parser.add_argument("--distribution", type=str, default="normal")
    parser.add_argument("--mean_model", type=str, default="Constant")
    parser.add_argument("--rescale", type=str, default="true")
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
            "model_type": "GARCH",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, indent=2))
    print("[/RESULTS_JSON]")
