#!/usr/bin/env python3
"""
Shared utilities for LSE Terminal ML training scripts.

Local-first port of the LSE ML Studio script utils: instead of querying a
remote database, all data arrives as files exported by the terminal's
job runner before the script starts:

  LSE_ML_DATA_FILE    OHLCV dataset (parquet or csv) with columns
                      timestamp, open, high, low, close, volume
  LSE_ML_ECON_FILE    optional economic events csv with columns
                      event_date, actual, estimate, impact
  LSE_ML_WEIGHTS_DIR  where trained model weights are written

Training runs entirely on the user's machine (their CPU/GPU); nothing is
uploaded anywhere.
"""
import os
import sys
import numpy as np
import pandas as pd


def get_device():
    """Auto-detect best available compute device."""
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            vram = getattr(props, "total_memory", getattr(props, "total_mem", 0)) // (1024**2)
            print(f"[GPU] Using CUDA: {name} ({vram}MB VRAM)")
            print(f"[GPU] PyTorch {torch.__version__}, CUDA {torch.version.cuda}")
            return torch.device("cuda")
        # Apple Silicon Macs have no CUDA; their GPU is torch's MPS backend.
        # getattr-guarded because torch builds older than 1.12 (and some
        # CPU-only builds) ship without torch.backends.mps at all. Safe for
        # every training script here: they all build float32 tensors, and
        # MPS's one hard gap is float64.
        mps = getattr(torch.backends, "mps", None)
        if mps is not None and mps.is_available():
            print(f"[GPU] Using Apple Silicon GPU (MPS), PyTorch {torch.__version__}")
            return torch.device("mps")
        else:
            print("[CPU] No CUDA or MPS device available, using CPU")
            return torch.device("cpu")
    except ImportError:
        print("[CPU] PyTorch not installed, using NumPy fallback")
        return None




# =========================================================================
# Feature Engineering: compute technical indicators on-the-fly from OHLCV
# =========================================================================

# All available computed features (keyed by their ID sent from the frontend)
AVAILABLE_FEATURES = {
    # Momentum
    "rsi_14", "rsi_7", "stoch_k", "stoch_d", "williams_r", "cci_20",
    "roc_10", "roc_5", "mfi_14", "ultimate_osc", "awesome_osc", "tsi",
    # Trend
    "ema_9", "ema_20", "ema_50", "ema_100", "ema_200",
    "sma_20", "sma_50", "sma_100", "sma_200",
    "macd", "macd_signal", "macd_histogram", "adx_14",
    "dema_20", "tema_20", "vwma_20", "hull_9",
    "psar", "plus_di", "minus_di",
    # Volatility
    "atr_14", "atr_7", "bb_upper", "bb_lower", "bb_width", "bb_pctb",
    "keltner_upper", "keltner_lower", "donchian_upper", "donchian_lower",
    "natr_14",
    # Volume
    "obv", "ad_line", "cmf_20", "volume_sma_20", "force_index_13",
    "volume_roc_14",
    # Statistical / Returns
    "log_return", "return_1", "return_5", "return_10", "return_20",
    "zscore_20", "skew_20", "kurt_20",
    # Economic Events
    "econ_surprise", "econ_surprise_sum",
    "econ_high_count", "econ_medium_count", "econ_low_count",
    "econ_hours_since", "econ_event_window",
}

# OHLCV columns that are always raw DB columns, not computed
OHLCV_COLS = {"open", "high", "low", "close", "volume", "timestamp"}

# Economic event feature IDs (need special handling: merge from separate table)
ECONOMIC_FEATURES = {
    "econ_surprise", "econ_surprise_sum",
    "econ_high_count", "econ_medium_count", "econ_low_count",
    "econ_hours_since", "econ_event_window",
}


def _ema(arr, span):
    """Exponential moving average using pandas."""
    return pd.Series(arr).ewm(span=span, adjust=False).mean().values


def _sma(arr, window):
    """Simple moving average."""
    return pd.Series(arr).rolling(window=window, min_periods=1).mean().values


def _rsi(close, period=14):
    """Relative Strength Index."""
    delta = np.diff(close, prepend=close[0])
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = pd.Series(gain).ewm(alpha=1/period, min_periods=period).mean().values
    avg_loss = pd.Series(loss).ewm(alpha=1/period, min_periods=period).mean().values
    rs = avg_gain / (avg_loss + 1e-10)
    return 100 - (100 / (1 + rs))


