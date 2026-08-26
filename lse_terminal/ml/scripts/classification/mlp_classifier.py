#!/usr/bin/env python3
"""
Neural Network (MLP) Classifier - GPU-Accelerated via PyTorch
Fetches data via utils.py, computes selected features, trains MLP classifier.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from utils import get_device, fetch_ohlcv, compute_features, save_model_weights
import argparse, json, time, numpy as np, pandas as pd


def run_model(df, args, feature_names):
    close = df["close"].values
    X = df[feature_names].values
    y = (close[args.target_horizon:] > close[:-args.target_horizon]).astype(int)
    X = X[:len(y)]
    valid = ~np.isnan(X).any(axis=1) & ~np.isinf(X).any(axis=1)
    X, y = X[valid], y[valid]

    # Normalise
    mu, std = X.mean(axis=0), X.std(axis=0) + 1e-8
    X = (X - mu) / std

    # Normalize test_size: frontend sends percentage (20) but we need fraction (0.2)
    test_frac = args.test_size / 100 if args.test_size > 1 else args.test_size
    split = int(len(X) * (1 - test_frac))
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    layers = tuple(int(x) for x in args.hidden_layers.split(","))
    device = get_device()
    use_torch = device is not None

    if use_torch:
        import torch
        import torch.nn as nn

        layer_sizes = [X_train.shape[1]] + list(layers) + [2]
        model_layers = []
        for i in range(len(layer_sizes) - 1):
            model_layers.append(nn.Linear(layer_sizes[i], layer_sizes[i+1]))
            if i < len(layer_sizes) - 2:
                model_layers.append(nn.ReLU())
                model_layers.append(nn.Dropout(0.1))
        model = nn.Sequential(*model_layers).to(device)

        print(f"[INFO] PyTorch MLP on {device}: {sum(p.numel() for p in model.parameters())} params")
        sys.stdout.flush()

        X_train_t = torch.tensor(X_train, dtype=torch.float32).to(device)
        y_train_t = torch.tensor(y_train, dtype=torch.long).to(device)
        X_test_t = torch.tensor(X_test, dtype=torch.float32).to(device)

        optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)
        criterion = nn.CrossEntropyLoss()
        batch_size = min(512, len(X_train_t))
        best_loss = float("inf")
        patience = 10
        no_improve = 0
        epochs_run = 0

        for epoch in range(args.epochs):
            model.train()
            perm = torch.randperm(len(X_train_t), device=device)
            total_loss = 0.0
            n_batches = 0
            for i in range(0, len(X_train_t), batch_size):
                idx = perm[i:i+batch_size]
                xb = X_train_t[idx]
                yb = y_train_t[idx]
                out = model(xb)
                loss = criterion(out, yb)
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                total_loss += loss.item()
                n_batches += 1

            avg_loss = total_loss / n_batches
            epochs_run = epoch + 1

            if (epoch + 1) % max(1, args.epochs // 10) == 0 or epoch == 0:
                print(f"[{epoch+1}/{args.epochs}] loss={avg_loss:.4f}")
                print(f"[PROGRESS] {int(10 + (epoch+1) / args.epochs * 80)}")
                sys.stdout.flush()

            if avg_loss < best_loss - 1e-5:
                best_loss = avg_loss
                no_improve = 0
            else:
                no_improve += 1
                if no_improve >= patience:
                    print(f"[INFO] Early stopping at epoch {epoch+1}")
                    break

        model.eval()
        with torch.no_grad():
            out = model(X_test_t)
            preds = out.argmax(dim=1).cpu().numpy()
    else:
        from sklearn.neural_network import MLPClassifier
        model = MLPClassifier(hidden_layer_sizes=layers, max_iter=args.epochs,
                              learning_rate_init=args.learning_rate, early_stopping=True,
                              validation_fraction=0.15, random_state=42)
        model.fit(X_train, y_train)
        preds = model.predict(X_test)
        epochs_run = int(model.n_iter_)

    acc = float(np.mean(preds == y_test))
    precision = float(np.sum((preds == 1) & (y_test == 1)) / (np.sum(preds == 1) + 1e-8))
    recall = float(np.sum((preds == 1) & (y_test == 1)) / (np.sum(y_test == 1) + 1e-8))
    f1 = 2 * precision * recall / (precision + recall + 1e-8)

    return {
        "metrics": {"accuracy": acc, "precision": precision, "recall": recall, "f1_score": f1,
                    "hidden_layers": str(layers), "epochs_run": epochs_run,
                    "test_samples": int(len(y_test)),
                    "device": str(device) if device else "cpu"},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Neural Network (MLP) Classifier")
    parser.add_argument("--dataset", default='BTC/USD')
    parser.add_argument("--timeframe", default="15m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--hidden_layers", default="128,64")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--learning_rate", type=float, default=0.001)
    parser.add_argument("--target_horizon", type=int, default=5)
    parser.add_argument("--test_size", type=float, default=0.2)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    print(f"[INFO] Starting Neural Network (MLP) Classifier...")
    print(f"[INFO] Dataset: {args.dataset}, Timeframe: {args.timeframe}")
    print(f"[INFO] Features: {args.features}")
    start_time = time.time()

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

    df = compute_features(df, args.features)
    feature_names = [c for c in df.columns if c not in ("timestamp",)]
    print(f"[INFO] Using {len(feature_names)} features: {feature_names}")

    print("[TRAINING] Running model...")
    results = run_model(df, args, feature_names)

    elapsed = time.time() - start_time
    results["config"] = {"dataset": args.dataset, "timeframe": args.timeframe,
                         "data_points": int(len(df)), "training_time_s": round(elapsed, 2),
                         "features_used": feature_names}

    if args.job_id:
        weight_path = save_model_weights(results, args.job_id, trained_model=None, metadata={
            "model_type": "MLP",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
    print(f"[INFO] Completed in {elapsed:.1f}s")
