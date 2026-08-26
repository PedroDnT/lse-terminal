#!/usr/bin/env python3
"""
CatBoost Direction Predictor - CPU/GPU Training Script
Fetches data via utils.py, computes selected features, trains CatBoost classifier.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from utils import fetch_ohlcv, compute_features, save_model_weights, OHLCV_COLS
import argparse, json, time, numpy as np, pandas as pd


def run_model(df, args, feature_names):
    close = df["close"].values
    X = df[feature_names].values
    y = (close[args.target_horizon:] > close[:-args.target_horizon]).astype(int)
    X = X[:len(y)]
    valid = ~np.isnan(X).any(axis=1) & ~np.isinf(X).any(axis=1)
    X, y = X[valid], y[valid]

    # Normalize test_size: frontend sends percentage (20) but we need fraction (0.2)
    test_frac = args.test_size / 100 if args.test_size > 1 else args.test_size
    split = int(len(X) * (1 - test_frac))
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    try:
        from catboost import CatBoostClassifier
        gpu_params = {}
        try:
            import torch
            if torch.cuda.is_available():
                gpu_params = {"task_type": "GPU", "devices": "0"}
                print("[GPU] CatBoost using CUDA acceleration")
        except ImportError:
            pass
        model = CatBoostClassifier(iterations=args.iterations, depth=args.depth,
                                    learning_rate=args.learning_rate, verbose=0, **gpu_params)
        model.fit(X_train, y_train)
        preds = model.predict(X_test).flatten()
        # CatBoost feature_importances_ uses PredictionValuesChange by default --
        # raw gradient aggregates that can be in the thousands.
        # Normalize to sum to 1.0 (fraction) since the frontend multiplies by 100.
        raw_imp = np.array(model.feature_importances_.tolist())
        total = raw_imp.sum()
        normalized_imp = (raw_imp / total).tolist() if total > 0 else raw_imp.tolist()
        importance = dict(zip(feature_names, normalized_imp))
    except ImportError:
        from sklearn.ensemble import GradientBoostingClassifier
        model = GradientBoostingClassifier(n_estimators=args.iterations, max_depth=min(args.depth, 3),
                                           learning_rate=args.learning_rate)
        model.fit(X_train, y_train)
        preds = model.predict(X_test)
        # sklearn's feature_importances_ already sums to 1.0
        raw_imp = np.array(model.feature_importances_.tolist())
        importance = dict(zip(feature_names, raw_imp.tolist()))


    acc = float(np.mean(preds == y_test))
    precision = float(np.sum((preds == 1) & (y_test == 1)) / (np.sum(preds == 1) + 1e-8))
    recall = float(np.sum((preds == 1) & (y_test == 1)) / (np.sum(y_test == 1) + 1e-8))
    f1 = 2 * precision * recall / (precision + recall + 1e-8)

    return {
        "metrics": {"accuracy": acc, "precision": precision, "recall": recall, "f1_score": f1,
                    "test_samples": int(len(y_test))},
        "feature_importance": dict(sorted(importance.items(), key=lambda x: x[1], reverse=True)[:10]),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CatBoost Direction Predictor")
    parser.add_argument("--dataset", default='BTC/USD')
    parser.add_argument("--timeframe", default="15m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--iterations", type=int, default=100)
    parser.add_argument("--depth", type=int, default=6)
    parser.add_argument("--learning_rate", type=float, default=0.1)
    parser.add_argument("--target_horizon", type=int, default=5)
    parser.add_argument("--test_size", type=float, default=0.2)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    print(f"[INFO] Starting CatBoost Direction Predictor...")
    print(f"[INFO] Dataset: {args.dataset}, Timeframe: {args.timeframe}")
    print(f"[INFO] Features: {args.features}")
    start_time = time.time()

    # Fetch raw OHLCV data via centralized utils
    data = fetch_ohlcv(args.dataset, timeframe=args.timeframe,
                       start_date=args.start_date, end_date=args.end_date)
    df = pd.DataFrame({
        # timestamp rides along (excluded from feature_names below): the
        # econ_* features join on it and crashed without it.
        "timestamp": data["timestamp"],
        "open": data["open"], "high": data["high"], "low": data["low"],
        "close": data["close"], "volume": data["volume"],
    })
    print(f"[INFO] Loaded {len(df)} data points")

    # Compute selected technical indicators
    df = compute_features(df, args.features)
    # Feature columns = everything except timestamp (if present)
    feature_names = [c for c in df.columns if c not in ("timestamp",)]
    print(f"[INFO] Using {len(feature_names)} features: {feature_names}")

    print("[TRAINING] Running model...")
    results = run_model(df, args, feature_names)

    elapsed = time.time() - start_time
    results["config"] = {"dataset": args.dataset, "timeframe": args.timeframe,
                         "data_points": int(len(df)), "training_time_s": round(elapsed, 2),
                         "features_used": feature_names}

    # Save model weights if job_id provided
    if args.job_id:
        weight_path = save_model_weights(results, args.job_id, trained_model=None, metadata={
            "model_type": "CatBoost",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
    print(f"[INFO] Completed in {elapsed:.1f}s")