def _atr(high, low, close, period=14):
    """Average True Range."""
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))
    return pd.Series(tr).rolling(window=period, min_periods=1).mean().values


def _true_range(high, low, close):
    """True Range (non-smoothed)."""
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    return np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))


def _adx(high, low, close, period=14):
    """Average Directional Index. Returns (adx, +DI, -DI)."""
    n = len(close)
    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    for i in range(1, n):
        up = high[i] - high[i-1]
        down = low[i-1] - low[i]
        plus_dm[i] = up if (up > down and up > 0) else 0
        minus_dm[i] = down if (down > up and down > 0) else 0
    atr_vals = _atr(high, low, close, period)
    plus_di = 100 * pd.Series(plus_dm).rolling(window=period, min_periods=1).mean().values / (atr_vals + 1e-10)
    minus_di = 100 * pd.Series(minus_dm).rolling(window=period, min_periods=1).mean().values / (atr_vals + 1e-10)
    dx = 100 * np.abs(plus_di - minus_di) / (plus_di + minus_di + 1e-10)
    adx = pd.Series(dx).rolling(window=period, min_periods=1).mean().values
    return adx, plus_di, minus_di


def _parabolic_sar(high, low, close, af_start=0.02, af_step=0.02, af_max=0.2):
    """Parabolic SAR indicator."""
    n = len(close)
    psar = np.zeros(n)
    bull = True
    af = af_start
    ep = low[0]
    hp = high[0]
    lp = low[0]
    psar[0] = close[0]

    for i in range(1, n):
        if bull:
            psar[i] = psar[i-1] + af * (hp - psar[i-1])
            psar[i] = min(psar[i], low[i-1], low[max(0, i-2)])
            if low[i] < psar[i]:
                bull = False
                psar[i] = hp
                lp = low[i]
                af = af_start
            else:
                if high[i] > hp:
                    hp = high[i]
                    af = min(af + af_step, af_max)
        else:
            psar[i] = psar[i-1] + af * (lp - psar[i-1])
            psar[i] = max(psar[i], high[i-1], high[max(0, i-2)])
            if high[i] > psar[i]:
                bull = True
                psar[i] = lp
                hp = high[i]
                af = af_start
            else:
                if low[i] < lp:
                    lp = low[i]
                    af = min(af + af_step, af_max)
    return psar


def _fetch_economic_events(start_date=None, end_date=None):
    """
    Load economic event data from the csv exported by the job runner
    (LSE_ML_ECON_FILE). The runner only writes it when the terminal has an
    economic calendar source available; without it, econ_* features fill
    with 0 rather than failing the whole job.
    Returns DataFrame with event_date, actual, estimate, impact columns.
    """
    path = os.environ.get("LSE_ML_ECON_FILE", "")
    if path and os.path.exists(path):
        try:
            econ_df = pd.read_csv(path)
            econ_df["event_date"] = pd.to_datetime(econ_df["event_date"], utc=True)
            econ_df["actual"] = pd.to_numeric(econ_df["actual"], errors="coerce")
            econ_df["estimate"] = pd.to_numeric(econ_df["estimate"], errors="coerce")
            econ_df = econ_df.dropna(subset=["actual", "estimate"])
            if start_date:
                econ_df = econ_df[econ_df["event_date"] >= pd.to_datetime(start_date, utc=True)]
            if end_date:
                econ_df = econ_df[econ_df["event_date"] <= pd.to_datetime(end_date, utc=True)]
            # Compute surprise percentage per event
            econ_df["surprise_pct"] = (
                (econ_df["actual"] - econ_df["estimate"]) /
                (econ_df["estimate"].abs() + 1e-10)
            ) * 100
            # Beat/miss: +1 if beat, -1 if miss, 0 if in-line (<1%)
            econ_df["beat_miss"] = np.where(
                econ_df["surprise_pct"].abs() < 1, 0,
                np.where(econ_df["surprise_pct"] > 0, 1, -1)
            )
            econ_df["is_high"] = (econ_df["impact"] == "High").astype(int)
            econ_df["is_medium"] = (econ_df["impact"] == "Medium").astype(int)
            econ_df["is_low"] = (econ_df["impact"] == "Low").astype(int)
            econ_df = econ_df.sort_values("event_date").reset_index(drop=True)
            print(f"[ECON] Loaded {len(econ_df)} economic events from local export")
            sys.stdout.flush()
            return econ_df
        except Exception as e:
            print(f"[ECON] Failed to load local econ file: {str(e)[:80]}")
            sys.stdout.flush()

    print("[ECON] WARNING: No economic events available locally, filling with 0")
    sys.stdout.flush()
    return pd.DataFrame()


