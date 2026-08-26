#!/usr/bin/env python3
"""
Transformer Price Forecast (PyTorch + CUDA)
=============================================
Multi-head attention Transformer encoder for price forecasting.
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
    print("Transformer Price Forecast")
    print("=" * 60)
    sys.stdout.flush()

    device = get_device()
    use_torch = device is not None

    data = fetch_ohlcv(args.dataset, args.timeframe)
    close = data["close"]
    seq_len = min(args.sequence_length, len(close) - args.forecast_horizon - 1)
    horizon = args.forecast_horizon

    # Normalise
    mu, sigma = close.mean(), close.std() + 1e-8
    normed = (close - mu) / sigma

    # Build sequences
    X, y = [], []
    for i in range(len(normed) - seq_len - horizon):
        X.append(normed[i:i + seq_len])
        y.append(normed[i + seq_len:i + seq_len + horizon])
    X, y = np.array(X), np.array(y)

    split = int(len(X) * 0.8)
    X_train, y_train = X[:split], y[:split]
    X_test, y_test = X[split:], y[split:]
    print(f"[INFO] Train: {len(X_train):,}, Test: {len(X_test):,}")
    sys.stdout.flush()

    start_time = time.time()

    if use_torch:
        import torch
        import torch.nn as nn

        # Disable Flash SDP: it causes CUDA kernel errors on some GPUs (RTX A4500)
        if hasattr(torch.backends.cuda, 'enable_flash_sdp'):
            torch.backends.cuda.enable_flash_sdp(False)

        class TransformerModel(nn.Module):
            def __init__(self, seq_len, d_model, n_heads, n_layers, horizon, dropout):
                super().__init__()
                self.input_proj = nn.Linear(1, d_model)
                self.pos_enc = nn.Parameter(torch.randn(1, seq_len, d_model) * 0.1)
                encoder_layer = nn.TransformerEncoderLayer(
                    d_model=d_model, nhead=n_heads, dim_feedforward=d_model * 4,
                    dropout=dropout, batch_first=True
                )
                self.encoder = nn.TransformerEncoder(
                    encoder_layer, num_layers=n_layers,
                    enable_nested_tensor=False
                )
                self.fc = nn.Linear(d_model, horizon)
                self.dropout = nn.Dropout(dropout)

            def forward(self, x):
                x = x.unsqueeze(-1)
                x = self.input_proj(x) + self.pos_enc
                x = self.encoder(x)
                x = x.mean(dim=1)
                return self.fc(self.dropout(x))

        model = TransformerModel(seq_len, args.d_model, args.n_heads, 2, horizon, 0.1).to(device)
        total_params = sum(p.numel() for p in model.parameters())
        print(f"[MODEL] Transformer: {total_params:,} params, d_model={args.d_model}, heads={args.n_heads}")

        optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=5, factor=0.5)
        criterion = nn.MSELoss()

        X_train_t = torch.FloatTensor(X_train)
        y_train_t = torch.FloatTensor(y_train)
        X_test_t = torch.FloatTensor(X_test)
        y_test_t = torch.FloatTensor(y_test)

        best_loss = float("inf")
        patience_counter = 0
        epochs = args.epochs if hasattr(args, "epochs") else 50

        print(f"\n{'Epoch':<8} {'Train Loss':<14} {'Val Loss':<14} {'Status'}")
        print("-" * 50)
        sys.stdout.flush()

        for epoch in range(epochs):
            model.train()
            indices = torch.randperm(len(X_train_t))
            total_loss = 0
            batches = 0
            bs = 64

            for start in range(0, len(X_train_t), bs):
                end = min(start + bs, len(X_train_t))
                idx = indices[start:end]
                xb = X_train_t[idx].to(device)
                yb = y_train_t[idx].to(device)

                optimizer.zero_grad()
                pred = model(xb)
                loss = criterion(pred, yb)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                total_loss += loss.item()
                batches += 1

            train_loss = total_loss / batches

            model.eval()
            with torch.no_grad():
                val_pred = model(X_test_t.to(device))
                val_loss = criterion(val_pred, y_test_t.to(device)).item()

            scheduler.step(val_loss)

            if val_loss < best_loss:
                best_loss = val_loss
                patience_counter = 0
                status = "improved"
            else:
                patience_counter += 1
                status = f"patience {patience_counter}/10"

            if (epoch + 1) % max(1, epochs // 15) == 0 or epoch == 0 or patience_counter == 0:
                print(f"  {epoch+1:<6} {train_loss:<14.6f} {val_loss:<14.6f} {status}")
                sys.stdout.flush()

            if patience_counter >= 10:
                print(f"[INFO] Early stopping at epoch {epoch+1}")
                break

        # Predict
        model.eval()
        with torch.no_grad():
            preds = model(X_test_t.to(device)).cpu().numpy()
            last_seq = torch.FloatTensor(normed[-seq_len:]).unsqueeze(0)
            forecast = model(last_seq.to(device)).cpu().numpy()[0]

    else:
        # NumPy fallback: simple attention with proper 3D shapes
        d_model = args.d_model
        np.random.seed(42)
        # Project input (batch, seq_len) -> (batch, seq_len, d_model) via per-position weights
        W_in = np.random.randn(1, d_model) * 0.1  # broadcast over seq_len
        W_q = np.random.randn(d_model, d_model) * 0.1
        W_k = np.random.randn(d_model, d_model) * 0.1
        W_v = np.random.randn(d_model, d_model) * 0.1
        W_out = np.random.randn(d_model, horizon) * 0.1
        lr = 0.001
        best_loss = float("inf")

        for epoch in range(50):
            batch_idx = np.random.choice(len(X_train), min(64, len(X_train)), replace=False)
            X_b, y_b = X_train[batch_idx], y_train[batch_idx]
            # X_b: (batch, seq_len) -> embed to (batch, seq_len, d_model)
            X_emb = X_b[:, :, np.newaxis] * W_in  # (batch, seq_len, d_model)
            Q = X_emb @ W_q  # (batch, seq_len, d_model)
            K = X_emb @ W_k
            V = X_emb @ W_v
            attn = np.exp(Q @ K.transpose(0, 2, 1) / np.sqrt(d_model))
            attn = attn / (attn.sum(axis=-1, keepdims=True) + 1e-8)
            context = (attn @ V).mean(axis=1)  # (batch, d_model)
            pred = context @ W_out  # (batch, horizon)
            loss = np.mean((pred - y_b) ** 2)
            best_loss = min(best_loss, loss)
            # Gradient update on W_out
            grad = context.T @ (2 * (pred - y_b) / len(y_b))
            W_out -= lr * grad
            if epoch % 10 == 0:
                print(f"  Epoch {epoch}: loss={loss:.6f}")

        # Predict on test set
        X_emb = X_test[:, :, np.newaxis] * W_in
        Q = X_emb @ W_q
        K = X_emb @ W_k
        V = X_emb @ W_v
        attn = np.exp(Q @ K.transpose(0, 2, 1) / np.sqrt(d_model))
        attn = attn / (attn.sum(axis=-1, keepdims=True) + 1e-8)
        preds = (attn @ V).mean(axis=1) @ W_out

        # Forecast from last sequence
        last_seq = normed[-seq_len:].reshape(1, -1)
        X_emb_f = last_seq[:, :, np.newaxis] * W_in
        Q_f = X_emb_f @ W_q
        K_f = X_emb_f @ W_k
        V_f = X_emb_f @ W_v
        attn_f = np.exp(Q_f @ K_f.transpose(0, 2, 1) / np.sqrt(d_model))
        attn_f = attn_f / (attn_f.sum(axis=-1, keepdims=True) + 1e-8)
        forecast = ((attn_f @ V_f).mean(axis=1) @ W_out)[0]

    # De-normalise
    preds_real = preds * sigma + mu
    y_test_real = y_test * sigma + mu
    forecast_real = forecast * sigma + mu

    mae = float(np.mean(np.abs(preds_real - y_test_real)))
    rmse = float(np.sqrt(np.mean((preds_real - y_test_real) ** 2)))
    last_prices = X_test[:, -1] * sigma + mu
    pred_dir = (preds_real[:, 0] > last_prices).astype(int)
    actual_dir = (y_test_real[:, 0] > last_prices).astype(int)
    dir_acc = float(np.mean(pred_dir == actual_dir))

    elapsed = time.time() - start_time

    print(f"\n[RESULTS] MAE: {mae:.4f}, RMSE: {rmse:.4f}, Direction: {dir_acc:.2%}")
    print(f"[RESULTS] Training time: {elapsed:.1f}s")
    sys.stdout.flush()

    results = {
        "metrics": {
            "mae": round(mae, 4),
            "rmse": round(rmse, 4),
            "direction_accuracy": round(dir_acc, 4),
            "training_loss": round(float(best_loss), 6),
            "test_samples": int(len(X_test)),
        },
        "forecast": {
            "current_price": float(close[-1]),
            "values": forecast_real.tolist() if hasattr(forecast_real, "tolist") else list(forecast_real),
            "horizon": horizon,
        },
        "config": {
            "dataset": args.dataset,
            "timeframe": args.timeframe,
            "data_points": int(len(close)),
            "training_time_s": round(elapsed, 2),
            "mode": "gpu_pytorch" if use_torch and str(device) in ("cuda", "mps") else "cpu",
            "device": str(device) if device else "cpu",
        },
    }
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transformer Price Forecast")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--forecast_horizon", type=int, default=10)
    parser.add_argument("--d_model", type=int, default=64)
    parser.add_argument("--n_heads", type=int, default=4)
    parser.add_argument("--sequence_length", type=int, default=60)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    job_id = args.job_id if hasattr(args, "job_id") else ""
    results = main(args)
    # Save model weights if job_id provided
    if args.job_id:
        weight_path = save_model_weights(results, args.job_id, trained_model=None, metadata={
            "model_type": "Transformer",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
