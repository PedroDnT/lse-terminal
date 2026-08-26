#!/usr/bin/env python3
"""
Sentiment Analyzer (Lightweight)
==================================
Rule-based + statistical sentiment analysis on news data.
Uses keyword scoring and statistical correlation with price.
No heavy transformer model required.

Output format matches the LSE Terminal API contract.
"""

import argparse
import json
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from utils import compute_features, fetch_dataset, save_model_weights
import os
import warnings
from datetime import datetime
from collections import Counter

import pandas as pd
import numpy as np

warnings.filterwarnings("ignore")


# Financial sentiment lexicon
POSITIVE_WORDS = {
    "bullish", "rally", "surge", "soar", "gain", "up", "rise", "rising", "higher",
    "growth", "profit", "record", "strong", "beat", "outperform", "upgrade",
    "recovery", "momentum", "breakout", "optimistic", "positive", "buy",
    "accumulate", "support", "boom", "expansion", "rebound", "uptick",
    "confidence", "upside", "opportunities", "innovation", "breakthrough",
}
NEGATIVE_WORDS = {
    "bearish", "crash", "plunge", "drop", "fall", "decline", "lower", "loss",
    "weak", "miss", "underperform", "downgrade", "recession", "fear",
    "sell", "selloff", "risk", "crisis", "collapse", "slump", "downturn",
    "volatility", "concern", "warning", "threat", "correction", "pullback",
    "panic", "uncertainty", "downside", "inflation", "deficit", "bubble",
}


def fetch_news():
    """Return (news_df, news_source) where news_source is 'live' or 'synthetic'."""
    # A news feed is optional for end users. LSE_ML_NEWS_URL may point at any
    # endpoint returning a JSON array of {title, description, published_at}
    # objects. When it is unset we never touch the network: the script scores
    # the built-in demo headlines instead, and the results carry an explicit
    # synthetic marker so nobody mistakes them for real market sentiment.
    url = os.environ.get("LSE_ML_NEWS_URL", "").strip()
    if url:
        import requests
        print(f"[INFO] Fetching news from: {url}")
        headers = {}
        api_key = os.environ.get("LSE_API_KEY", "")
        if api_key:
            headers["x-api-key"] = api_key
        try:
            response = requests.get(url, headers=headers, timeout=15)
            if response.status_code == 200:
                df = pd.DataFrame(response.json())
                if len(df) > 0:
                    print(f"[INFO] Fetched {len(df):,} articles")
                    return df, "live"
            print(f"[WARN] News URL returned status {response.status_code}, falling back to synthetic headlines")
        except Exception as e:
            print(f"[WARN] News URL unavailable ({e}), falling back to synthetic headlines")
    else:
        print("[INFO] LSE_ML_NEWS_URL not set, skipping network fetch")

    # Documented fallback: fixed demo headlines let the pipeline run without
    # any news source at all. Output is labelled synthetic (see results.config).
    print("[WARN] SYNTHETIC MODE: scoring built-in demo headlines, not real news")
    headlines = [
        {"title": "Bitcoin rally continues as bulls push higher", "description": "Strong momentum drives prices up", "published_at": datetime.now().isoformat()},
        {"title": "Market uncertainty amid rising volatility concerns", "description": "Traders face increased risk", "published_at": datetime.now().isoformat()},
        {"title": "Analysts predict growth opportunities in crypto", "description": "Positive outlook for digital assets", "published_at": datetime.now().isoformat()},
        {"title": "Selloff pressure mounts as fear grips markets", "description": "Bearish sentiment dominates trading", "published_at": datetime.now().isoformat()},
        {"title": "Record breaking surge in trading volume", "description": "Expansion in market activity signals confidence", "published_at": datetime.now().isoformat()},
        {"title": "Recession fears lead to market decline", "description": "Economic downturn threatens recovery", "published_at": datetime.now().isoformat()},
        {"title": "Innovation breakthrough drives crypto adoption", "description": "New technology supports bullish case", "published_at": datetime.now().isoformat()},
        {"title": "Correction expected after strong rally", "description": "Pullback could test support levels", "published_at": datetime.now().isoformat()},
        {"title": "Market rebound after panic selloff stabilizes", "description": "Recovery momentum builds", "published_at": datetime.now().isoformat()},
        {"title": "Inflation data raises downside risk warning", "description": "Economic uncertainty weighs on sentiment", "published_at": datetime.now().isoformat()},
    ]
    df = pd.DataFrame(headlines)
    print(f"[INFO] Generated {len(df)} synthetic headlines for analysis")
    return df, "synthetic"