def _compute_economic_features(df, econ_df, requested_features):
    """
    Merge economic event features into the candle DataFrame.
    For each candle timestamp, look back to find recent events and compute features.
    """
    n = len(df)

    # If no economic data available, fill all requested with 0
    if econ_df.empty:
        for feat in requested_features:
            if feat in ECONOMIC_FEATURES:
                df[feat] = 0.0
        return df

    # Ensure candle timestamps are datetime
    ts = pd.to_datetime(df["timestamp"], utc=True)
    econ_dates = econ_df["event_date"].values  # already datetime64
    surprises = econ_df["surprise_pct"].values
    beat_miss = econ_df["beat_miss"].values
    is_high = econ_df["is_high"].values
    is_medium = econ_df["is_medium"].values
    is_low = econ_df["is_low"].values

    # Pre-allocate output arrays
    out_surprise = np.zeros(n)
    out_surprise_sum = np.zeros(n)
    out_high_count = np.zeros(n)
    out_medium_count = np.zeros(n)
    out_low_count = np.zeros(n)
    out_hours_since = np.full(n, 999.0)  # default: very long ago
    out_event_window = np.zeros(n)

    # Convert to epoch seconds for fast comparison. Never take the raw
    # int64 view and divide by 1e9: pandas 3 stores second-resolution
    # datetime64[s] (not always [ns]), and that division collapsed every
    # epoch to ~1, silently zeroing all econ features.
    # astype('datetime64[s]') is unit-aware at any input resolution.
    candle_epoch = ts.values.astype("datetime64[s]").astype(np.int64)
    econ_epoch = econ_dates.astype("datetime64[s]").astype(np.int64)

    for i in range(n):
        ct = candle_epoch[i]

        # Find events before this candle
        mask = econ_epoch <= ct
        if not mask.any():
            continue

        # Events in the past relative to this candle
        past_idx = np.where(mask)[0]

        # Last event surprise
        last_idx = past_idx[-1]
        out_surprise[i] = surprises[last_idx]

        # Hours since last event (any impact)
        last_epoch = econ_epoch[last_idx]
        out_hours_since[i] = (ct - last_epoch) / 3600.0

        # Event window: any event in last 2 hours
        out_event_window[i] = 1.0 if out_hours_since[i] <= 2.0 else 0.0

        # Last 5 events: surprise sum
        last5 = past_idx[-5:]
        out_surprise_sum[i] = surprises[last5].sum()

        # Impact counts in last 24 hours
        cutoff_24h = ct - 86400  # 24h in seconds
        recent_mask = econ_epoch[past_idx] >= cutoff_24h
        recent_idx = past_idx[recent_mask]
        out_high_count[i] = is_high[recent_idx].sum()
        out_medium_count[i] = is_medium[recent_idx].sum()
        out_low_count[i] = is_low[recent_idx].sum()

    # Assign to DataFrame
    feature_map = {
        "econ_surprise": out_surprise,
        "econ_surprise_sum": out_surprise_sum,
        "econ_high_count": out_high_count,
        "econ_medium_count": out_medium_count,
        "econ_low_count": out_low_count,
        "econ_hours_since": out_hours_since,
        "econ_event_window": out_event_window,
    }
    for feat in requested_features:
        if feat in feature_map:
            df[feat] = feature_map[feat]

    print(f"[ECON] Computed {len([f for f in requested_features if f in ECONOMIC_FEATURES])} economic features")
    sys.stdout.flush()
    return df


