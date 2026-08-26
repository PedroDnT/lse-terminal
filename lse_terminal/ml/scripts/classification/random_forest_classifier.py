#!/usr/bin/env python3
"""
Random Forest Price Direction Classifier
==========================================
Trains a Random Forest to predict price direction (UP/DOWN).
Uses the same data pipeline as XGBoost for consistency.

Output format matches the LSE Terminal API contract.
"""

import argparse
import json
import sys
import os
import warnings
from datetime import datetime

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

# Import shared data fetching from utils
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from utils import fetch_dataset as _fetch_raw, compute_features, save_model_weights
warnings.filterwarnings("ignore")


def fetch_dataset(dataset_name: str, features: list = None, start_date: str = None, end_date: str = None) -> pd.DataFrame:
    # Raw OHLCV comes from the local dataset file (utils.fetch_dataset)
    df = _fetch_raw(dataset_name, features=["timestamp", "open", "high", "low", "close", "volume"],
                    start_date=start_date, end_date=end_date)
    
    for col in ["open", "high", "low", "close", "volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    
    # Compute selected technical indicators via centralized compute_features
    df = compute_features(df, features)
    print(f"[INFO] After indicators: {len(df):,} rows × {len(df.columns)} columns")
    return df


def main(params: dict, job_id: str = None) -> dict:
    print("=" * 60)
    print("Random Forest Price Direction Classifier")
    print("=" * 60)
    print(f"Started at: {datetime.now().isoformat()}")

    dataset = params.get('dataset', 'candles_15m')
    target_horizon = int(params.get("target_horizon", 5))
    test_size_pct = int(params.get("test_size", 20)) / 100
    features = params.get("features", None)
    n_estimators = int(params.get("n_estimators", 200))
    max_depth_val = int(params.get("max_depth", 10))
    max_depth = max_depth_val if max_depth_val > 0 else None
    min_samples_split = int(params.get("min_samples_split", 5))
    min_samples_leaf = int(params.get("min_samples_leaf", 2))
    max_features = params.get("max_features", "sqrt")
    criterion = params.get("criterion", "gini")
    bootstrap = params.get("bootstrap", "true") == "true"
    oob_score = params.get("oob_score", "true") == "true" and bootstrap
    class_weight_str = params.get("class_weight", "none")
    class_weight = "balanced" if class_weight_str == "balanced" else None

    # Handle max_features
    if max_features in ["0.5"]:
        max_features = 0.5

    print(f"\n[CONFIG] Dataset: {dataset}")
    print(f"[CONFIG] Target Horizon: {target_horizon} candles")
    print(f"[CONFIG] Trees: {n_estimators}")
    print(f"[CONFIG] Max Depth: {max_depth}")
    print(f"[CONFIG] Criterion: {criterion}")

    # Get date filters
    start_date = params.get('start_date', None) or None
    end_date = params.get('end_date', None) or None
    if start_date or end_date:
        print(f"[CONFIG] Date range: {start_date or 'start'} -> {end_date or 'now'}")

    # Fetch data
    df = fetch_dataset(dataset, features, start_date=start_date, end_date=end_date)

    # Create target
    df["future_close"] = df["close"].shift(-target_horizon)
    df["target"] = (df["future_close"] > df["close"]).astype(int)
    df = df.dropna(subset=["target"])
    df = df.drop(columns=["future_close"])

    up_count = df["target"].sum()
    down_count = len(df) - up_count
    print(f"[INFO] Target: UP={up_count} ({up_count/len(df)*100:.1f}%), DOWN={down_count} ({down_count/len(df)*100:.1f}%)")

    # Prepare features
    exclude_cols = ["timestamp", "target", "id", "created_at"]
    if features:
        X_cols = [c for c in features if c in df.columns and c not in exclude_cols]
    else:
        X_cols = [c for c in df.columns if c not in exclude_cols and df[c].dtype in ["float64", "int64", "float32", "int32"]]

    print(f"[INFO] Using {len(X_cols)} features")

    X = df[X_cols].dropna()
    y = df["target"].loc[X.index]

    # Split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size_pct, shuffle=False)
    print(f"\n[INFO] Train size: {len(X_train):,}, Test size: {len(X_test):,}")
    sys.stdout.flush()

    # Train
    print(f"\n[TRAINING] Random Forest Configuration:")
    print(f"  - n_estimators: {n_estimators}")
    print(f"  - max_depth: {max_depth}")
    print(f"  - min_samples_split: {min_samples_split}")
    print(f"  - min_samples_leaf: {min_samples_leaf}")
    print(f"  - max_features: {max_features}")
    print(f"  - criterion: {criterion}")
    print(f"  - bootstrap: {bootstrap}")
    print(f"  - class_weight: {class_weight}")
    sys.stdout.flush()

    print(f"\n[PROGRESS] Training {n_estimators} trees...")
    sys.stdout.flush()

    model = RandomForestClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        min_samples_split=min_samples_split,
        min_samples_leaf=min_samples_leaf,
        max_features=max_features,
        criterion=criterion,
        bootstrap=bootstrap,
        oob_score=oob_score,
        class_weight=class_weight,
        random_state=42,
        n_jobs=int(os.environ.get("OMP_NUM_THREADS", 0)) or -1,
        verbose=1,
        warm_start=False,
    )

    model.fit(X_train, y_train)
    print(f"[INFO] Training complete")
    sys.stdout.flush()

    # Evaluate
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    accuracy = float(accuracy_score(y_test, y_pred))
    precision = float(precision_score(y_test, y_pred, zero_division=0))
    recall = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))

    # Feature importance
    # sklearn RF feature_importances_ sums to 1.0
    # The frontend multiplies by 100 to display percentages, so return raw fractions.
    raw_imp = np.array(model.feature_importances_.tolist())
    importance = dict(zip(X_cols, raw_imp.tolist()))
    importance = {k: round(v, 4) for k, v in sorted(importance.items(), key=lambda x: x[1], reverse=True)}


    # OOB score
    oob = float(model.oob_score_) if oob_score else None

    print(f"\n[RESULTS] Model Performance:")
    print(f"  - Accuracy:  {accuracy:.2%}")
    print(f"  - Precision: {precision:.2%}")
    print(f"  - Recall:    {recall:.2%}")
    print(f"  - F1 Score:  {f1:.2%}")
    if oob is not None:
        print(f"  - OOB Score: {oob:.2%}")
    print(f"\n[RESULTS] Feature Importance (top 5):")
    for i, (feat, imp) in enumerate(list(importance.items())[:5]):
        print(f"  {i+1}. {feat}: {imp:.4f}")

    results = {
        "metrics": {
            "accuracy": round(accuracy, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
            "oob_score": round(oob, 4) if oob else None,
        },
        "feature_importance": importance,
        "config": {
            "dataset": dataset,
            "target_horizon": target_horizon,
            "n_estimators": n_estimators,
            "max_depth": max_depth,
            "features_used": X_cols,
            "train_size": len(X_train),
            "test_size": len(X_test),
        },
    }

    # Save model weights if job_id provided
    if args.job_id:
        weight_path = save_model_weights(model, args.job_id, metadata={
            "model_type": "RandomForestClassifier",
            "n_estimators": n_estimators,
            "features": X_cols,
            "accuracy": accuracy,
        })
        if weight_path:
            results["weight_file"] = weight_path

    print(f"\n[DONE] Completed at: {datetime.now().isoformat()}")
    print("=" * 60)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Random Forest Classifier")
    parser.add_argument("--dataset", type=str, default='candles_15m')
    parser.add_argument("--target_horizon", type=int, default=5)
    parser.add_argument("--test_size", type=int, default=20)
    parser.add_argument("--n_estimators", type=int, default=200)
    parser.add_argument("--max_depth", type=int, default=10)
    parser.add_argument("--min_samples_split", type=int, default=5)
    parser.add_argument("--min_samples_leaf", type=int, default=2)
    parser.add_argument("--max_features", type=str, default="sqrt")
    parser.add_argument("--criterion", type=str, default="gini")
    parser.add_argument("--bootstrap", type=str, default="true")
    parser.add_argument("--oob_score", type=str, default="true")
    parser.add_argument("--class_weight", type=str, default="none")
    parser.add_argument("--features", type=str, nargs="*")
    parser.add_argument("--start_date", type=str, default="")
    parser.add_argument("--end_date", type=str, default="")
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()
    job_id = args.job_id
    params = dict(vars(args))
    params.pop("job_id", None)
    results = main(params, job_id=job_id if job_id else None)
    print("\n--- JSON RESULTS ---")
    print("[RESULTS_JSON]")
    print(json.dumps(results, indent=2))
    print("[/RESULTS_JSON]")
