#!/usr/bin/env python3
"""
GAN Price Simulation (PyTorch + CUDA)
=======================================
Generative Adversarial Network for simulating price paths.
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
    print("GAN Price Simulation")
    print("=" * 60)
    sys.stdout.flush()

    device = get_device()
    use_torch = device is not None

    data = fetch_ohlcv(args.dataset, args.timeframe)
    close = data["close"]
    returns = np.diff(np.log(close))
    seq_len = args.sequence_length
    latent_dim = args.latent_dim

    # Build return sequences
    seqs = [returns[i:i + seq_len] for i in range(len(returns) - seq_len)]
    real_data = np.array(seqs)
    print(f"[INFO] Built {len(real_data):,} return sequences of length {seq_len}")
    sys.stdout.flush()

    start_time = time.time()

    if use_torch:
        import torch
        import torch.nn as nn

        class Generator(nn.Module):
            def __init__(self, latent_dim, seq_len):
                super().__init__()
                self.net = nn.Sequential(
                    nn.Linear(latent_dim, 128),
                    nn.ReLU(),
                    nn.Linear(128, 256),
                    nn.ReLU(),
                    nn.Linear(256, seq_len),
                    nn.Tanh(),
                )
                self.scale = float(np.std(returns))

            def forward(self, z):
                return self.net(z) * self.scale

        class Discriminator(nn.Module):
            def __init__(self, seq_len):
                super().__init__()
                self.net = nn.Sequential(
                    nn.Linear(seq_len, 256),
                    nn.LeakyReLU(0.2),
                    nn.Dropout(0.3),
                    nn.Linear(256, 128),
                    nn.LeakyReLU(0.2),
                    nn.Dropout(0.3),
                    nn.Linear(128, 1),
                    nn.Sigmoid(),
                )

            def forward(self, x):
                return self.net(x).squeeze(-1)

        gen = Generator(latent_dim, seq_len).to(device)
        disc = Discriminator(seq_len).to(device)
        g_params = sum(p.numel() for p in gen.parameters())
        d_params = sum(p.numel() for p in disc.parameters())
        print(f"[MODEL] Generator: {g_params:,} params, Discriminator: {d_params:,} params")

        opt_g = torch.optim.Adam(gen.parameters(), lr=0.0002, betas=(0.5, 0.999))
        opt_d = torch.optim.Adam(disc.parameters(), lr=0.0002, betas=(0.5, 0.999))
        criterion = nn.BCELoss()

        real_t = torch.FloatTensor(real_data).to(device)
        g_losses, d_losses = [], []

        print(f"\n{'Epoch':<8} {'D Loss':<14} {'G Loss':<14} {'D(real)':<10} {'D(fake)'}")
        print("-" * 60)
        sys.stdout.flush()

        for epoch in range(args.epochs):
            bs = min(128, len(real_t))
            idx = torch.randint(0, len(real_t), (bs,))
            real_batch = real_t[idx]

            # Train Discriminator
            noise = torch.randn(bs, latent_dim, device=device)
            fake = gen(noise).detach()
            real_labels = torch.ones(bs, device=device) * 0.9  # Label smoothing
            fake_labels = torch.zeros(bs, device=device) + 0.1

            opt_d.zero_grad()
            d_real = disc(real_batch)
            d_fake = disc(fake)
            d_loss = (criterion(d_real, real_labels) + criterion(d_fake, fake_labels)) / 2
            d_loss.backward()
            opt_d.step()

            # Train Generator
            noise = torch.randn(bs, latent_dim, device=device)
            fake = gen(noise)
            opt_g.zero_grad()
            g_loss = criterion(disc(fake), torch.ones(bs, device=device))
            g_loss.backward()
            opt_g.step()

            g_losses.append(g_loss.item())
            d_losses.append(d_loss.item())

            if (epoch + 1) % max(1, args.epochs // 15) == 0 or epoch == 0:
                print(f"  {epoch+1:<6} {d_loss.item():<14.4f} {g_loss.item():<14.4f} "
                      f"{d_real.mean().item():<10.3f} {d_fake.mean().item():.3f}")
                sys.stdout.flush()

        # Generate simulations
        gen.eval()
        with torch.no_grad():
            noise = torch.randn(args.num_simulations, latent_dim, device=device)
            sim_returns = gen(noise).cpu().numpy()

    else:
        # NumPy fallback
        np.random.seed(42)
        W_g1 = np.random.randn(latent_dim, 32) * 0.1
        W_g2 = np.random.randn(32, seq_len) * 0.1
        W_d1 = np.random.randn(seq_len, 32) * 0.1
        W_d2 = np.random.randn(32, 1) * 0.1

        def relu(x): return np.maximum(0, x)
        def sigmoid(x): return 1 / (1 + np.exp(-np.clip(x, -10, 10)))

        g_losses, d_losses = [], []
        for epoch in range(args.epochs):
            bs = min(64, len(real_data))
            idx = np.random.choice(len(real_data), bs, replace=False)
            noise = np.random.randn(bs, latent_dim)
            fake = np.tanh(relu(noise @ W_g1) @ W_g2) * np.std(returns)
            real_score = sigmoid(relu(real_data[idx] @ W_d1) @ W_d2).flatten()
            fake_score = sigmoid(relu(fake @ W_d1) @ W_d2).flatten()
            d_loss = -np.mean(np.log(real_score + 1e-8) + np.log(1 - fake_score + 1e-8))
            W_d2 -= 0.001 * relu(real_data[idx] @ W_d1).T @ (real_score - 1).reshape(-1, 1) / bs
            noise = np.random.randn(bs, latent_dim)
            fake = np.tanh(relu(noise @ W_g1) @ W_g2) * np.std(returns)
            fake_score = sigmoid(relu(fake @ W_d1) @ W_d2).flatten()
            g_loss = -np.mean(np.log(fake_score + 1e-8))
            g_losses.append(g_loss)
            d_losses.append(d_loss)
            if epoch % 20 == 0:
                print(f"  Epoch {epoch}: d_loss={d_loss:.4f}, g_loss={g_loss:.4f}")

        noise = np.random.randn(args.num_simulations, latent_dim)
        sim_returns = np.tanh(relu(noise @ W_g1) @ W_g2) * np.std(returns)

    # Convert to price paths
    last_price = float(close[-1])
    sim_prices = last_price * np.exp(np.cumsum(sim_returns, axis=1))
    final_prices = sim_prices[:, -1]

    elapsed = time.time() - start_time
    print(f"\n[RESULTS] Mean final price: {np.mean(final_prices):.2f}, P(up): {np.mean(final_prices > last_price):.2%}")
    print(f"[RESULTS] Training time: {elapsed:.1f}s")

    return {
        "metrics": {
            "final_g_loss": round(float(np.mean(g_losses[-10:])), 4),
            "final_d_loss": round(float(np.mean(d_losses[-10:])), 4),
            "num_simulations": args.num_simulations,
            "simulated_mean_return": round(float(np.mean(sim_returns)), 6),
            "simulated_vol": round(float(np.std(sim_returns)), 6),
            "real_vol": round(float(np.std(returns)), 6),
        },
        "forecast": {
            "current_price": last_price,
            "mean_price": round(float(np.mean(final_prices)), 2),
            "median_price": round(float(np.median(final_prices)), 2),
            "p5_price": round(float(np.percentile(final_prices, 5)), 2),
            "p95_price": round(float(np.percentile(final_prices, 95)), 2),
            "prob_up": round(float(np.mean(final_prices > last_price)), 4),
        },
        "distribution": {
            "mean_final": round(float(np.mean(final_prices)), 2),
            "std_final": round(float(np.std(final_prices)), 2),
            "min_final": round(float(np.min(final_prices)), 2),
            "max_final": round(float(np.max(final_prices)), 2),
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
    parser = argparse.ArgumentParser(description="GAN Price Simulation")
    parser.add_argument("--dataset", default='candles_15m')
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--start_date", default=None)
    parser.add_argument("--end_date", default=None)
    parser.add_argument("--latent_dim", type=int, default=32)
    parser.add_argument("--sequence_length", type=int, default=30)
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--num_simulations", type=int, default=500)
    parser.add_argument("--features", nargs="*", default=["open", "high", "low", "close", "volume"])
    parser.add_argument("--job_id", type=str, default="")
    args, _unknown = parser.parse_known_args()

    job_id = args.job_id if hasattr(args, "job_id") else ""
    results = main(args)
    # Save model weights if job_id provided
    if args.job_id:
        weight_path = save_model_weights(results, args.job_id, metadata={
            "model_type": "GAN",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, default=str))
    print("[/RESULTS_JSON]")