def compute_features(df, feature_list=None):
    """
    Compute requested technical indicators from raw OHLCV DataFrame.

    Args:
        df: DataFrame with at least 'open', 'high', 'low', 'close', 'volume' columns.
        feature_list: List of feature IDs to compute. If None or empty,
                      returns df as-is (OHLCV only). Unknown IDs are ignored.

    Returns:
        DataFrame with original OHLCV + requested computed columns, NaN rows dropped.
    """
    if not feature_list:
        return df

    # Separate economic features from technical features
    econ_requested = [f for f in feature_list if f in ECONOMIC_FEATURES]
    tech_requested = [f for f in feature_list if f not in ECONOMIC_FEATURES]

    # Handle economic features first (need separate data fetch + merge)
    if econ_requested:
        # Extract date range from the candle DataFrame
        start_dt = df["timestamp"].min() if "timestamp" in df.columns else None
        end_dt = df["timestamp"].max() if "timestamp" in df.columns else None
        start_str = str(start_dt)[:19] if start_dt is not None else None
        end_str = str(end_dt)[:19] if end_dt is not None else None
        econ_df = _fetch_economic_events(start_str, end_str)
        df = _compute_economic_features(df, econ_df, econ_requested)

    # Filter to only computed technical features (skip OHLCV, already in df)
    # We allow any feature that is matched dynamically (e.g. stoch_rsi_x, log_return_x) or explicitly in AVAILABLE_FEATURES
    requested = []
    for f in tech_requested:
        if f in AVAILABLE_FEATURES or any(f.startswith(prefix) for prefix in ["stoch_", "rsi_", "log_return_", "vwap"]):
            requested.append(f)
    if not requested and not econ_requested:
        return df

    close = df["close"].values.astype(float)
    high = df["high"].values.astype(float)
    low = df["low"].values.astype(float)
    open_ = df["open"].values.astype(float)
    volume = df["volume"].values.astype(float)

    computed = set()

    for feat in requested:
        if feat in computed:
            continue

        # =====================================================================
        # MOMENTUM & CUSTOM INDICATORS
        # =====================================================================
        if feat == "vwap":
            tp = (high + low + close) / 3.0
            cum_vol = pd.Series(volume).cumsum().values
            cum_tp_vol = pd.Series(tp * volume).cumsum().values
            df["vwap"] = np.where(cum_vol > 0, cum_tp_vol / cum_vol, close)

        elif feat.startswith("rsi_"):
            try:
                period = int(feat.split("_")[1])
                df[feat] = _rsi(close, period)
            except:
                pass

        elif feat.startswith("stoch_rsi_"):
            parts = feat.split("_")
            period = 14
            for p in parts:
                if p.isdigit(): period = int(p)
            
            rsi_arr = _rsi(close, period)
            rsi_s = pd.Series(rsi_arr)
            rsi_min = rsi_s.rolling(period, min_periods=1).min().values
            rsi_max = rsi_s.rolling(period, min_periods=1).max().values
            rng = rsi_max - rsi_min
            
            stoch_rsi_k = np.where(rng > 0, (rsi_arr - rsi_min) / rng * 100, 50.0)
            
            if "k" in feat:
                df[feat] = stoch_rsi_k
            elif "d" in feat:
                df[feat] = pd.Series(stoch_rsi_k).rolling(3, min_periods=1).mean().values

        elif feat.startswith("stoch_k"):
            parts = feat.split("_")
            period = 14
            for p in parts:
                if p.isdigit(): period = int(p)
            low14 = pd.Series(low).rolling(period, min_periods=1).min().values
            high14 = pd.Series(high).rolling(period, min_periods=1).max().values
            df[feat] = 100 * (close - low14) / (high14 - low14 + 1e-10)

        elif feat.startswith("stoch_d"):
            parts = feat.split("_")
            period = 14
            for p in parts:
                if p.isdigit(): period = int(p)
            low14 = pd.Series(low).rolling(period, min_periods=1).min().values
            high14 = pd.Series(high).rolling(period, min_periods=1).max().values
            k = 100 * (close - low14) / (high14 - low14 + 1e-10)
            df[feat] = pd.Series(k).rolling(3, min_periods=1).mean().values

        elif feat == "williams_r":
            high14 = pd.Series(high).rolling(14, min_periods=1).max().values
            low14 = pd.Series(low).rolling(14, min_periods=1).min().values
            df["williams_r"] = -100 * (high14 - close) / (high14 - low14 + 1e-10)

        elif feat == "cci_20":
            tp = (high + low + close) / 3
            sma_tp = pd.Series(tp).rolling(20, min_periods=1).mean().values
            mad = pd.Series(tp).rolling(20, min_periods=1).apply(
                lambda x: np.mean(np.abs(x - x.mean())), raw=True
            ).values
            df["cci_20"] = (tp - sma_tp) / (0.015 * mad + 1e-10)

        elif feat == "roc_10":
            shifted = np.roll(close, 10)
            shifted[:10] = close[:10]
            df["roc_10"] = 100 * (close - shifted) / (shifted + 1e-10)

        elif feat == "roc_5":
            shifted = np.roll(close, 5)
            shifted[:5] = close[:5]
            df["roc_5"] = 100 * (close - shifted) / (shifted + 1e-10)

        elif feat == "mfi_14":
            # Money Flow Index: RSI using volume-weighted typical price
            tp = (high + low + close) / 3
            raw_mf = tp * volume
            delta_tp = np.diff(tp, prepend=tp[0])
            pos_mf = np.where(delta_tp > 0, raw_mf, 0.0)
            neg_mf = np.where(delta_tp < 0, raw_mf, 0.0)
            pos_sum = pd.Series(pos_mf).rolling(14, min_periods=1).sum().values
            neg_sum = pd.Series(neg_mf).rolling(14, min_periods=1).sum().values
            mfi = 100 - (100 / (1 + pos_sum / (neg_sum + 1e-10)))
            df["mfi_14"] = mfi

        elif feat == "ultimate_osc":
            # Ultimate Oscillator: combines 3 timeframes (7, 14, 28)
            prev_close = np.roll(close, 1)
            prev_close[0] = close[0]
            bp = close - np.minimum(low, prev_close)
            tr = _true_range(high, low, close)
            avg7_bp = pd.Series(bp).rolling(7, min_periods=1).sum().values
            avg7_tr = pd.Series(tr).rolling(7, min_periods=1).sum().values
            avg14_bp = pd.Series(bp).rolling(14, min_periods=1).sum().values
            avg14_tr = pd.Series(tr).rolling(14, min_periods=1).sum().values
            avg28_bp = pd.Series(bp).rolling(28, min_periods=1).sum().values
            avg28_tr = pd.Series(tr).rolling(28, min_periods=1).sum().values
            uo = 100 * ((4 * avg7_bp / (avg7_tr + 1e-10)) +
                        (2 * avg14_bp / (avg14_tr + 1e-10)) +
                        (avg28_bp / (avg28_tr + 1e-10))) / 7
            df["ultimate_osc"] = uo

        elif feat == "awesome_osc":
            # Awesome Oscillator: difference between 5 and 34 period SMA of median price
            median_price = (high + low) / 2
            df["awesome_osc"] = _sma(median_price, 5) - _sma(median_price, 34)

        elif feat == "tsi":
            # True Strength Index: double-smoothed momentum
            delta = np.diff(close, prepend=close[0])
            smooth1 = pd.Series(delta).ewm(span=25, adjust=False).mean().values
            smooth2 = pd.Series(smooth1).ewm(span=13, adjust=False).mean().values
            abs_smooth1 = pd.Series(np.abs(delta)).ewm(span=25, adjust=False).mean().values
            abs_smooth2 = pd.Series(abs_smooth1).ewm(span=13, adjust=False).mean().values
            df["tsi"] = 100 * smooth2 / (abs_smooth2 + 1e-10)

        # =====================================================================
        # TREND
        # =====================================================================
        elif feat == "ema_9":
            df["ema_9"] = _ema(close, 9)
        elif feat == "ema_20":
            df["ema_20"] = _ema(close, 20)
        elif feat == "ema_50":
            df["ema_50"] = _ema(close, 50)
        elif feat == "ema_100":
            df["ema_100"] = _ema(close, 100)
        elif feat == "ema_200":
            df["ema_200"] = _ema(close, 200)
        elif feat == "sma_20":
            df["sma_20"] = _sma(close, 20)
        elif feat == "sma_50":
            df["sma_50"] = _sma(close, 50)
        elif feat == "sma_100":
            df["sma_100"] = _sma(close, 100)
        elif feat == "sma_200":
            df["sma_200"] = _sma(close, 200)

        elif feat in ("macd", "macd_signal", "macd_histogram"):
            if "macd" not in computed:
                ema12 = _ema(close, 12)
                ema26 = _ema(close, 26)
                macd_line = ema12 - ema26
                signal = _ema(macd_line, 9)
                df["macd"] = macd_line
                df["macd_signal"] = signal
                df["macd_histogram"] = macd_line - signal
                computed.update({"macd", "macd_signal", "macd_histogram"})

        elif feat == "adx_14":
            adx_vals, _, _ = _adx(high, low, close, 14)
            df["adx_14"] = adx_vals

        elif feat == "dema_20":
            # Double Exponential Moving Average
            ema1 = _ema(close, 20)
            ema2 = _ema(ema1, 20)
            df["dema_20"] = 2 * ema1 - ema2

        elif feat == "tema_20":
            # Triple Exponential Moving Average
            ema1 = _ema(close, 20)
            ema2 = _ema(ema1, 20)
            ema3 = _ema(ema2, 20)
            df["tema_20"] = 3 * ema1 - 3 * ema2 + ema3

        elif feat == "vwma_20":
            # Volume Weighted Moving Average
            vp = pd.Series(close * volume).rolling(20, min_periods=1).sum().values
            vs = pd.Series(volume).rolling(20, min_periods=1).sum().values
            df["vwma_20"] = vp / (vs + 1e-10)

        elif feat == "hull_9":
            # Hull Moving Average: fast MA that reduces lag
            wma_half = pd.Series(close).rolling(5, min_periods=1).mean().values
            wma_full = pd.Series(close).rolling(9, min_periods=1).mean().values
            raw = 2 * wma_half - wma_full
            df["hull_9"] = pd.Series(raw).rolling(3, min_periods=1).mean().values

        elif feat == "psar":
            df["psar"] = _parabolic_sar(high, low, close)

        elif feat == "plus_di":
            _, pdi, _ = _adx(high, low, close, 14)
            df["plus_di"] = pdi
        elif feat == "minus_di":
            _, _, mdi = _adx(high, low, close, 14)
            df["minus_di"] = mdi

        # =====================================================================
        # VOLATILITY
        # =====================================================================
        elif feat == "atr_14":
            df["atr_14"] = _atr(high, low, close, 14)

        elif feat == "atr_7":
            df["atr_7"] = _atr(high, low, close, 7)

        elif feat in ("bb_upper", "bb_lower", "bb_width", "bb_pctb"):
            if "bb_upper" not in computed:
                mid = _sma(close, 20)
                std = pd.Series(close).rolling(20, min_periods=1).std().values
                df["bb_upper"] = mid + 2 * std
                df["bb_lower"] = mid - 2 * std
                df["bb_width"] = (df["bb_upper"] - df["bb_lower"]) / (mid + 1e-10)
                df["bb_pctb"] = (close - df["bb_lower"].values) / (df["bb_upper"].values - df["bb_lower"].values + 1e-10)
                computed.update({"bb_upper", "bb_lower", "bb_width", "bb_pctb"})

        elif feat in ("keltner_upper", "keltner_lower"):
            if "keltner_upper" not in computed:
                ema20 = _ema(close, 20)
                atr10 = _atr(high, low, close, 10)
                df["keltner_upper"] = ema20 + 2 * atr10
                df["keltner_lower"] = ema20 - 2 * atr10
                computed.update({"keltner_upper", "keltner_lower"})

        elif feat in ("donchian_upper", "donchian_lower"):
            if "donchian_upper" not in computed:
                df["donchian_upper"] = pd.Series(high).rolling(20, min_periods=1).max().values
                df["donchian_lower"] = pd.Series(low).rolling(20, min_periods=1).min().values
                computed.update({"donchian_upper", "donchian_lower"})

        elif feat == "natr_14":
            # Normalised ATR (ATR as percentage of close)
            df["natr_14"] = (_atr(high, low, close, 14) / (close + 1e-10)) * 100

        # =====================================================================
        # VOLUME
        # =====================================================================
        elif feat == "obv":
            # On Balance Volume
            direction = np.sign(np.diff(close, prepend=close[0]))
            df["obv"] = np.cumsum(direction * volume)

        elif feat == "ad_line":
            # Accumulation / Distribution Line
            clv = ((close - low) - (high - close)) / (high - low + 1e-10)
            df["ad_line"] = np.cumsum(clv * volume)

        elif feat == "cmf_20":
            # Chaikin Money Flow
            clv = ((close - low) - (high - close)) / (high - low + 1e-10)
            mf_vol = clv * volume
            df["cmf_20"] = (
                pd.Series(mf_vol).rolling(20, min_periods=1).sum().values /
                (pd.Series(volume).rolling(20, min_periods=1).sum().values + 1e-10)
            )

        elif feat == "volume_sma_20":
            df["volume_sma_20"] = _sma(volume, 20)

        elif feat == "force_index_13":
            # Force Index = close delta × volume, smoothed with EMA 13
            delta = np.diff(close, prepend=close[0])
            fi = delta * volume
            df["force_index_13"] = _ema(fi, 13)

        elif feat == "volume_roc_14":
            # Volume Rate of Change. A zero base volume has no defined
            # rate-of-change: the old +1e-10 guard let one zero-volume bar
            # (thin FX weekend hours) explode the ratio to ~1e15 while
            # staying IEEE-finite, poisoning scalers downstream. NaN is the
            # honest value and warms up like every other feature.
            shifted = np.roll(volume, 14)
            shifted[:14] = volume[:14]
            base = np.where(shifted > 0, shifted, np.nan)
            df["volume_roc_14"] = 100 * (volume - shifted) / base

        # =====================================================================
        # STATISTICAL / RETURNS
        # =====================================================================
        elif feat.startswith("log_return"):
            # Handle standard "log_return" or dynamic "log_return_1", "log_return_5", etc.
            parts = feat.split("_")
            period = 1
            if len(parts) > 2 and parts[-1].isdigit():
                period = int(parts[-1])
            
            shifted = np.roll(close, period)
            shifted[:period] = close[:period]
            df[feat] = np.log(close / (shifted + 1e-10))

        elif feat == "return_1":
            prev = np.roll(close, 1)
            prev[0] = close[0]
            df["return_1"] = (close - prev) / (prev + 1e-10)

        elif feat == "return_5":
            shifted = np.roll(close, 5)
            shifted[:5] = close[:5]
            df["return_5"] = (close - shifted) / (shifted + 1e-10)

        elif feat == "return_10":
            shifted = np.roll(close, 10)
            shifted[:10] = close[:10]
            df["return_10"] = (close - shifted) / (shifted + 1e-10)

        elif feat == "return_20":
            shifted = np.roll(close, 20)
            shifted[:20] = close[:20]
            df["return_20"] = (close - shifted) / (shifted + 1e-10)

        elif feat == "zscore_20":
            # Z-Score: how many stdevs from rolling mean
            rolling_mean = pd.Series(close).rolling(20, min_periods=1).mean().values
            rolling_std = pd.Series(close).rolling(20, min_periods=1).std().values
            df["zscore_20"] = (close - rolling_mean) / (rolling_std + 1e-10)

        elif feat == "skew_20":
            df["skew_20"] = pd.Series(close).rolling(20, min_periods=1).skew().values

        elif feat == "kurt_20":
            df["kurt_20"] = pd.Series(close).rolling(20, min_periods=1).kurt().values

        computed.add(feat)

    # Drop rows with NaN from rolling windows (typically first ~50 rows)
    initial_len = len(df)
    df = df.dropna().reset_index(drop=True)
    dropped = initial_len - len(df)
    if dropped > 0:
        print(f"[FEATURES] Dropped {dropped} warm-up rows, {len(df)} remaining")
    sys.stdout.flush()

    return df


