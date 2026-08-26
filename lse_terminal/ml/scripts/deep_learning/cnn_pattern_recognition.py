#!/usr/bin/env python3
"""
CNN Pattern Recognition (PyTorch + CUDA)
==========================================
1D CNN for price pattern classification. Auto-detects CUDA GPU.
"""
import argparse
import json
import sys
import os
import time
import numpy as np
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils import compute_features, get_device, fetch_ohlcv, save_model_weights


def main(args):
    print("=" * 60)
    print("CNN Pattern Recognition")
    print("=" * 60)
    sys.stdout.flush()

    device = get_device()
    use_torch = device is not None

    data = fetch_ohlcv(args.dataset, args.timeframe)
    close = data["close"]
    ws = args.window_size
    horizon = args.target_horizon

    # Build windows and labels
    windows, labels = [], []
    for i in range(ws, len(close) - horizon):
        w = close[i - ws:i]
        w_norm = (w - w.mean()) / (w.std() + 1e-8)
        windows.append(w_norm)
        labels.append(1 if close[i + horizon] > close[i] else 0)

    X = np.array(windows)
    y = np.array(labels)
    split = int(len(X) * 0.8)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]
    print(f"[INFO] Train: {len(X_train):,}, Test: {len(X_test):,}")
    sys.stdout.flush()

    start_time = time.time()

    if use_torch:
        import torch
        import torch.nn as nn

        class CNN1D(nn.Module):
            def __init__(self, window_size, num_filters):
                super().__init__()
                self.conv1 = nn.Conv1d(1, num_filters, kernel_size=5, padding=2)
                self.conv2 = nn.Conv1d(num_filters, num_filters * 2, kernel_size=3, padding=1)
                self.bn1 = nn.BatchNorm1d(num_filters)
                self.bn2 = nn.BatchNorm1d(num_filters * 2)
                self.pool = nn.AdaptiveAvgPool1d(1)
                self.fc1 = nn.Linear(num_filters * 2, 32)
                self.fc2 = nn.Linear(32, 1)
                self.relu = nn.ReLU()
                self.dropout = nn.Dropout(0.3)

            def forward(self, x):
                x = x.unsqueeze(1)  # [B, 1, T]
                x = self.relu(self.bn1(self.conv1(x)))
                x = self.relu(self.bn2(self.conv2(x)))
                x = self.pool(x).squeeze(-1)
                x = self.dropout(self.relu(self.fc1(x)))
                return torch.sigmoid(self.fc2(x)).squeeze(-1)

        model = CNN1D(ws, args.num_filters).to(device)
        total_params = sum(p.numel() for p in model.parameters())
        print(f"[MODEL] CNN: {total_params:,} params, {args.num_filters} filters")

        optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
        criterion = nn.BCELoss()

        X_train_t = torch.FloatTensor(X_train)
        y_train_t = torch.FloatTensor(y_train)
        X_test_t = torch.FloatTensor(X_test)
        y_test_t = torch.FloatTensor(y_test)

        best_acc = 0
        print(f"\n{'Epoch':<8} {'Loss':<14} {'Accuracy':<14} {'Status'}")
        print("-" * 50)
        sys.stdout.flush()

        for epoch in range(args.epochs):
            model.train()
            indices = torch.randperm(len(X_train_t))
            total_loss = 0
            batches = 0
            bs = 128

            for start in range(0, len(X_train_t), bs):
                end = min(start + bs, len(X_train_t))
                idx = indices[start:end]
                xb = X_train_t[idx].to(device)
                yb = y_train_t[idx].to(device)

                optimizer.zero_grad()
                pred = model(xb)
                loss = criterion(pred, yb)
                loss.backward()
                optimizer.step()
                total_loss += loss.item()
                batches += 1

            model.eval()
            with torch.no_grad():
                val_pred = model(X_test_t.to(device))
                acc = float(((val_pred > 0.5).float() == y_test_t.to(device)).float().mean())

            best_acc = max(best_acc, acc)
            status = "best" if acc == best_acc else ""

            if (epoch + 1) % max(1, args.epochs // 10) == 0 or epoch == 0:
                print(f"  {epoch+1:<6} {total_loss/batches:<14.6f} {acc:<14.4f} {status}")
                sys.stdout.flush()

        # Final eval
        model.eval()
        with torch.no_grad():
            final_pred = model(X_test_t.to(device)).cpu().numpy()

    else:
        # NumPy fallback
        np.random.seed(42)
        nf = args.num_filters
        ks = 5
        filters = np.random.randn(nf, ks) * 0.1
        W_fc = np.random.randn(nf, 1) * 0.1
        bias_fc = np.zeros(1)

        def relu(x): return np.maximum(0, x)
        def sigmoid(x): return 1 / (1 + np.exp(-np.clip(x, -10, 10)))

        def forward(x):
            conv_out = np.zeros((len(x), nf))
            for b in range(len(x)):
                for f in range(nf):
                    conv = np.correlate(x[b], filters[f], mode="valid")
                    conv_out[b, f] = np.max(relu(conv))
            return sigmoid(conv_out @ W_fc + bias_fc).flatten(), conv_out

        best_acc = 0
        for epoch in range(args.epochs):
            batch_idx = np.random.choice(len(X_train), min(128, len(X_train)), replace=False)
            pred, pool_out = forward(X_train[batch_idx])
            error = pred - y_train[batch_idx]
            W_fc -= 0.01 * pool_out.T @ error.reshape(-1, 1) / len(batch_idx)
            bias_fc -= 0.01 * np.mean(error)
            if epoch % 10 == 0:
                val_pred, _ = forward(X_test)
                acc = np.mean((val_pred > 0.5).astype(int) == y_test)
                best_acc = max(best_acc, acc)
                print(f"  Epoch {epoch}: acc={acc:.3f}")

        final_pred, _ = forward(X_test)

    preds = (final_pred > 0.5).astype(int) if isinstance(final_pred, np.ndarray) else final_pred
    if isinstance(preds, np.ndarray):
        preds_int = (preds > 0.5).astype(int)
    else:
        preds_int = preds

    acc = float(np.mean(preds_int == y_test))
    precision = float(np.sum((preds_int == 1) & (y_test == 1)) / (np.sum(preds_int == 1) + 1e-8))
    recall = float(np.sum((preds_int == 1) & (y_test == 1)) / (np.sum(y_test == 1) + 1e-8))

    elapsed = time.time() - start_time
    print(f"\n[RESULTS] Accuracy: {acc:.4f}, Precision: {precision:.4f}, Recall: {recall:.4f}")
    print(f"[RESULTS] Training time: {elapsed:.1f}s")

    return {
        "metrics": {
            "accuracy": round(acc, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "best_accuracy": round(float(best_acc), 4),
            "num_filters": args.num_filters,
            "window_size": ws,
            "test_samples": int(len(y_test)),
        },
        "config": {
            "dataset": args.dataset,
            "timeframe": args.timeframe,
            "data_points": int(len(close)),
            "training_time_s": round(elapsed, 2),
            "mode": "gpu_pytorch" if use_torch and str(device) in ("cuda", "mps") else "cpu",
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CNN Pattern Recognition")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--window_size", type=int, default=20)
    parser.add_argument("--num_filters", type=int, default=32)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--target_horizon", type=int, default=5)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    job_id = args.job_id if hasattr(args, "job_id") else ""
    results = main(args)
    # Save model weights if job_id provided
    if args.job_id:
        weight_path = save_model_weights(results, args.job_id, trained_model=None, metadata={
            "model_type": "CNN",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
