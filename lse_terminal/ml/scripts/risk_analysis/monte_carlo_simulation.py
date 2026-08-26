#!/usr/bin/env python3
"""
Monte Carlo Price Simulation
===============================
Generates stochastic price paths using GBM, jump-diffusion, etc.
Computes VaR, CVaR, and probability distributions.

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
    print("=" * 60)
    print("Monte Carlo Price Simulation")
    print("=" * 60)
    print(f"Started at: {datetime.now().isoformat()}")

    dataset = params.get('dataset', 'candles_15m')
    num_simulations = int(params.get("num_simulations", 10000))
    time_horizon = int(params.get("time_horizon", 252))
    confidence_level = float(params.get("confidence_level", 95)) / 100
    price_model = params.get("price_model", "gbm")
    vol_method = params.get("vol_method", "historical")
    lookback_window = int(params.get("lookback_window", 252))
    var_method = params.get("var_method", "historical")
    calculate_cvar = params.get("calculate_cvar", "true") == "true"
    random_seed = int(params.get("random_seed", 42))

    print(f"\n[CONFIG] Dataset: {dataset}")
    print(f"[CONFIG] Simulations: {num_simulations:,}")
    print(f"[CONFIG] Horizon: {time_horizon} steps")
    print(f"[CONFIG] Price Model: {price_model}")
    print(f"[CONFIG] Confidence: {confidence_level:.0%}")
    print(f"[CONFIG] Vol Method: {vol_method}")

    np.random.seed(random_seed)

    # Fetch data
    df = fetch_dataset(dataset)
    prices = df["close"].astype(float).values

    # Use lookback window
    if len(prices) > lookback_window:
        prices = prices[-lookback_window:]
        print(f"[INFO] Using last {lookback_window} observations for calibration")

    # Compute returns
    log_returns = np.diff(np.log(prices))
    log_returns = log_returns[np.isfinite(log_returns)]
    current_price = float(prices[-1])

    print(f"[INFO] Current price: {current_price:.2f}")
    print(f"[INFO] Mean return: {np.mean(log_returns)*100:.4f}%")
    print(f"[INFO] Std return: {np.std(log_returns)*100:.4f}%")
    sys.stdout.flush()

    # Estimate volatility
    if vol_method == "ewma":
        lam = 0.94
        var_ewma = np.zeros(len(log_returns))
        var_ewma[0] = log_returns[0] ** 2
        for i in range(1, len(log_returns)):
            var_ewma[i] = lam * var_ewma[i - 1] + (1 - lam) * log_returns[i - 1] ** 2
        sigma = float(np.sqrt(var_ewma[-1]))
        print(f"[INFO] EWMA volatility: {sigma*100:.4f}%")
    elif vol_method == "realized":
        sigma = float(np.std(log_returns[-min(21, len(log_returns)):]))
        print(f"[INFO] Realized volatility (21d): {sigma*100:.4f}%")
    else:
        sigma = float(np.std(log_returns))
        print(f"[INFO] Historical volatility: {sigma*100:.4f}%")

    mu = float(np.mean(log_returns))

    # Simulate paths
    print(f"\n[TRAINING] Running {num_simulations:,} simulations over {time_horizon} steps...")
    sys.stdout.flush()

    all_paths = np.zeros((num_simulations, time_horizon + 1))
    all_paths[:, 0] = current_price

    print(f"  [Sim] Generating {num_simulations:,} paths × {time_horizon} steps (vectorized)...")
    sys.stdout.flush()

    if price_model == "jump_diffusion":
        # Merton jump-diffusion, fully vectorized
        jump_rate = 0.1
        jump_mean = 0.0
        jump_std = sigma * 2
        Z = np.random.normal(0, 1, (num_simulations, time_horizon))
        J = np.random.poisson(jump_rate, (num_simulations, time_horizon))
        jump_sizes = np.random.normal(jump_mean, jump_std, (num_simulations, time_horizon))
        drift_adj = mu - 0.5 * sigma**2 - jump_rate * (np.exp(jump_mean + 0.5 * jump_std**2) - 1)
        log_changes = drift_adj + sigma * Z + J * jump_sizes
        # Vectorised path: cumulative sum of log-returns then exp
        all_paths[:, 1:] = current_price * np.exp(np.cumsum(log_changes, axis=1))

    elif price_model == "heston":
        # Stochastic vol (Euler): time loop required for variance, but vectorised across sims
        kappa, theta, xi = 2.0, sigma**2, 0.3
        v = np.full(num_simulations, sigma**2)
        Z1 = np.random.normal(0, 1, (num_simulations, time_horizon))
        Z2 = np.random.normal(0, 1, (num_simulations, time_horizon))
        rho = -0.7
        Z2 = rho * Z1 + np.sqrt(1 - rho**2) * Z2
        log_changes = np.zeros((num_simulations, time_horizon))
        for t in range(time_horizon):
            v = np.maximum(v + kappa * (theta - v) + xi * np.sqrt(np.maximum(v, 0)) * Z2[:, t], 1e-10)
            log_changes[:, t] = (mu - 0.5 * v) + np.sqrt(v) * Z1[:, t]
        all_paths[:, 1:] = current_price * np.exp(np.cumsum(log_changes, axis=1))

    else:
        # GBM: fully vectorised, single matrix operation
        Z = np.random.normal(0, 1, (num_simulations, time_horizon))
        log_changes = (mu - 0.5 * sigma**2) + sigma * Z
        all_paths[:, 1:] = current_price * np.exp(np.cumsum(log_changes, axis=1))

    print(f"  [Sim] {num_simulations:,}/{num_simulations:,} paths complete")
    sys.stdout.flush()

    # Analysis
    print(f"\n[TRAINING] Computing risk metrics...")
    sys.stdout.flush()

    final_prices = all_paths[:, -1]
    total_returns = (final_prices / current_price) - 1
    log_total_returns = np.log(final_prices / current_price)

    # VaR
    if var_method == "parametric":
        from scipy.stats import norm
        var_pct = float(norm.ppf(1 - confidence_level) * np.std(total_returns))
    elif var_method == "cornish_fisher":
        s = float(pd.Series(total_returns).skew())
        k = float(pd.Series(total_returns).kurtosis())
        from scipy.stats import norm
        z = norm.ppf(1 - confidence_level)
        z_adj = z + (z**2 - 1) * s / 6 + (z**3 - 3*z) * k / 24 - (2*z**3 - 5*z) * s**2 / 36
        var_pct = float(z_adj * np.std(total_returns))
    else:
        var_pct = float(np.percentile(total_returns, (1 - confidence_level) * 100))

    var_dollar = abs(var_pct * current_price)

    # CVaR
    if calculate_cvar:
        tail_returns = total_returns[total_returns <= var_pct]
        cvar_pct = float(np.mean(tail_returns)) if len(tail_returns) > 0 else var_pct
        cvar_dollar = abs(cvar_pct * current_price)
    else:
        cvar_pct = 0
        cvar_dollar = 0

    # Percentiles
    percentiles = {}
    for pct in [5, 10, 25, 50, 75, 90, 95]:
        percentiles[f"p{pct}"] = round(float(np.percentile(final_prices, pct)), 2)

    # Path statistics
    max_drawdown_per_path = []
    for i in range(min(1000, num_simulations)):
        path = all_paths[i]
        peak = np.maximum.accumulate(path)
        dd = (path - peak) / peak
        max_drawdown_per_path.append(float(np.min(dd)))

    avg_max_drawdown = float(np.mean(max_drawdown_per_path))

    prob_profit = float(np.mean(final_prices > current_price))

    print(f"\n[RESULTS] Monte Carlo Results ({num_simulations:,} paths, {time_horizon} steps):")
    print(f"  - Current Price:    ${current_price:,.2f}")
    print(f"  - Median Outcome:   ${percentiles['p50']:,.2f}")
    print(f"  - Mean Outcome:     ${np.mean(final_prices):,.2f}")
    print(f"  - Best Case (95%):  ${percentiles['p95']:,.2f}")
    print(f"  - Worst Case (5%):  ${percentiles['p5']:,.2f}")
    print(f"  - Prob of Profit:   {prob_profit:.1%}")
    print(f"\n[RESULTS] Risk Metrics:")
    print(f"  - VaR ({confidence_level:.0%}):  ${var_dollar:,.2f} ({var_pct:.2%})")
    if calculate_cvar:
        print(f"  - CVaR ({confidence_level:.0%}): ${cvar_dollar:,.2f} ({cvar_pct:.2%})")
    print(f"  - Avg Max Drawdown: {avg_max_drawdown:.2%}")

    # Sample paths for visualization (10 representative paths)
    indices = np.linspace(0, num_simulations - 1, 10, dtype=int)
    sample_paths = [[float(v) for v in all_paths[i][::max(1, time_horizon//50)]] for i in indices]

    results = {
        "metrics": {
            "var_pct": round(var_pct * 100, 2),
            "var_dollar": round(var_dollar, 2),
            "cvar_pct": round(cvar_pct * 100, 2) if calculate_cvar else None,
            "cvar_dollar": round(cvar_dollar, 2) if calculate_cvar else None,
            "prob_profit": round(prob_profit, 4),
            "avg_max_drawdown": round(avg_max_drawdown, 4),
            "mean_return": round(float(np.mean(total_returns)) * 100, 2),
            "median_return": round(float(np.median(total_returns)) * 100, 2),
        },
        "distribution": percentiles,
        "forecast": {
            "current_price": current_price,
            "mean_price": round(float(np.mean(final_prices)), 2),
            "median_price": percentiles["p50"],
            "sample_paths": sample_paths,
        },
        "config": {
            "dataset": dataset,
            "num_simulations": num_simulations,
            "time_horizon": time_horizon,
            "price_model": price_model,
            "vol_method": vol_method,
            "confidence_level": confidence_level,
            "volatility": round(sigma * 100, 4),
            "drift": round(mu * 100, 6),
        },
    }

    print(f"\n[DONE] Completed at: {datetime.now().isoformat()}")
    print("=" * 60)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Monte Carlo Simulation")
    parser.add_argument("--dataset", type=str, default='candles_15m')
    parser.add_argument("--num_simulations", type=int, default=10000)
    parser.add_argument("--time_horizon", type=int, default=252)
    parser.add_argument("--confidence_level", type=float, default=95)
    parser.add_argument("--price_model", type=str, default="gbm")
    parser.add_argument("--vol_method", type=str, default="historical")
    parser.add_argument("--lookback_window", type=int, default=252)
    parser.add_argument("--var_method", type=str, default="historical")
    parser.add_argument("--calculate_cvar", type=str, default="true")
    parser.add_argument("--random_seed", type=int, default=42)
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
            "model_type": "MonteCarlo",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, indent=2))
    print("[/RESULTS_JSON]")