def _load_local_frame():
    """
    Load the OHLCV dataset the job runner exported for this run.
    The runner always sets LSE_ML_DATA_FILE before spawning the script, so a
    missing/empty file means the run is misconfigured; fail loudly rather than
    training on nothing (earlier versions fell back to synthetic data,
    which silently produced fake results, so that fallback is gone on purpose).
    """
    path = os.environ.get("LSE_ML_DATA_FILE", "")
    if not path:
        raise RuntimeError(
            "LSE_ML_DATA_FILE is not set. Training scripts must be launched by "
            "the LSE Terminal job runner (or set the env var to a csv/parquet "
            "file with timestamp,open,high,low,close,volume columns)."
        )
    if not os.path.exists(path):
        raise RuntimeError(f"Dataset file not found: {path}")

    if path.endswith(".parquet"):
        df = pd.read_parquet(path)
    else:
        df = pd.read_csv(path)

    # Normalise column names; the terminal exports canonical lowercase already,
    # but a user-supplied file may vary.
    df.columns = [str(c).strip().lower() for c in df.columns]
    if "ts" in df.columns and "timestamp" not in df.columns:
        df = df.rename(columns={"ts": "timestamp"})

    required = {"timestamp", "open", "high", "low", "close"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"Dataset file {path} is missing columns: {sorted(missing)}")
    if "volume" not in df.columns:
        df["volume"] = 0.0

    # Timestamps may arrive as epoch seconds (terminal export) or ISO strings.
    if pd.api.types.is_numeric_dtype(df["timestamp"]):
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    else:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    df = df.sort_values("timestamp").reset_index(drop=True)
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)

    if df.empty:
        raise RuntimeError(f"Dataset file {path} contains no usable rows")
    return df