def fetch_prices(dataset_name: str) -> pd.DataFrame:
    """Latest close prices, newest first, from the local dataset file."""
    # Price correlation is a nice-to-have in this script: sentiment scoring is
    # the core output, so a missing dataset file degrades to "no correlation"
    # instead of failing the whole job (unlike the OHLCV training scripts,
    # where a missing file must raise).
    try:
        df = fetch_dataset(dataset_name, features=["timestamp", "close"])
    except Exception as e:
        print(f"[WARN] Could not load prices ({e}), continuing without price correlation")
        return pd.DataFrame(columns=["timestamp", "close"])

    # Call sites expect newest-first rows (iloc[0] = latest close), the shape
    # the hosted endpoint used to return, so reverse the ascending frame.
    df = df[["timestamp", "close"]].tail(1000).iloc[::-1].reset_index(drop=True)
    print(f"[INFO] Loaded {len(df):,} price rows from local dataset")
    return df


def score_text(text: str) -> dict:
    """Score a text using financial sentiment lexicon."""
    if not text:
        return {"score": 0, "positive": 0, "negative": 0, "confidence": 0}

    words = set(text.lower().split())
    pos_count = len(words & POSITIVE_WORDS)
    neg_count = len(words & NEGATIVE_WORDS)
    total = pos_count + neg_count

    if total == 0:
        return {"score": 0, "positive": 0, "negative": 0, "confidence": 0}

    score = (pos_count - neg_count) / total  # -1 to 1
    confidence = min(total / 5, 1.0)  # More keywords = higher confidence

    return {
        "score": round(score, 4),
        "positive": pos_count,
        "negative": neg_count,
        "confidence": round(confidence, 4),
    }


