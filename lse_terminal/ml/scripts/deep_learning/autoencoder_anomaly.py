#!/usr/bin/env python3
"""
Autoencoder Anomaly Detection (PyTorch + CUDA)
================================================
Deep autoencoder for detecting anomalous price patterns.
Auto-detects CUDA GPU; falls back to CPU.
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
    print("Autoencoder Anomaly Detection")
    print("=" * 60)
    sys.stdout.flush()

    device = get_device()
    use_torch = device is not None

    data = fetch_ohlcv(args.dataset, args.timeframe)
    close = data["close"]
    ws = args.window_size
    enc_dim = args.encoding_dim

    # Build normalised windows
    windows = []
    for i in range(ws, len(close)):
        w = close[i - ws:i]
        w_norm = (w - w.mean()) / (w.std() + 1e-8)
        windows.append(w_norm)
    X = np.array(windows)
    print(f"[INFO] Built {len(X):,} windows of size {ws}")
    sys.stdout.flush()

    start_time = time.time()

    if use_torch:
        import torch
        import torch.nn as nn

        class Autoencoder(nn.Module):
            def __init__(self, input_dim, encoding_dim):
                super().__init__()
                mid = (input_dim + encoding_dim) // 2
                self.encoder = nn.Sequential(
                    nn.Linear(input_dim, mid),
                    nn.ReLU(),
                    nn.Dropout(0.2),
                    nn.Linear(mid, encoding_dim),
                    nn.ReLU(),
                )
                self.decoder = nn.Sequential(
                    nn.Linear(encoding_dim, mid),
                    nn.ReLU(),
                    nn.Dropout(0.2),
                    nn.Linear(mid, input_dim),
                )

            def forward(self, x):
                return self.decoder(self.encoder(x))

        model = Autoencoder(ws, enc_dim).to(device)
        total_params = sum(p.numel() for p in model.parameters())
        print(f"[MODEL] Autoencoder: {total_params:,} params, encoding_dim={enc_dim}")

        optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
        criterion = nn.MSELoss()

        X_t = torch.FloatTensor(X)
        best_loss = float("inf")

        print(f"\n{'Epoch':<8} {'Loss':<14} {'Status'}")
        print("-" * 35)
        sys.stdout.flush()

        for epoch in range(args.epochs):
            model.train()
            indices = torch.randperm(len(X_t))
            total_loss = 0
            batches = 0
            bs = 256

            for start in range(0, len(X_t), bs):
                end = min(start + bs, len(X_t))
                idx = indices[start:end]
                xb = X_t[idx].to(device)

                optimizer.zero_grad()
                recon = model(xb)
                loss = criterion(recon, xb)
                loss.backward()
                optimizer.step()
                total_loss += loss.item()
                batches += 1

            epoch_loss = total_loss / batches
            status = "improved" if epoch_loss < best_loss else ""
            best_loss = min(best_loss, epoch_loss)

            if (epoch + 1) % max(1, args.epochs // 10) == 0 or epoch == 0:
                print(f"  {epoch+1:<6} {epoch_loss:<14.6f} {status}")
                sys.stdout.flush()

        # Compute reconstruction errors
        model.eval()
        with torch.no_grad():
            all_recon = []
            for start in range(0, len(X_t), 512):
                end = min(start + 512, len(X_t))
                recon = model(X_t[start:end].to(device))
                all_recon.append(recon.cpu().numpy())
            recon_all = np.concatenate(all_recon, axis=0)

    else:
        # NumPy fallback
        np.random.seed(42)
        W_enc = np.random.randn(ws, enc_dim) * 0.1
        b_enc = np.zeros(enc_dim)
        W_dec = np.random.randn(enc_dim, ws) * 0.1
        b_dec = np.zeros(ws)

        def relu(x): return np.maximum(0, x)

        for epoch in range(args.epochs):
            idx = np.random.choice(len(X), min(256, len(X)), replace=False)
            batch = X[idx]
            enc = relu(batch @ W_enc + b_enc)
            dec = enc @ W_dec + b_dec
            error = dec - batch
            loss = np.mean(error ** 2)
            W_dec -= 0.005 * enc.T @ error / len(idx)
            W_enc -= 0.005 * batch.T @ ((error @ W_dec.T) * (enc > 0)) / len(idx)
            b_dec -= 0.005 * np.mean(error, axis=0)
            b_enc -= 0.005 * np.mean((error @ W_dec.T) * (enc > 0), axis=0)
            if epoch % 10 == 0:
                print(f"  Epoch {epoch}: loss={loss:.6f}")

        enc_all = relu(X @ W_enc + b_enc)
        recon_all = enc_all @ W_dec + b_dec

    recon_errors = np.mean((X - recon_all) ** 2, axis=1)
    threshold = np.percentile(recon_errors, args.threshold_percentile)
    anomalies = recon_errors > threshold
    n_anomalies = int(np.sum(anomalies))

    elapsed = time.time() - start_time
    print(f"\n[RESULTS] Anomalies: {n_anomalies} ({n_anomalies/len(X)*100:.1f}%)")
    print(f"[RESULTS] Threshold: {threshold:.6f}, Mean error: {np.mean(recon_errors):.6f}")
    print(f"[RESULTS] Training time: {elapsed:.1f}s")

    return {
        "metrics": {
            "total_windows": int(len(X)),
            "anomalies_detected": n_anomalies,
            "anomaly_rate": round(float(n_anomalies / len(X)), 4),
            "threshold": round(float(threshold), 6),
            "mean_recon_error": round(float(np.mean(recon_errors)), 6),
            "max_recon_error": round(float(np.max(recon_errors)), 6),
            "encoding_dim": enc_dim,
        },
        "distribution": {
            "error_mean": round(float(np.mean(recon_errors)), 6),
            "error_std": round(float(np.std(recon_errors)), 6),
            "error_p50": round(float(np.percentile(recon_errors, 50)), 6),
            "error_p95": round(float(np.percentile(recon_errors, 95)), 6),
            "error_p99": round(float(np.percentile(recon_errors, 99)), 6),
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
    parser = argparse.ArgumentParser(description="Autoencoder Anomaly Detection")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--encoding_dim", type=int, default=16)
    parser.add_argument("--window_size", type=int, default=20)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--threshold_percentile", type=float, default=95)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    job_id = args.job_id if hasattr(args, "job_id") else ""
    results = main(args)
    # Save model weights if job_id provided
    if args.job_id:
        weight_path = save_model_weights(results, args.job_id, trained_model=None, metadata={
            "model_type": "Autoencoder",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