def fetch_dataset(
    dataset_name: str,
    features: list = None,
    start_date: str = None,
    end_date: str = None,
    max_rows: int = 100000,
    symbol: str = None,
    timeframe: str = "15m"
) -> pd.DataFrame:
    """
    Local-first replacement for the original fetch_dataset: the dataset always
    comes from the file the job runner exported (LSE_ML_DATA_FILE). The
    dataset_name/symbol/timeframe arguments are kept for script compatibility
    and logging only; the runner already resolved them when exporting.
    """
    df = _load_local_frame()
    print(f"[DATA] Local dataset: {dataset_name or 'exported file'} "
          f"({len(df):,} rows x {len(df.columns)} columns)")
    sys.stdout.flush()

    if start_date:
        df = df[df["timestamp"] >= pd.to_datetime(start_date, utc=True)]
    if end_date:
        df = df[df["timestamp"] <= pd.to_datetime(end_date, utc=True)]
    if start_date or end_date:
        df = df.reset_index(drop=True)
        print(f"[DATA] After date filter ({start_date or 'start'} to {end_date or 'now'}): {len(df):,} rows")
        sys.stdout.flush()

    if len(df) > max_rows:
        # Keep the most recent rows, matching the behaviour of LIMIT on
        # a timestamp-ordered query.
        df = df.iloc[-max_rows:].reset_index(drop=True)
        print(f"[DATA] Truncated to most recent {max_rows:,} rows")
        sys.stdout.flush()

    if features:
        requested = [f for f in features if f not in df.columns and f not in OHLCV_COLS]
        if requested:
            df = compute_features(df, requested)
        selected = ["timestamp", "open", "high", "low", "close", "volume"] + \
                   [f for f in features if f in df.columns]
        selected = list(dict.fromkeys(selected))
        df = df[selected]
        df = df.dropna().reset_index(drop=True)

    if df.empty:
        raise RuntimeError("Dataset is empty after filtering; widen the date range or bar count")

    print(f"[DATA_SOURCE:local_file]")
    print(f"[DATA] Ready: {len(df):,} rows x {len(df.columns)} columns")
    sys.stdout.flush()
    return df


