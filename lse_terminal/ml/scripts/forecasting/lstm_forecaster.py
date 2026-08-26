#!/usr/bin/env python3
"""
LSTM Price Forecaster (PyTorch + CUDA)
========================================
Production LSTM using PyTorch with automatic CUDA GPU detection.
Falls back to CPU if PyTorch/CUDA not available.

Output format matches the LSE Terminal API contract.
"""

import argparse
import json
import sys
import os
import warnings
import time
from datetime import datetime

import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils import compute_features, get_device, fetch_dataset, save_model_weights

warnings.filterwarnings("ignore")


# Device detection and data fetching are handled in utils.py



class TorchLSTM:
    """PyTorch LSTM model with CUDA support."""

    def __init__(self, input_size, hidden_size, num_layers, output_size, dropout, lr, device):
        import torch
        import torch.nn as nn

        self.device = device
        self.torch = torch

        class LSTMModel(nn.Module):
            def __init__(self):
                super().__init__()
                self.lstm = nn.LSTM(
                    input_size=input_size,
                    hidden_size=hidden_size,
                    num_layers=num_layers,
                    batch_first=True,
                    dropout=dropout if num_layers > 1 else 0,
                )
                self.fc1 = nn.Linear(hidden_size, hidden_size // 2)
                self.relu = nn.ReLU()
                self.dropout = nn.Dropout(dropout)
                self.fc2 = nn.Linear(hidden_size // 2, output_size)

            def forward(self, x):
                lstm_out, _ = self.lstm(x)
                last = lstm_out[:, -1, :]
                x = self.dropout(self.relu(self.fc1(last)))
                return self.fc2(x)

        self.model = LSTMModel().to(device)
        self.criterion = nn.MSELoss()
        self.optimizer = torch.optim.Adam(self.model.parameters(), lr=lr)
        self.scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer, mode="min", factor=0.5, patience=5
        )

        total_params = sum(p.numel() for p in self.model.parameters())
        print(f"[MODEL] LSTM: {total_params:,} parameters, {num_layers} layers, {hidden_size} hidden")
        sys.stdout.flush()

    def train_epoch(self, X_train, y_train, batch_size):
        import torch
        self.model.train()
        n = len(X_train)
        indices = torch.randperm(n)
        total_loss = 0
        batches = 0

        for start in range(0, n, batch_size):
            end = min(start + batch_size, n)
            idx = indices[start:end]
            X_batch = X_train[idx].to(self.device)
            y_batch = y_train[idx].to(self.device)

            self.optimizer.zero_grad()
            pred = self.model(X_batch)
            loss = self.criterion(pred, y_batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            self.optimizer.step()

            total_loss += loss.item()
            batches += 1

        return total_loss / batches

    def evaluate(self, X_test, y_test, batch_size=256):
        import torch
        self.model.eval()
        total_loss = 0
        all_preds = []
        batches = 0

        with torch.no_grad():
            for start in range(0, len(X_test), batch_size):
                end = min(start + batch_size, len(X_test))
                X_batch = X_test[start:end].to(self.device)
                y_batch = y_test[start:end].to(self.device)

                pred = self.model(X_batch)
                loss = self.criterion(pred, y_batch)
                total_loss += loss.item()
                all_preds.append(pred.cpu().numpy())
                batches += 1

        return total_loss / batches, np.concatenate(all_preds, axis=0)

    def predict(self, X):
        import torch
        self.model.eval()
        with torch.no_grad():
            return self.model(X.to(self.device)).cpu().numpy()


class NumpyLSTMFallback:
    """Fallback NumPy LSTM for when PyTorch is not available."""

    def __init__(self, input_size, hidden_size, output_size, lr):
        scale = 1.0 / np.sqrt(hidden_size)
        self.hidden_size = hidden_size
        self.lr = lr
        self.Wf = np.random.randn(hidden_size, input_size + hidden_size) * scale
        self.bf = np.zeros((hidden_size, 1))
        self.Wi = np.random.randn(hidden_size, input_size + hidden_size) * scale
        self.bi = np.zeros((hidden_size, 1))
        self.Wc = np.random.randn(hidden_size, input_size + hidden_size) * scale
        self.bc = np.zeros((hidden_size, 1))
        self.Wo = np.random.randn(hidden_size, input_size + hidden_size) * scale
        self.bo = np.zeros((hidden_size, 1))
        self.Wy = np.random.randn(output_size, hidden_size) * scale
        self.by = np.zeros((output_size, 1))

    def sigmoid(self, x):
        return 1 / (1 + np.exp(-np.clip(x, -500, 500)))

    def forward(self, x_seq):
        h = np.zeros((self.hidden_size, 1))
        c = np.zeros((self.hidden_size, 1))
        for t in range(len(x_seq)):
            x_t = x_seq[t].reshape(-1, 1)
            concat = np.vstack([h, x_t])
            f = self.sigmoid(self.Wf @ concat + self.bf)
            i = self.sigmoid(self.Wi @ concat + self.bi)
            c_hat = np.tanh(self.Wc @ concat + self.bc)
            c = f * c + i * c_hat
            o = self.sigmoid(self.Wo @ concat + self.bo)
            h = o * np.tanh(c)
        return (self.Wy @ h + self.by).flatten()

    def train_step(self, x_seq, target):
        pred = self.forward(x_seq)
        loss = float(np.mean((pred - target) ** 2))
        h = np.zeros((self.hidden_size, 1))
        c = np.zeros((self.hidden_size, 1))
        for t in range(len(x_seq)):
            x_t = x_seq[t].reshape(-1, 1)
            concat = np.vstack([h, x_t])
            f = self.sigmoid(self.Wf @ concat + self.bf)
            i = self.sigmoid(self.Wi @ concat + self.bi)
            c_hat = np.tanh(self.Wc @ concat + self.bc)
            c = f * c + i * c_hat
            o = self.sigmoid(self.Wo @ concat + self.bo)
            h = o * np.tanh(c)
        error = (pred.reshape(-1, 1) - target.reshape(-1, 1))
        self.Wy -= self.lr * error @ h.T
        self.by -= self.lr * error
        noise_scale = self.lr * 0.01
        self.Wf -= noise_scale * np.random.randn(*self.Wf.shape) * (loss - 0.01)
        self.Wi -= noise_scale * np.random.randn(*self.Wi.shape) * (loss - 0.01)
        self.Wc -= noise_scale * np.random.randn(*self.Wc.shape) * (loss - 0.01)
        self.Wo -= noise_scale * np.random.randn(*self.Wo.shape) * (loss - 0.01)
        return loss


def main(params: dict) -> dict:
    print("=" * 60)
    print("LSTM Price Forecaster")
    print("=" * 60)
    print(f"Started at: {datetime.now().isoformat()}")
    sys.stdout.flush()

    dataset = params.get('dataset', 'candles_15m')
    sequence_length = int(params.get("sequence_length", 60))
    forecast_horizon = int(params.get("forecast_horizon", 10))
    test_size_pct = int(params.get("test_size", 20)) / 100
    lstm_units = int(params.get("lstm_units", 128))
    num_layers = int(params.get("num_layers", 2))
    epochs = int(params.get("epochs", 100))
    batch_size = int(params.get("batch_size", 256))
    learning_rate = float(params.get("learning_rate", 0.001))
    dropout = float(params.get("dropout", 0.2))
    features = params.get("features", None)
    early_stopping = int(params.get("early_stopping", 15))

    device = get_device()
    use_torch = device is not None

    if not use_torch:
        epochs = min(epochs, 100)
        print("[FALLBACK] Using NumPy CPU mode")

    print(f"\n[CONFIG] Dataset: {dataset}")
    print(f"[CONFIG] Sequence Length: {sequence_length}")
    print(f"[CONFIG] Forecast Horizon: {forecast_horizon}")
    print(f"[CONFIG] LSTM Units: {lstm_units}")
    print(f"[CONFIG] Layers: {num_layers}")
    print(f"[CONFIG] Epochs: {epochs}")
    print(f"[CONFIG] Batch Size: {batch_size}")
    print(f"[CONFIG] Learning Rate: {learning_rate}")
    print(f"[CONFIG] Mode: {'GPU (PyTorch, ' + str(device) + ')' if use_torch and str(device) in ('cuda', 'mps') else 'CPU (PyTorch)' if use_torch else 'CPU (NumPy)'}")
    sys.stdout.flush()

    # Fetch data
    df = fetch_dataset(dataset, features)

    # Prepare features
    exclude_cols = ["timestamp", "id", "created_at"]
    numeric_cols = [c for c in df.columns if c not in exclude_cols and df[c].dtype in ["float64", "int64", "float32", "int32"]]
    if features:
        numeric_cols = [c for c in features if c in numeric_cols]
    if "close" not in numeric_cols:
        numeric_cols.insert(0, "close")

    data = df[numeric_cols].dropna().values.astype(np.float64)

    # Only cap for CPU mode
    if not use_torch or str(device) == "cpu":
        max_rows = 5000
        if len(data) > max_rows:
            print(f"[INFO] CPU mode: trimming from {len(data):,} to last {max_rows:,}")
            data = data[-max_rows:]
    else:
        # GPU mode: use all data (up to 100k for memory safety on 32GB)
        max_rows = 100000
        if len(data) > max_rows:
            print(f"[INFO] GPU mode: using last {max_rows:,} of {len(data):,} rows")
            data = data[-max_rows:]
        else:
            print(f"[INFO] GPU mode: using all {len(data):,} rows")

    input_size = data.shape[1]
    print(f"[INFO] Using {input_size} features: {numeric_cols}")
    sys.stdout.flush()

    # Scale data
    scaler = MinMaxScaler()
    scaled = scaler.fit_transform(data)

    # Create sequences
    close_idx = numeric_cols.index("close")
    X_sequences = []
    y_targets = []

    print(f"[INFO] Creating sequences...")
    sys.stdout.flush()

    for i in range(sequence_length, len(scaled) - forecast_horizon):
        X_sequences.append(scaled[i - sequence_length:i])
        y_targets.append(scaled[i:i + forecast_horizon, close_idx])

    X = np.array(X_sequences)
    y = np.array(y_targets)
    print(f"[INFO] Created {len(X):,} sequences of length {sequence_length}")
    sys.stdout.flush()

    # Split
    split_idx = int(len(X) * (1 - test_size_pct))
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    print(f"[INFO] Train: {len(X_train):,}, Test: {len(X_test):,}")
    sys.stdout.flush()

    # ========== TRAINING ==========
    start_time = time.time()
    train_losses = []
    val_losses = []
    best_val_loss = float("inf")
    patience_counter = 0

    if use_torch:
        import torch
        X_train_t = torch.FloatTensor(X_train)
        y_train_t = torch.FloatTensor(y_train)
        X_test_t = torch.FloatTensor(X_test)
        y_test_t = torch.FloatTensor(y_test)

        model = TorchLSTM(input_size, lstm_units, num_layers, forecast_horizon, dropout, learning_rate, device)

        print(f"\n[TRAINING] Starting PyTorch training on {device}...")
        print(f"{'Epoch':<8} {'Train Loss':<14} {'Val Loss':<14} {'LR':<12} {'Status'}")
        print("-" * 60)
        sys.stdout.flush()

        for epoch in range(epochs):
            train_loss = model.train_epoch(X_train_t, y_train_t, batch_size)
            val_loss, val_preds = model.evaluate(X_test_t, y_test_t)

            train_losses.append(train_loss)
            val_losses.append(val_loss)
            model.scheduler.step(val_loss)

            if val_loss < best_val_loss:
                best_val_loss = val_loss
                patience_counter = 0
                best_preds = val_preds.copy()
                status = "improved"
            else:
                patience_counter += 1
                status = f"patience {patience_counter}/{early_stopping}"

            current_lr = model.optimizer.param_groups[0]["lr"]

            # Print every epoch for live feedback
            if (epoch + 1) % max(1, epochs // 20) == 0 or epoch == 0 or patience_counter == 0:
                print(f"  {epoch+1:<6} {train_loss:<14.6f} {val_loss:<14.6f} {current_lr:<12.6f} {status}")
                sys.stdout.flush()

            if patience_counter >= early_stopping:
                print(f"\n[INFO] Early stopping at epoch {epoch+1}")
                break

        # Final predictions
        _, all_preds = model.evaluate(X_test_t, y_test_t)

    else:
        # NumPy fallback
        model = NumpyLSTMFallback(input_size, lstm_units, forecast_horizon, learning_rate)
        max_rows_cpu = 5000

        print(f"\n[TRAINING] Starting NumPy CPU training...")
        print(f"{'Epoch':<8} {'Train Loss':<14} {'Val Loss':<14} {'Status'}")
        print("-" * 50)
        sys.stdout.flush()

        for epoch in range(epochs):
            epoch_losses = []
            indices = np.random.permutation(len(X_train))[:min(batch_size * 10, len(X_train))]
            for idx in indices:
                loss = model.train_step(X_train[idx], y_train[idx])
                epoch_losses.append(loss)
            train_loss = float(np.mean(epoch_losses))
            train_losses.append(train_loss)

            val_preds = []
            for i in range(min(100, len(X_test))):
                pred = model.forward(X_test[i])
                val_preds.append(pred)
            val_preds = np.array(val_preds)
            val_loss = float(np.mean((val_preds - y_test[:len(val_preds)]) ** 2))
            val_losses.append(val_loss)

            if val_loss < best_val_loss:
                best_val_loss = val_loss
                patience_counter = 0
                status = "improved"
            else:
                patience_counter += 1
                status = f"patience {patience_counter}/{early_stopping}"

            if (epoch + 1) % max(1, epochs // 10) == 0 or epoch == 0:
                print(f"  {epoch+1:<6} {train_loss:<14.6f} {val_loss:<14.6f} {status}")
                sys.stdout.flush()

            if patience_counter >= early_stopping:
                print(f"\n[INFO] Early stopping at epoch {epoch+1}")
                break

        # Final predictions
        all_preds = []
        for i in range(len(X_test)):
            pred = model.forward(X_test[i])
            all_preds.append(pred)
        all_preds = np.array(all_preds)

    training_time = time.time() - start_time
    print(f"\n[TRAINING] Completed in {training_time:.1f}s ({len(train_losses)} epochs)")
    sys.stdout.flush()

    # ========== EVALUATION ==========
    print(f"[EVAL] Computing metrics...")
    sys.stdout.flush()

    # Inverse scale predictions
    dummy_pred = np.zeros((len(all_preds), input_size))
    dummy_actual = np.zeros((len(y_test), input_size))
    dummy_pred[:, close_idx] = all_preds[:, 0]
    dummy_actual[:, close_idx] = y_test[:, 0]

    pred_prices = scaler.inverse_transform(dummy_pred)[:, close_idx]
    actual_prices = scaler.inverse_transform(dummy_actual)[:, close_idx]

    mae = float(mean_absolute_error(actual_prices, pred_prices))
    rmse = float(np.sqrt(mean_squared_error(actual_prices, pred_prices)))
    mape = float(np.mean(np.abs((actual_prices - pred_prices) / (actual_prices + 1e-10))) * 100)

    actual_dir = np.diff(actual_prices) > 0
    pred_dir = np.diff(pred_prices) > 0
    direction_accuracy = float(np.mean(actual_dir == pred_dir)) if len(actual_dir) > 0 else 0

    # Generate forecast
    last_sequence = scaled[-sequence_length:]
    if use_torch:
        import torch
        last_seq_t = torch.FloatTensor(last_sequence).unsqueeze(0)
        forecast_scaled = model.predict(last_seq_t)[0]
    else:
        forecast_scaled = model.forward(last_sequence)

    forecast_prices = []
    for step in range(forecast_horizon):
        dummy_forecast = np.zeros((1, input_size))
        dummy_forecast[0, close_idx] = forecast_scaled[step]
        price = scaler.inverse_transform(dummy_forecast)[0, close_idx]
        forecast_prices.append(float(price))

    current_price = float(data[-1, close_idx])

    print(f"\n[RESULTS] Model Performance:")
    print(f"  - MAE:  {mae:.4f}")
    print(f"  - RMSE: {rmse:.4f}")
    print(f"  - MAPE: {mape:.2f}%")
    print(f"  - Direction Accuracy: {direction_accuracy:.2%}")
    print(f"\n[RESULTS] Forecast (next {forecast_horizon} steps):")
    print(f"  - Current price: {current_price:.2f}")
    print(f"  - Forecast end:  {forecast_prices[-1]:.2f}")
    print(f"  - Change:        {((forecast_prices[-1] / current_price) - 1) * 100:.2f}%")
    print(f"\n[RESULTS] Training:")
    print(f"  - Mode: {'GPU' if use_torch and str(device) in ('cuda', 'mps') else 'CPU'}")
    print(f"  - Training time: {training_time:.1f}s")
    print(f"  - Final train loss: {train_losses[-1]:.6f}")
    print(f"  - Best val loss:    {best_val_loss:.6f}")
    print(f"  - Epochs trained:   {len(train_losses)}")
    sys.stdout.flush()

    results = {
        "metrics": {
            "mae": round(mae, 4),
            "rmse": round(rmse, 4),
            "mape": round(mape, 2),
            "direction_accuracy": round(direction_accuracy, 4),
            "final_train_loss": round(train_losses[-1], 6),
            "best_val_loss": round(best_val_loss, 6),
        },
        "forecast": {
            "values": forecast_prices,
            "current_price": current_price,
        },
        "config": {
            "dataset": dataset,
            "sequence_length": sequence_length,
            "forecast_horizon": forecast_horizon,
            "lstm_units": lstm_units,
            "num_layers": num_layers,
            "epochs_trained": len(train_losses),
            "batch_size": batch_size,
            "features_used": numeric_cols,
            "training_time_s": round(training_time, 1),
            "mode": "gpu_pytorch" if use_torch and str(device) in ("cuda", "mps") else "cpu_pytorch" if use_torch else "cpu_numpy",
            "device": str(device) if device else "cpu",
            "data_rows": len(data),
            "training_history": {
                "train_losses": [round(l, 6) for l in train_losses[-20:]],
                "val_losses": [round(l, 6) for l in val_losses[-20:]],
            },
        },
    }

    print(f"\n[DONE] Completed at: {datetime.now().isoformat()}")
    print("=" * 60)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LSTM Price Forecaster")
    parser.add_argument("--dataset", type=str, default='candles_15m')
    parser.add_argument("--sequence_length", type=int, default=60)
    parser.add_argument("--forecast_horizon", type=int, default=10)
    parser.add_argument("--test_size", type=int, default=20)
    parser.add_argument("--lstm_units", type=int, default=128)
    parser.add_argument("--num_layers", type=int, default=2)
    parser.add_argument("--dense_units", type=int, default=32)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch_size", type=int, default=256)
    parser.add_argument("--learning_rate", type=float, default=0.001)
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--early_stopping", type=int, default=15)
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
            "model_type": "LSTM",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, indent=2))
    print("[/RESULTS_JSON]")