def main(params: dict) -> dict:
    print("=" * 60)
    print("Financial Sentiment Analyzer")
    print("=" * 60)
    print(f"Started at: {datetime.now().isoformat()}")

    dataset = params.get('dataset', 'candles_15m')
    lookback_period = int(params.get("lookback_period", 24))
    min_confidence = float(params.get("min_confidence", 50)) / 100
    aggregation = params.get("aggregation", "mean")
    output_type = params.get("output_type", "composite")
    include_volume = params.get("include_volume", "true") == "true"

    print(f"\n[CONFIG] Dataset: {dataset}")
    print(f"[CONFIG] Lookback: {lookback_period}h")
    print(f"[CONFIG] Min Confidence: {min_confidence:.0%}")
    print(f"[CONFIG] Aggregation: {aggregation}")
    print(f"[CONFIG] Model: Keyword-based Financial Lexicon")

    # Fetch data
    news_df, news_source = fetch_news()
    prices_df = fetch_prices(dataset)

    if len(news_df) == 0:
        raise Exception("No news articles found")

    # Score articles
    print(f"\n[TRAINING] Scoring {len(news_df)} articles...")
    sys.stdout.flush()

    scored_articles = []
    for i, row in news_df.iterrows():
        title = str(row.get("title", ""))
        description = str(row.get("description", "") or "")
        text = f"{title} {description}"

        scores = score_text(text)
        scores["title"] = title[:80]
        scores["published_at"] = row.get("published_at", "")
        scored_articles.append(scores)

        if (i + 1) % 100 == 0:
            print(f"  [Scoring] {i+1}/{len(news_df)} articles processed")
            sys.stdout.flush()

    scored_df = pd.DataFrame(scored_articles)

    # Filter by confidence
    high_conf = scored_df[scored_df["confidence"] >= min_confidence]
    print(f"[INFO] {len(high_conf)} articles above {min_confidence:.0%} confidence threshold")

    if len(high_conf) == 0:
        high_conf = scored_df  # Fall back to all articles there

    # Aggregate sentiment
    if aggregation == "median":
        overall_score = float(high_conf["score"].median())
    elif aggregation == "volume_weighted":
        weights = high_conf["confidence"]
        overall_score = float(np.average(high_conf["score"], weights=weights))
    else:
        overall_score = float(high_conf["score"].mean())

    # Classify
    if overall_score > 0.1:
        sentiment_label = "BULLISH"
    elif overall_score < -0.1:
        sentiment_label = "BEARISH"
    else:
        sentiment_label = "NEUTRAL"

    # Distribution
    bullish_count = int((high_conf["score"] > 0.1).sum())
    bearish_count = int((high_conf["score"] < -0.1).sum())
    neutral_count = int(len(high_conf) - bullish_count - bearish_count)

    # Top articles
    most_bullish = scored_df.nlargest(3, "score")[["title", "score", "confidence"]].to_dict("records")
    most_bearish = scored_df.nsmallest(3, "score")[["title", "score", "confidence"]].to_dict("records")

    # Keyword frequency
    all_text = " ".join(news_df["title"].dropna().str.lower())
    all_words = all_text.split()
    pos_freq = {w: all_words.count(w) for w in POSITIVE_WORDS if all_words.count(w) > 0}
    neg_freq = {w: all_words.count(w) for w in NEGATIVE_WORDS if all_words.count(w) > 0}

    # Price correlation (if prices available)
    price_correlation = None
    if len(prices_df) > 10:
        recent_return = float((prices_df["close"].iloc[0] - prices_df["close"].iloc[-1]) / prices_df["close"].iloc[-1]) * 100
        price_correlation = {
            "recent_return_pct": round(recent_return, 2),
            "sentiment_aligned": (recent_return > 0 and overall_score > 0) or (recent_return < 0 and overall_score < 0),
        }

    print(f"\n[RESULTS] Sentiment Analysis:")
    print(f"  - Overall Sentiment: {sentiment_label}")
    print(f"  - Composite Score:   {overall_score:.4f} (-1 to +1)")
    print(f"  - Bullish Articles:  {bullish_count}/{len(high_conf)} ({bullish_count/len(high_conf)*100:.0f}%)")
    print(f"  - Bearish Articles:  {bearish_count}/{len(high_conf)} ({bearish_count/len(high_conf)*100:.0f}%)")
    print(f"  - Neutral Articles:  {neutral_count}/{len(high_conf)} ({neutral_count/len(high_conf)*100:.0f}%)")
    if price_correlation:
        print(f"\n[RESULTS] Price Correlation:")
        print(f"  - Recent Price Change: {price_correlation['recent_return_pct']:+.2f}%")
        print(f"  - Sentiment Aligned:   {'Yes' if price_correlation['sentiment_aligned'] else 'No'}")
    print(f"\n[RESULTS] Top Positive Keywords:")
    for word, count in sorted(pos_freq.items(), key=lambda x: x[1], reverse=True)[:5]:
        print(f"  - '{word}': {count} mentions")
    print(f"\n[RESULTS] Top Negative Keywords:")
    for word, count in sorted(neg_freq.items(), key=lambda x: x[1], reverse=True)[:5]:
        print(f"  - '{word}': {count} mentions")

    results = {
        "metrics": {
            "overall_score": round(overall_score, 4),
            "sentiment_label": sentiment_label,
            "bullish_pct": round(bullish_count / len(high_conf) * 100, 1),
            "bearish_pct": round(bearish_count / len(high_conf) * 100, 1),
            "neutral_pct": round(neutral_count / len(high_conf) * 100, 1),
            "articles_analyzed": len(high_conf),
            "avg_confidence": round(float(high_conf["confidence"].mean()), 4),
            # Surfaced in metrics (not just config) so a synthetic run is
            # impossible to miss when reading headline numbers.
            "synthetic_news": news_source == "synthetic",
        },
        "distribution": {
            "bullish": bullish_count,
            "bearish": bearish_count,
            "neutral": neutral_count,
        },
        "top_articles": {
            "most_bullish": most_bullish,
            "most_bearish": most_bearish,
        },
        "keywords": {
            "positive": dict(sorted(pos_freq.items(), key=lambda x: x[1], reverse=True)[:10]),
            "negative": dict(sorted(neg_freq.items(), key=lambda x: x[1], reverse=True)[:10]),
        },
        "price_correlation": price_correlation,
        "config": {
            "dataset": dataset,
            "lookback_period": lookback_period,
            "min_confidence": min_confidence,
            "aggregation": aggregation,
            "model": "keyword_lexicon",
            "news_source": news_source,
        },
    }

    if news_source == "synthetic":
        print(f"\n[WARN] These results were computed on SYNTHETIC demo headlines (no LSE_ML_NEWS_URL set)")
    print(f"\n[DONE] Completed at: {datetime.now().isoformat()}")
    print("=" * 60)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sentiment Analyzer")
    parser.add_argument("--dataset", type=str, default='candles_15m')
    parser.add_argument("--lookback_period", type=int, default=24)
    parser.add_argument("--model", type=str, default="keyword")
    parser.add_argument("--source", type=str, default="news")
    parser.add_argument("--preprocessing", type=str, default="standard")
    parser.add_argument("--min_confidence", type=float, default=50)
    parser.add_argument("--aggregation", type=str, default="mean")
    parser.add_argument("--output_type", type=str, default="composite")
    parser.add_argument("--include_volume", type=str, default="true")
    parser.add_argument("--lag_features", type=int, default=3)
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
        weight_path = save_model_weights(results, args.job_id, metadata={
            "model_type": "Sentiment",
        })
        if weight_path:
            results["weight_file"] = weight_path
    print("[RESULTS_JSON]")
    print(json.dumps(results, indent=2))
    print("[/RESULTS_JSON]")