def fetch_ohlcv(dataset: str, timeframe: str = "15m", start_date: str = None,
                end_date: str = None, limit: int = 500000,
                symbol: str = None) -> dict:
    """
    Fetch OHLCV data as numpy arrays from the local dataset file.
    """
    df = fetch_dataset(
        dataset_name=dataset,
        features=["timestamp", "open", "high", "low", "close", "volume"],
        start_date=start_date,
        end_date=end_date,
        max_rows=limit,
        symbol=symbol,
        timeframe=timeframe,
    )

    return {
        # datetime64 values, because compute_features' econ join expects a
        # datetime-like df["timestamp"]; scripts that build their frame from
        # this dict must carry it or econ_* features crash on the join
        # (every script already excludes "timestamp" from feature_names).
        "timestamp": pd.to_datetime(df["timestamp"], utc=True).values,
        "open": np.array([float(x) for x in df["open"]]),
        "high": np.array([float(x) for x in df["high"]]),
        "low": np.array([float(x) for x in df["low"]]),
        "close": np.array([float(x) for x in df["close"]]),
        "volume": np.array([float(x) for x in df["volume"]]),
    }


def save_model_weights(model, job_id: str, metadata: dict = None, trained_model=None) -> str:
    """
    Save trained model weights to disk for later download.

    Args:
        model: The trained model object (sklearn, xgboost, etc.)
        job_id: Unique job identifier (used as filename)
        metadata: Optional dict of extra info to save alongside the model

    Returns:
        Path to saved weight file, or empty string on failure
    """
    import pickle
    from pathlib import Path

    # The terminal's job runner always sets LSE_ML_WEIGHTS_DIR; the home
    # fallback only matters when a script is run by hand outside the app.
    weights_dir = Path(os.environ.get("LSE_ML_WEIGHTS_DIR",
                                      str(Path.home() / ".lse-terminal" / "ml-weights")))
    weights_dir.mkdir(parents=True, exist_ok=True)

    weight_path = weights_dir / f"{job_id}.pkl"
    try:
        payload = {"model": model}
        if metadata:
            payload["metadata"] = metadata
        if trained_model is not None:
            payload["trained_model"] = trained_model
        with open(weight_path, "wb") as f:
            pickle.dump(payload, f)
        size_mb = weight_path.stat().st_size / (1024 * 1024)
        print(f"[WEIGHTS] Saved model weights: {weight_path} ({size_mb:.1f} MB)")
        if trained_model is not None:
            print(f"[WEIGHTS] Included raw trained model: {type(trained_model).__name__}")
        sys.stdout.flush()
        return str(weight_path)
    except Exception as e:
        print(f"[WEIGHTS] Failed to save weights: {e}")
        sys.stdout.flush()
        return ""
