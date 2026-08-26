#!/usr/bin/env python3
"""
XGBoost Price Direction Classifier
===================================
Trains an XGBoost model to predict if price will go UP or DOWN
in the next N candles based on technical indicators.

Usage:
    python xgboost_classifier.py --config params.json
    python xgboost_classifier.py --dataset candles_15m --target_horizon 5

All parameters match the LSE Terminal UI.
"""

import argparse
import json
import sys
import os
from datetime import datetime

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, classification_report
try:
    import xgboost as xgb
    HAS_XGBOOST = True
except ImportError:
    from sklearn.ensemble import GradientBoostingClassifier
    HAS_XGBOOST = False
    print("[INFO] xgboost not installed, using sklearn GradientBoostingClassifier fallback")
import joblib

# Import shared data fetching from utils
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from utils import fetch_dataset, compute_features, save_model_weights


def create_target(df: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """
    Create binary target: 1 if price goes UP in next 'horizon' candles, else 0.
    """
    df = df.copy()
    df['future_close'] = df['close'].shift(-horizon)
    df['target'] = (df['future_close'] > df['close']).astype(int)
    
    # Drop rows where we can't compute future (last 'horizon' rows)
    df = df.dropna(subset=['target'])
    df = df.drop(columns=['future_close'])
    
    # Show target distribution
    up_count = df['target'].sum()
    down_count = len(df) - up_count
    print(f"[INFO] Target distribution: UP={up_count} ({up_count/len(df)*100:.1f}%), DOWN={down_count} ({down_count/len(df)*100:.1f}%)")
    
    return df


def prepare_features(df: pd.DataFrame, feature_columns: list) -> tuple:
    """
    Prepare feature matrix X and target y.
    """
    # Remove non-feature columns
    exclude_cols = ['timestamp', 'target', 'id', 'created_at']
    
    if feature_columns:
        # Use only specified features
        X_cols = [c for c in feature_columns if c in df.columns and c not in exclude_cols]
    else:
        # Use all numeric columns except excluded
        X_cols = [c for c in df.columns if c not in exclude_cols and df[c].dtype in ['float64', 'int64', 'float32', 'int32']]
    
    print(f"[INFO] Using features: {X_cols}")
    
    X = df[X_cols]
    y = df['target']
    
    # Handle any NaN values
    initial_rows = len(X)
    X = X.dropna()
    y = y.loc[X.index]
    
    if len(X) < initial_rows:
        print(f"[WARNING] Dropped {initial_rows - len(X)} rows with NaN values")
    
    return X, y, X_cols


def train_xgboost(
    X_train, y_train, X_test, y_test,
    n_estimators: int = 100,
    max_depth: int = 6,
    learning_rate: float = 0.1,
    min_child_weight: int = 1,
    subsample: float = 0.8,
    colsample_bytree: float = 0.8,
    reg_alpha: float = 0,
    reg_lambda: float = 1,
    early_stopping_rounds: int = 10
) -> tuple:
    """
    Train XGBoost classifier with the specified hyperparameters.
    Falls back to sklearn GradientBoostingClassifier if xgboost is not installed.
    Shows real-time progress with loss metrics.
    """
    print(f"\n[TRAINING] Configuration:")
    print(f"  - n_estimators: {n_estimators}")
    print(f"  - max_depth: {max_depth}")
    print(f"  - learning_rate: {learning_rate}")
    print(f"  - subsample: {subsample}")
    sys.stdout.flush()

    training_history = {'train_losses': [], 'val_losses': []}

    if HAS_XGBOOST:
        print(f"\n[PROGRESS] Starting XGBoost training with {n_estimators} trees...")
        print(f"{'Epoch':<8} {'Train Loss':<14} {'Val Loss':<14} {'Status'}")
        print("-" * 50)
        sys.stdout.flush()

        # Detect GPU and thread limits
        gpu_params = {}
        try:
            import torch
            if torch.cuda.is_available():
                # XGBoost 2.x uses device='cuda' + tree_method='hist'
                # Older XGBoost uses tree_method='gpu_hist'
                xgb_major = int(xgb.__version__.split('.')[0])
                if xgb_major >= 2:
                    gpu_params = {"tree_method": "hist", "device": "cuda"}
                else:
                    gpu_params = {"tree_method": "gpu_hist"}
                print(f"[GPU] XGBoost {xgb.__version__} using CUDA acceleration")
        except (ImportError, Exception):
            pass
        _n_jobs = int(os.environ.get("OMP_NUM_THREADS", 0)) or -1

        model = xgb.XGBClassifier(
            n_estimators=n_estimators,
            max_depth=max_depth,
            learning_rate=learning_rate,
            min_child_weight=min_child_weight,
            subsample=subsample,
            colsample_bytree=colsample_bytree,
            reg_alpha=reg_alpha,
            reg_lambda=reg_lambda,
            objective='binary:logistic',
            eval_metric='logloss',
            random_state=42,
            n_jobs=_n_jobs,
            callbacks=[xgb.callback.EvaluationMonitor(period=max(1, n_estimators // 10))],
            **gpu_params,
        )

        eval_set = [(X_train, y_train), (X_test, y_test)]
        model.fit(X_train, y_train, eval_set=eval_set, verbose=True)

        results = model.evals_result()
        training_history['train_losses'] = results.get('validation_0', {}).get('logloss', [])
        training_history['val_losses'] = results.get('validation_1', {}).get('logloss', [])

        best_iteration = model.best_iteration if hasattr(model, 'best_iteration') and model.best_iteration else n_estimators
    else:
        print(f"\n[PROGRESS] Starting GradientBoosting (sklearn fallback) with {n_estimators} trees...")
        sys.stdout.flush()

        model = GradientBoostingClassifier(
            n_estimators=n_estimators,
            max_depth=max_depth,
            learning_rate=learning_rate,
            subsample=subsample,
            random_state=42,
        )
        model.fit(X_train, y_train)
        best_iteration = n_estimators
        print(f"[INFO] Training complete.")

    # Show improvement summary
    if training_history['val_losses']:
        val_losses = training_history['val_losses']
        initial_loss = val_losses[0]
        final_loss = val_losses[-1]
        improvement = ((initial_loss - final_loss) / initial_loss) * 100
        print(f"\n[PROGRESS] Loss improved by {improvement:.1f}% ({initial_loss:.4f} -> {final_loss:.4f})")

    print(f"[INFO] Best iteration: {best_iteration}")
    sys.stdout.flush()

    return model, best_iteration, training_history


def evaluate_model(model, X_test, y_test, feature_names: list) -> dict:
    """
    Evaluate model and return metrics.
    """
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]
    
    metrics = {
        'accuracy': round(accuracy_score(y_test, y_pred), 4),
        'precision': round(precision_score(y_test, y_pred, zero_division=0), 4),
        'recall': round(recall_score(y_test, y_pred, zero_division=0), 4),
        'f1_score': round(f1_score(y_test, y_pred, zero_division=0), 4),
    }
    
    # Feature importance
    importance = dict(zip(feature_names, model.feature_importances_.tolist()))
    importance = {k: round(v, 4) for k, v in sorted(importance.items(), key=lambda x: x[1], reverse=True)}
    
    print(f"\n[RESULTS] Model Performance:")
    print(f"  - Accuracy:  {metrics['accuracy']:.2%}")
    print(f"  - Precision: {metrics['precision']:.2%}")
    print(f"  - Recall:    {metrics['recall']:.2%}")
    print(f"  - F1 Score:  {metrics['f1_score']:.2%}")
    
    print(f"\n[RESULTS] Feature Importance (top 5):")
    for i, (feat, imp) in enumerate(list(importance.items())[:5]):
        print(f"  {i+1}. {feat}: {imp:.4f}")
    
    return {
        'metrics': metrics,
        'feature_importance': importance,
        'predictions': y_pred.tolist(),
        'probabilities': y_prob.tolist()
    }


def simulate_trades(df_test: pd.DataFrame, y_pred: np.ndarray, y_prob: np.ndarray,
                     target_horizon: int, confidence_threshold: float = 0.55,
                     sl_atr_mult: float = 1.5, tp_atr_mult: float = 2.0) -> dict:
    """
    Simulate trades on the test set using model predictions + ATR-based SL/TP.

    This turns abstract accuracy metrics into something traders understand:
    entry price, stop loss, take profit, win rate, and P&L.

    For each prediction where confidence > threshold:
      - LONG if prediction=1, SHORT if prediction=0
      - SL/TP set as multiples of ATR(14) at entry
      - Walk forward candle-by-candle: check if high/low hits TP/SL first
      - If neither hit within target_horizon candles, exit at close (time stop)

    Returns a dict with trade-level detail and aggregate stats.
    """
    ohlc = df_test[['open', 'high', 'low', 'close']].values
    n = len(ohlc)

    # Compute ATR(14) for the test set so we have volatility at each bar
    high_arr = df_test['high'].values.astype(float)
    low_arr = df_test['low'].values.astype(float)
    close_arr = df_test['close'].values.astype(float)
    prev_close = np.roll(close_arr, 1)
    prev_close[0] = close_arr[0]
    tr = np.maximum(high_arr - low_arr,
                    np.maximum(np.abs(high_arr - prev_close), np.abs(low_arr - prev_close)))
    atr_14 = pd.Series(tr).rolling(window=14, min_periods=1).mean().values

    trades = []
    equity_curve = [0.0]  # cumulative P&L in price units

    i = 0
    while i < n:
        prob_up = y_prob[i]
        pred = y_pred[i]

        # Determine confidence: distance from 0.5 (uncertain) toward the predicted side
        confidence = prob_up if pred == 1 else (1.0 - prob_up)

        if confidence < confidence_threshold:
            i += 1
            continue

        atr_val = atr_14[i]
        # Skip if ATR is near zero (illiquid/flat), would produce nonsensical SL/TP
        if atr_val < 1e-10:
            i += 1
            continue

        entry_price = close_arr[i]
        direction = 'LONG' if pred == 1 else 'SHORT'

        if direction == 'LONG':
            sl_price = entry_price - sl_atr_mult * atr_val
            tp_price = entry_price + tp_atr_mult * atr_val
        else:
            sl_price = entry_price + sl_atr_mult * atr_val
            tp_price = entry_price - tp_atr_mult * atr_val

        # Walk forward through subsequent candles to resolve the trade
        exit_price = None
        exit_reason = None
        bars_held = 0

        for j in range(i + 1, min(i + 1 + target_horizon, n)):
            bars_held = j - i
            candle_high = high_arr[j]
            candle_low = low_arr[j]

            if direction == 'LONG':
                # Check SL first (conservative: assume worst case hit first)
                if candle_low <= sl_price:
                    exit_price = sl_price
                    exit_reason = 'stop_loss'
                    break
                if candle_high >= tp_price:
                    exit_price = tp_price
                    exit_reason = 'take_profit'
                    break
            else:  # SHORT
                if candle_high >= sl_price:
                    exit_price = sl_price
                    exit_reason = 'stop_loss'
                    break
                if candle_low <= tp_price:
                    exit_price = tp_price
                    exit_reason = 'take_profit'
                    break

        # Time stop: if neither SL nor TP hit within horizon, exit at last close
        if exit_price is None:
            last_bar = min(i + target_horizon, n - 1)
            exit_price = close_arr[last_bar]
            exit_reason = 'time_stop'
            bars_held = last_bar - i

        # Calculate P&L in price units
        if direction == 'LONG':
            pnl = exit_price - entry_price
        else:
            pnl = entry_price - exit_price

        # Risk-reward: how much was risked vs how much was gained
        risk = abs(entry_price - sl_price)
        reward_ratio = pnl / risk if risk > 0 else 0.0

        trades.append({
            'direction': direction,
            'entry_price': round(float(entry_price), 6),
            'sl_price': round(float(sl_price), 6),
            'tp_price': round(float(tp_price), 6),
            'exit_price': round(float(exit_price), 6),
            'exit_reason': exit_reason,
            'pnl': round(float(pnl), 6),
            'pnl_pct': round(float(pnl / entry_price * 100), 4),
            'reward_ratio': round(float(reward_ratio), 2),
            'bars_held': int(bars_held),
            'confidence': round(float(confidence), 4),
            'atr': round(float(atr_val), 6),
        })

        equity_curve.append(equity_curve[-1] + pnl)

        # Skip forward past this trade's holding period to avoid overlapping trades
        i += bars_held + 1
        continue

    # === Aggregate Stats ===
    if not trades:
        return {
            'trade_simulation': {
                'total_trades': 0,
                'note': 'No trades generated. Try lowering confidence threshold or using more data.',
            }
        }

    wins = [t for t in trades if t['pnl'] > 0]
    losses = [t for t in trades if t['pnl'] <= 0]
    total_profit = sum(t['pnl'] for t in wins)
    total_loss = abs(sum(t['pnl'] for t in losses))

    # Max drawdown from equity curve peak
    peak = equity_curve[0]
    max_dd = 0.0
    for eq in equity_curve:
        if eq > peak:
            peak = eq
        dd = peak - eq
        if dd > max_dd:
            max_dd = dd

    avg_win = total_profit / len(wins) if wins else 0.0
    avg_loss = total_loss / len(losses) if losses else 0.0
    win_rate = len(wins) / len(trades)

    # Expectancy per trade: (win_rate * avg_win) - (loss_rate * avg_loss)
    expectancy = (win_rate * avg_win) - ((1 - win_rate) * avg_loss)

    # Profit factor: gross profit / gross loss
    profit_factor = total_profit / total_loss if total_loss > 0 else float('inf')

    # Average R:R actually achieved
    avg_rr = np.mean([t['reward_ratio'] for t in trades])

    # Exit reason breakdown
    exit_reasons = {}
    for t in trades:
        exit_reasons[t['exit_reason']] = exit_reasons.get(t['exit_reason'], 0) + 1

    # Separate long/short stats
    longs = [t for t in trades if t['direction'] == 'LONG']
    shorts = [t for t in trades if t['direction'] == 'SHORT']
    long_wins = sum(1 for t in longs if t['pnl'] > 0)
    short_wins = sum(1 for t in shorts if t['pnl'] > 0)

    # Use last entry price as reference for expressing drawdown as percentage
    ref_price = trades[0]['entry_price'] if trades else 1.0

    result = {
        'trade_simulation': {
            'total_trades': len(trades),
            'win_rate': round(win_rate, 4),
            'profit_factor': round(profit_factor, 4) if profit_factor != float('inf') else 999.0,
            'expectancy_per_trade': round(float(expectancy), 6),
            'expectancy_pct': round(float(expectancy / ref_price * 100), 4),
            'avg_win': round(float(avg_win), 6),
            'avg_loss': round(float(avg_loss), 6),
            'avg_rr': round(float(avg_rr), 2),
            'max_drawdown': round(float(max_dd), 6),
            'max_drawdown_pct': round(float(max_dd / ref_price * 100), 4),
            'total_return': round(float(equity_curve[-1]), 6),
            'total_return_pct': round(float(equity_curve[-1] / ref_price * 100), 4),
            'long_trades': len(longs),
            'short_trades': len(shorts),
            'long_win_rate': round(long_wins / len(longs), 4) if longs else 0.0,
            'short_win_rate': round(short_wins / len(shorts), 4) if shorts else 0.0,
            'exit_reasons': exit_reasons,
            'avg_bars_held': round(float(np.mean([t['bars_held'] for t in trades])), 1),
            'confidence_threshold': confidence_threshold,
            'sl_atr_multiplier': sl_atr_mult,
            'tp_atr_multiplier': tp_atr_mult,
            # Include a sample of recent trades (last 20) for the frontend to display
            'sample_trades': trades[-20:],
        }
    }

    # Print summary so it shows in job logs
    print(f"\n[TRADE SIM] Results ({len(trades)} trades on test set):")
    print(f"  Win Rate:       {win_rate:.1%}")
    print(f"  Profit Factor:  {profit_factor:.2f}")
    print(f"  Avg R:R:        {avg_rr:.2f}")
    print(f"  Expectancy:     {expectancy / ref_price * 100:+.4f}% per trade")
    print(f"  Max Drawdown:   {max_dd / ref_price * 100:.4f}%")
    print(f"  Total Return:   {equity_curve[-1] / ref_price * 100:+.4f}%")
    print(f"  Exits: {exit_reasons}")
    print(f"  Longs: {len(longs)} ({long_wins}/{len(longs)} wins) | Shorts: {len(shorts)} ({short_wins}/{len(shorts)} wins)")
    sys.stdout.flush()

    return result


def optimize_sl_tp(df_test: pd.DataFrame, y_pred: np.ndarray, y_prob: np.ndarray,
                   target_horizon: int, confidence_threshold: float = 0.55) -> dict:
    """
    Grid-search over SL/TP ATR multiplier combinations to find the optimal pair.

    This is how quant firms approach exit optimization: test every reasonable
    SL/TP combination on the test set, rank by risk-adjusted return (Sharpe ratio
    approximation), and report the best along with the full grid for transparency.

    The Sharpe approximation uses: mean(trade_pnl%) / std(trade_pnl%).
    Real Sharpe uses annualized returns, but for comparing grid cells on the same
    data, the relative ranking is identical.

    Tests 42 combinations (7 SL x 6 TP values) which takes ~1-2 seconds.
    """
    # SL multipliers: tight (0.5x ATR) to wide (3.5x ATR)
    sl_values = [0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.5]
    # TP multipliers: tight (0.5x ATR) to wide (5.0x ATR)
    tp_values = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0]

    grid_results = []
    best_sharpe = -999.0
    best_combo = None
    best_sim = None

    print(f"\n[OPTIMIZE] Grid searching {len(sl_values)}x{len(tp_values)} = {len(sl_values)*len(tp_values)} SL/TP combinations...")
    sys.stdout.flush()

    for sl_mult in sl_values:
        for tp_mult in tp_values:
            sim = simulate_trades(
                df_test, y_pred, y_prob,
                target_horizon=target_horizon,
                confidence_threshold=confidence_threshold,
                sl_atr_mult=sl_mult,
                tp_atr_mult=tp_mult,
            )
            ts = sim.get('trade_simulation', {})

            total_trades = ts.get('total_trades', 0)
            if total_trades < 5:
                # Skip combos that produce too few trades for meaningful stats
                continue

            # Compute Sharpe approximation from sample trades' P&L percentages.
            # If sample_trades not available, fall back to expectancy / drawdown ratio.
            sample = ts.get('sample_trades', [])
            if sample and len(sample) >= 5:
                pnl_pcts = [t['pnl_pct'] for t in sample]
                mean_pnl = np.mean(pnl_pcts)
                std_pnl = np.std(pnl_pcts)
                sharpe = mean_pnl / std_pnl if std_pnl > 1e-10 else 0.0
            else:
                # Fallback: use expectancy vs drawdown as a risk-adjusted proxy
                exp_pct = ts.get('expectancy_pct', 0.0)
                dd_pct = ts.get('max_drawdown_pct', 1.0)
                sharpe = exp_pct / dd_pct if dd_pct > 0.01 else 0.0

            cell = {
                'sl_atr': sl_mult,
                'tp_atr': tp_mult,
                'total_trades': total_trades,
                'win_rate': round(ts.get('win_rate', 0.0), 4),
                'profit_factor': round(ts.get('profit_factor', 0.0), 2),
                'total_return_pct': round(ts.get('total_return_pct', 0.0), 4),
                'max_drawdown_pct': round(ts.get('max_drawdown_pct', 0.0), 4),
                'expectancy_pct': round(ts.get('expectancy_pct', 0.0), 4),
                'avg_rr': round(ts.get('avg_rr', 0.0), 2),
                'sharpe': round(sharpe, 4),
            }
            grid_results.append(cell)

            if sharpe > best_sharpe:
                best_sharpe = sharpe
                best_combo = cell
                best_sim = ts

    # Sort grid by Sharpe descending so frontend can show ranked table
    grid_results.sort(key=lambda x: x['sharpe'], reverse=True)

    if best_combo is None:
        print("[OPTIMIZE] No valid combinations found (too few trades in all combos)")
        return {}

    print(f"\n[OPTIMIZE] Best SL/TP: {best_combo['sl_atr']}x / {best_combo['tp_atr']}x ATR")
    print(f"  Sharpe:         {best_combo['sharpe']:.4f}")
    print(f"  Win Rate:       {best_combo['win_rate']:.1%}")
    print(f"  Profit Factor:  {best_combo['profit_factor']:.2f}")
    print(f"  Total Return:   {best_combo['total_return_pct']:+.4f}%")
    print(f"  Max Drawdown:   {best_combo['max_drawdown_pct']:.4f}%")
    print(f"  Trades:         {best_combo['total_trades']}")
    print(f"\n[OPTIMIZE] Top 5 combinations:")
    for i, cell in enumerate(grid_results[:5]):
        print(f"  {i+1}. SL {cell['sl_atr']}x / TP {cell['tp_atr']}x  |  Sharpe {cell['sharpe']:.3f}  WR {cell['win_rate']:.1%}  PF {cell['profit_factor']:.2f}  Ret {cell['total_return_pct']:+.2f}%")
    sys.stdout.flush()

    return {
        'sl_tp_optimization': {
            'best': best_combo,
            # Return top 20 for the frontend grid (full grid can be huge)
            'grid': grid_results[:20],
            'total_combinations_tested': len(sl_values) * len(tp_values),
            'valid_combinations': len(grid_results),
            'sl_values_tested': sl_values,
            'tp_values_tested': tp_values,
        },
        # Also return the full trade sim using the BEST parameters
        # so the card shows the optimized results, not the default 1.5x/2.0x
        'trade_simulation': best_sim,
    }


def main(params: dict) -> dict:
    """
    Main training pipeline.

    Args:
        params: Dictionary with all training parameters from the UI

    Returns:
        Dictionary with training results
    """
    print("=" * 60)
    print("XGBoost Price Direction Classifier")
    print("=" * 60)
    print(f"Started at: {datetime.now().isoformat()}")
    
    # === EXTRACT PARAMETERS ===
    dataset = params.get('dataset', 'candles_15m')
    target_horizon = int(params.get('target_horizon', 5))
    test_size = int(params.get('test_size', 20)) / 100  # Convert to decimal
    features = params.get('features', None)  # List of feature column names
    start_date = params.get('start_date', None)
    end_date = params.get('end_date', None)
    
    # XGBoost hyperparameters
    n_estimators = int(params.get('n_estimators', 100))
    max_depth = int(params.get('max_depth', 6))
    learning_rate = float(params.get('learning_rate', 0.1))
    min_child_weight = int(params.get('min_child_weight', 1))
    subsample = float(params.get('subsample', 0.8))
    colsample_bytree = float(params.get('colsample_bytree', 0.8))
    reg_alpha = float(params.get('reg_alpha', 0))
    reg_lambda = float(params.get('reg_lambda', 1))
    early_stopping_rounds = int(params.get('early_stopping_rounds', 10))
    
    print(f"\n[CONFIG] Dataset: {dataset}")
    print(f"[CONFIG] Target Horizon: {target_horizon} candles")
    print(f"[CONFIG] Test Split: {test_size:.0%}")
    if start_date or end_date:
        print(f"[CONFIG] Date range: {start_date or 'start'} -> {end_date or 'now'}")
    if features:
        print(f"[CONFIG] Selected Features: {features}")
    
    # === FETCH DATA ===
    df = fetch_dataset(dataset, features=None, start_date=start_date, end_date=end_date)

    # Ensure numeric types (API may return strings)
    for col in ["open", "high", "low", "close", "volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # === COMPUTE SELECTED INDICATORS ===
    df = compute_features(df, features)
    print(f"[INFO] After indicators: {len(df):,} rows × {len(df.columns)} columns")
    
    # === CREATE TARGET ===
    df = create_target(df, target_horizon)
    
    # === PREPARE FEATURES ===
    X, y, feature_names = prepare_features(df, features)
    
    # === TRAIN/TEST SPLIT ===
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, shuffle=False  # Time series: don't shuffle!
    )
    print(f"\n[INFO] Train size: {len(X_train)}, Test size: {len(X_test)}")
    
    # === TRAIN MODEL ===
    model, best_iter, training_history = train_xgboost(
        X_train, y_train, X_test, y_test,
        n_estimators=n_estimators,
        max_depth=max_depth,
        learning_rate=learning_rate,
        min_child_weight=min_child_weight,
        subsample=subsample,
        colsample_bytree=colsample_bytree,
        reg_alpha=reg_alpha,
        reg_lambda=reg_lambda,
        early_stopping_rounds=early_stopping_rounds
    )
    
    # === EVALUATE ===
    results = evaluate_model(model, X_test, y_test, feature_names)

    # === BASIC TRADE SIMULATION ===
    # Quick trade sim with default ATR-based SL/TP so the ML card shows
    # actionable stats (win rate, PF, return) instead of just accuracy.
    # Full SL/TP optimization with custom ranges lives in the separate
    # Optimize tab (POST /compute/optimize endpoint).
    try:
        df_test_ohlc = df.loc[X_test.index].reset_index(drop=True)
        y_pred_arr = np.array(results['predictions'])
        y_prob_arr = np.array(results['probabilities'])

        sim_results = simulate_trades(
            df_test_ohlc, y_pred_arr, y_prob_arr,
            target_horizon=target_horizon,
            confidence_threshold=0.55,
            sl_atr_mult=1.5,
            tp_atr_mult=2.0,
        )
        results.update(sim_results)
    except Exception as e:
        print(f"[WARNING] Trade simulation failed (non-fatal): {e}")
        results['trade_simulation'] = {'error': str(e)}

    # === SAVE MODEL (optional) ===
    save_model = params.get('save_model', False)
    if save_model:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        model_filename = f"xgboost_{dataset}_horizon{target_horizon}_{timestamp}.joblib"
        joblib.dump(model, model_filename)
        print(f"\n[INFO] Model saved to: {model_filename}")
        results['model_file'] = model_filename
    
    results['config'] = {
        'dataset': dataset,
        'target_horizon': target_horizon,
        'test_size': test_size,
        'features_used': feature_names,
        'n_estimators': n_estimators,
        'max_depth': max_depth,
        'learning_rate': learning_rate,
        'best_iteration': best_iter,
        'training_history': training_history
    }
    
    print(f"\n[DONE] Completed at: {datetime.now().isoformat()}")
    print("=" * 60)
    
    return results, model


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="XGBoost Price Direction Classifier")
    
    # Config file or individual params
    parser.add_argument('--config', type=str, help='Path to JSON config file')
    
    # Data params
    parser.add_argument('--dataset', type=str, default='candles_15m')
    parser.add_argument('--target_horizon', type=int, default=5)
    parser.add_argument('--test_size', type=int, default=20)
    parser.add_argument('--features', type=str, nargs='*', help='Feature columns to use')
    
    # XGBoost params
    parser.add_argument('--n_estimators', type=int, default=100)
    parser.add_argument('--max_depth', type=int, default=6)
    parser.add_argument('--learning_rate', type=float, default=0.1)
    parser.add_argument('--min_child_weight', type=int, default=1)
    parser.add_argument('--subsample', type=float, default=0.8)
    parser.add_argument('--colsample_bytree', type=float, default=0.8)
    parser.add_argument('--reg_alpha', type=float, default=0)
    parser.add_argument('--reg_lambda', type=float, default=1)
    parser.add_argument('--early_stopping_rounds', type=int, default=10)
    
    # Date/timeframe params (from UI)
    parser.add_argument('--start_date', type=str, default=None, help='Start date for data range')
    parser.add_argument('--end_date', type=str, default=None, help='End date for data range')
    parser.add_argument('--timeframe', type=str, default='15m', help='Candle timeframe')
    parser.add_argument('--prediction_horizon', type=str, default=None, help='Prediction horizon')
    parser.add_argument('--run_cv', type=str, default='true', help='Run cross-validation')
    parser.add_argument('--ensemble_ratio', type=float, default=0.8)
    parser.add_argument('--column_sample', type=float, default=0.8)
    
    # Output
    parser.add_argument('--save_model', action='store_true', help='Save trained model to file')
    parser.add_argument('--job_id', type=str, default='', help='Job ID for weight saving')
    
    args, _unknown = parser.parse_known_args()
    job_id = args.job_id
    
    # Build params dict
    if args.config:
        with open(args.config, 'r') as f:
            params = json.load(f)
    else:
        params = dict(vars(args))
        params.pop('job_id', None)
    
    # Run training
    results, trained_model = main(params)
    
    # Save model weights if job_id provided
    if args.job_id:
        weight_path = save_model_weights(results, args.job_id, metadata={
            "model_type": "XGBoost",
        }, trained_model=trained_model)
        if weight_path:
            results["weight_file"] = weight_path
    
    # Print JSON results for API consumption
    print("\n--- JSON RESULTS ---")
    print("[RESULTS_JSON]")
    print(json.dumps(results, indent=2))
    print("[/RESULTS_JSON]")
