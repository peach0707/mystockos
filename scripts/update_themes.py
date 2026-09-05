#!/usr/bin/env python3
"""
My Stock OS - Theme Engine v1.0

Reads:
  config/themes.csv
  config/entities.csv
  config/memberships.csv
  config/scoring_profiles.json

Writes:
  data/themes.json
  data/theme_history.jsonl

Design rules implemented:
- One active Home Core per entity (validated separately before this script runs).
- Structural ranked and thin are separate.
- Thin themes are never cross-ranked here; score_mode is preserved in output.
- Strength, Velocity and Heat are separate signals.
- Related/Watch memberships do not enter official theme scores.
- Space official basket is ex-SPCX. SPCX is output only as a non-score overlay.
- Turning Watch is rule-based; no prediction probability or combined "next-theme score".
- Configuration changes are effective-dated and never applied retroactively.
"""

from __future__ import annotations

import csv
import json
import math
import os
import statistics
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config"
DATA = ROOT / "data"

THEMES_CSV = CONFIG / "themes.csv"
ENTITIES_CSV = CONFIG / "entities.csv"
MEMBERSHIPS_CSV = CONFIG / "memberships.csv"
SCORING_JSON = CONFIG / "scoring_profiles.json"

OUT_JSON = DATA / "themes.json"
HISTORY_JSONL = DATA / "theme_history.jsonl"
REGIME_JSON = DATA / "regime.json"

TWELVE_DATA_URL = "https://api.twelvedata.com/time_series"


def read_csv(path: Path) -> List[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def clean(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return str(value).strip()


def parse_iso_date(value: str) -> Optional[date]:
    value = clean(value)
    if not value:
        return None
    return date.fromisoformat(value)


def is_effective(row: dict, as_of: date) -> bool:
    start = parse_iso_date(row.get("effective_from"))
    end = parse_iso_date(row.get("effective_to"))
    if start and as_of < start:
        return False
    if end and as_of > end:
        return False
    return True


def piecewise_score(value: float, anchors: List[List[float]]) -> Optional[float]:
    if value is None or not np.isfinite(value):
        return None
    pts = sorted((float(x), float(y)) for x, y in anchors)
    if value <= pts[0][0]:
        return pts[0][1]
    if value >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= value <= x1:
            if x1 == x0:
                return y1
            w = (value - x0) / (x1 - x0)
            return y0 + w * (y1 - y0)
    return None


def strength_label(score: Optional[float], labels: List[List]) -> Optional[str]:
    if score is None:
        return None
    for threshold, label in sorted(labels, key=lambda x: float(x[0]), reverse=True):
        if score >= float(threshold):
            return str(label)
    return str(labels[-1][1])


def risk_adjusted_excess(theme_returns: pd.Series, bench_returns: pd.Series) -> Optional[float]:
    aligned = pd.concat(
        [theme_returns.rename("theme"), bench_returns.rename("bench")], axis=1
    ).dropna()
    if len(aligned) < 2:
        return None
    excess = aligned["theme"] - aligned["bench"]
    vol = float(excess.std(ddof=1))
    if not np.isfinite(vol) or vol <= 1e-12:
        total = float(excess.sum())
        if abs(total) <= 1e-12:
            return 0.0
        return 3.0 if total > 0 else -3.0
    return float(excess.sum() / (vol * math.sqrt(len(excess))))


def cumulative_return(returns: pd.Series) -> Optional[float]:
    s = returns.dropna()
    if s.empty:
        return None
    return float((1.0 + s).prod() - 1.0)


def rolling_cumulative_return(returns: pd.Series, window: int) -> pd.Series:
    log_r = np.log1p(returns.clip(lower=-0.999999))
    return np.expm1(log_r.rolling(window).sum())


def robust_z(current_value: float, history: Iterable[float]) -> Optional[float]:
    vals = np.asarray([x for x in history if np.isfinite(x)], dtype=float)
    if len(vals) < 20 or not np.isfinite(current_value):
        return None
    med = float(np.median(vals))
    mad = float(np.median(np.abs(vals - med)))
    scale = 1.4826 * mad
    if scale <= 1e-12:
        return 0.0
    return float((current_value - med) / scale)


class TwelveDataClient:
    def __init__(self, api_key: str, profile: dict):
        self.api_key = api_key
        self.spacing = float(profile["data"]["request_spacing_seconds"])
        self.max_retries = int(profile["data"]["max_retries"])
        self.retry_wait = float(profile["data"]["retry_wait_seconds"])
        self.outputsize = int(profile["data"]["twelve_data_outputsize"])
        self.session = requests.Session()
        self.last_request_at = 0.0

    def _pace(self):
        elapsed = time.time() - self.last_request_at
        if elapsed < self.spacing:
            time.sleep(self.spacing - elapsed)

    def fetch(self, symbol: str) -> Optional[pd.DataFrame]:
        params = {
            "symbol": symbol,
            "interval": "1day",
            "outputsize": self.outputsize,
            "adjustment": "all",
            "apikey": self.api_key,
            "format": "JSON",
        }

        for attempt in range(1, self.max_retries + 1):
            self._pace()
            try:
                response = self.session.get(TWELVE_DATA_URL, params=params, timeout=30)
                self.last_request_at = time.time()
            except requests.RequestException as exc:
                print(f"[WARN] {symbol}: network error ({attempt}/{self.max_retries}): {exc}")
                if attempt < self.max_retries:
                    time.sleep(self.retry_wait)
                    continue
                return None

            if response.status_code == 429:
                print(f"[WARN] {symbol}: rate limited ({attempt}/{self.max_retries})")
                if attempt < self.max_retries:
                    time.sleep(max(self.retry_wait, 60))
                    continue
                return None

            if response.status_code != 200:
                print(f"[WARN] {symbol}: HTTP {response.status_code}")
                if attempt < self.max_retries and response.status_code >= 500:
                    time.sleep(self.retry_wait)
                    continue
                return None

            try:
                payload = response.json()
            except ValueError:
                print(f"[WARN] {symbol}: invalid JSON")
                return None

            if payload.get("status") == "error" or "values" not in payload:
                msg = payload.get("message") or payload.get("code") or "no values"
                print(f"[WARN] {symbol}: provider error: {msg}")
                return None

            rows = payload["values"]
            if not rows:
                return None

            df = pd.DataFrame(rows)
            if "datetime" not in df.columns or "close" not in df.columns:
                print(f"[WARN] {symbol}: missing required fields")
                return None

            df["date"] = pd.to_datetime(df["datetime"]).dt.date
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            if "volume" in df.columns:
                df["volume"] = pd.to_numeric(df["volume"], errors="coerce")
            else:
                df["volume"] = np.nan

            df = (
                df[["date", "close", "volume"]]
                .dropna(subset=["date", "close"])
                .sort_values("date")
                .drop_duplicates("date", keep="last")
                .set_index("date")
            )
            return df

        return None


def aligned_return_frame(
    price_data: Dict[str, pd.DataFrame],
    member_tickers: List[str],
    bench_ticker: str,
    min_returns: int,
) -> Tuple[Optional[pd.DataFrame], List[str]]:
    if bench_ticker not in price_data or price_data[bench_ticker] is None:
        return None, []

    bench_ret = price_data[bench_ticker]["close"].pct_change().rename("BENCH")
    eligible = []
    series = [bench_ret]

    for ticker in member_tickers:
        df = price_data.get(ticker)
        if df is None:
            continue
        ret = df["close"].pct_change().rename(ticker)
        aligned = pd.concat([ret, bench_ret], axis=1).dropna()
        if len(aligned) >= min_returns:
            eligible.append(ticker)
            series.append(ret)

    if not eligible:
        return None, []

    frame = pd.concat(series, axis=1).dropna()
    if len(frame) < min_returns:
        return None, eligible

    return frame, eligible


def basket_returns(frame: pd.DataFrame, eligible: List[str]) -> pd.Series:
    return frame[eligible].mean(axis=1)


def breadth_metrics(
    price_data: Dict[str, pd.DataFrame],
    tickers: List[str],
    as_of: date,
    ma_days: int,
    change_days: int,
) -> dict:
    now_flags = []
    past_flags = []
    eligible = []

    for ticker in tickers:
        df = price_data.get(ticker)
        if df is None or len(df) < ma_days + change_days + 2:
            continue
        d = df.loc[df.index <= as_of].copy()
        if len(d) < ma_days + change_days:
            continue
        ma = d["close"].rolling(ma_days).mean()
        now_idx = len(d) - 1
        past_idx = len(d) - 1 - change_days
        if past_idx < ma_days - 1:
            continue
        now_ok = bool(d["close"].iloc[now_idx] > ma.iloc[now_idx])
        past_ok = bool(d["close"].iloc[past_idx] > ma.iloc[past_idx])
        now_flags.append(now_ok)
        past_flags.append(past_ok)
        eligible.append(ticker)

    if not eligible:
        return {
            "eligible_n": 0,
            "now_above": 0,
            "past_above": 0,
            "now_fraction": None,
            "past_fraction": None,
            "change": None,
            "eligible": [],
        }

    now_n = sum(now_flags)
    past_n = sum(past_flags)
    n = len(eligible)
    return {
        "eligible_n": n,
        "now_above": now_n,
        "past_above": past_n,
        "now_fraction": now_n / n,
        "past_fraction": past_n / n,
        "change": (now_n - past_n) / n,
        "eligible": eligible,
    }


def activity_metrics(
    price_data: Dict[str, pd.DataFrame],
    tickers: List[str],
    as_of: date,
    history_days: int,
    signal_days: int,
) -> dict:
    stock_z = {}
    latest_dv = {}

    for ticker in tickers:
        df = price_data.get(ticker)
        if df is None:
            continue
        d = df.loc[df.index <= as_of].copy()
        d = d.dropna(subset=["close", "volume"])
        if len(d) < history_days + signal_days + 5:
            continue

        dollar_volume = (d["close"] * d["volume"]).replace([np.inf, -np.inf], np.nan).dropna()
        dollar_volume = dollar_volume[dollar_volume > 0]
        if len(dollar_volume) < history_days + signal_days:
            continue

        log_dv = np.log(dollar_volume)
        current = float(np.median(log_dv.iloc[-signal_days:]))
        hist = log_dv.iloc[-(history_days + signal_days):-signal_days]
        z = robust_z(current, hist.values)
        if z is None:
            continue

        stock_z[ticker] = z
        latest_dv[ticker] = float(np.median(dollar_volume.iloc[-5:]))

    if not stock_z:
        return {
            "eligible_n": 0,
            "theme_median_z": None,
            "positive_z_n": 0,
            "stock_z": {},
            "max_dollar_volume_share": None,
        }

    total_dv = sum(v for v in latest_dv.values() if np.isfinite(v) and v > 0)
    max_share = None
    if total_dv > 0:
        max_share = max(latest_dv.values()) / total_dv

    return {
        "eligible_n": len(stock_z),
        "theme_median_z": float(np.median(list(stock_z.values()))),
        "positive_z_n": sum(1 for z in stock_z.values() if z > 0),
        "stock_z": {k: round(float(v), 4) for k, v in stock_z.items()},
        "max_dollar_volume_share": None if max_share is None else float(max_share),
    }


def individual_10d_returns(
    price_data: Dict[str, pd.DataFrame],
    tickers: List[str],
    as_of: date,
    days: int,
) -> dict:
    result = {}
    for ticker in tickers:
        df = price_data.get(ticker)
        if df is None:
            continue
        d = df.loc[df.index <= as_of]["close"].dropna()
        if len(d) < days + 1:
            continue
        result[ticker] = float(d.iloc[-1] / d.iloc[-1 - days] - 1.0)
    return result


def compute_heat(
    price_data: Dict[str, pd.DataFrame],
    core_tickers: List[str],
    bench_ticker: str,
    as_of: date,
    profile: dict,
    subset: Optional[List[str]] = None,
    compute_loo: bool = True,
) -> dict:
    hp = profile["heat"]
    tickers = subset if subset is not None else core_tickers
    min_members = int(hp["min_eligible_members"])
    return_days = int(hp["return_days"])

    frame, ret_eligible = aligned_return_frame(
        price_data, tickers, bench_ticker, return_days
    )

    ra_raw = None
    return_score = None
    if frame is not None and len(ret_eligible) >= min_members:
        f = frame.tail(return_days)
        bret = basket_returns(f, ret_eligible)
        ra_raw = risk_adjusted_excess(bret, f["BENCH"])
        if ra_raw is not None:
            return_score = piecewise_score(
                ra_raw, hp["risk_adjusted_excess_return_anchors"]
            )

    breadth = breadth_metrics(
        price_data,
        tickers,
        as_of,
        int(hp["breadth_ma_days"]),
        int(hp["breadth_change_days"]),
    )
    breadth_score = None
    if breadth["change"] is not None:
        breadth_score = piecewise_score(
            breadth["change"], hp["breadth_change_anchors"]
        )

    activity = activity_metrics(
        price_data,
        tickers,
        as_of,
        int(hp["dollar_volume_history_days"]),
        int(hp["dollar_volume_signal_days"]),
    )
    activity_score = None
    if activity["theme_median_z"] is not None:
        activity_score = piecewise_score(
            activity["theme_median_z"], hp["dollar_volume_robust_z_anchors"]
        )

    factors = {
        "risk_adjusted_excess_return": return_score,
        "breadth_change": breadth_score,
        "dollar_volume_robust_z": activity_score,
    }

    if any(v is None for v in factors.values()):
        heat_score = None
    else:
        weights = hp["weights"]
        heat_score = sum(float(factors[k]) * float(weights[k]) for k in factors)

    stock_10d = individual_10d_returns(price_data, tickers, as_of, return_days)
    positive_n = sum(1 for v in stock_10d.values() if v > 0)
    positive_majority = len(stock_10d) >= min_members and positive_n > len(stock_10d) / 2

    loo_score = None
    top_contributor = None
    if compute_loo and heat_score is not None and len(stock_10d) >= 2:
        top_contributor = max(stock_10d, key=stock_10d.get)
        remaining = [t for t in tickers if t != top_contributor]
        if remaining:
            loo = compute_heat(
                price_data,
                core_tickers,
                bench_ticker,
                as_of,
                profile,
                subset=remaining,
                compute_loo=False,
            )
            loo_score = loo["score"]

    concentration_ok = (
        activity["max_dollar_volume_share"] is not None
        and activity["max_dollar_volume_share"]
        <= float(hp["max_single_stock_dollar_volume_share"])
    )
    loo_ok = (
        loo_score is not None
        and loo_score >= float(hp["leave_one_out_min_score"])
    )

    eligible_intersection = sorted(
        set(ret_eligible)
        & set(breadth["eligible"])
        & set(activity["stock_z"].keys())
    )

    # Official Hot requires at least three fully eligible Core members.
    # Two-member Thin/Tactical themes still receive an indicative Heat score,
    # but are never promoted to an official Hot state.
    hot_eligible = len(eligible_intersection) >= 3

    hot = bool(
        hot_eligible
        and heat_score is not None
        and heat_score >= float(hp["hot_score_threshold"])
        and positive_majority
        and loo_ok
        and concentration_ok
    )

    single_stock_driven = bool(
        hot_eligible
        and heat_score is not None
        and heat_score >= float(hp["hot_score_threshold"])
        and (not loo_ok or not concentration_ok)
    )

    return {
        "score": None if heat_score is None else round(float(heat_score), 2),
        "hot": hot,
        "hot_eligible": hot_eligible,
        "single_stock_driven": single_stock_driven,
        "eligible_n": len(eligible_intersection),
        "eligible_members": eligible_intersection,
        "raw": {
            "risk_adjusted_excess_return": None if ra_raw is None else round(float(ra_raw), 4),
            "breadth_change": None if breadth["change"] is None else round(float(breadth["change"]), 4),
            "dollar_volume_robust_z": None if activity["theme_median_z"] is None else round(float(activity["theme_median_z"]), 4),
        },
        "factor_scores": {
            k: None if v is None else round(float(v), 2) for k, v in factors.items()
        },
        "breadth": {
            "now_above": breadth["now_above"],
            "past_above": breadth["past_above"],
            "eligible_n": breadth["eligible_n"],
        },
        "activity": {
            "positive_z_n": activity["positive_z_n"],
            "eligible_n": activity["eligible_n"],
            "max_dollar_volume_share": None if activity["max_dollar_volume_share"] is None else round(float(activity["max_dollar_volume_share"]), 4),
            "stock_z": activity["stock_z"],
        },
        "positive_10d_n": positive_n,
        "positive_10d_eligible_n": len(stock_10d),
        "leave_one_out": {
            "removed": top_contributor,
            "score": None if loo_score is None else round(float(loo_score), 2),
        },
    }


def compute_strength(
    price_data: Dict[str, pd.DataFrame],
    core_tickers: List[str],
    bench_ticker: str,
    score_mode: str,
    profile: dict,
) -> dict:
    sp = profile["strength"]
    window = int(sp["window_days"])
    min_members = (
        int(sp["min_eligible_members_ranked"])
        if score_mode == "ranked"
        else int(sp["min_eligible_members_thin"])
    )

    frame, eligible = aligned_return_frame(
        price_data, core_tickers, bench_ticker, window
    )

    if frame is None or len(eligible) < min_members:
        return {
            "score": None,
            "label": None,
            "eligible_n": len(eligible),
            "eligible_members": eligible,
            "raw": {},
            "factor_scores": {},
        }

    f = frame.tail(window)
    bret = basket_returns(f, eligible)
    ra_raw = risk_adjusted_excess(bret, f["BENCH"])
    consistency = float((bret > f["BENCH"]).mean())

    ra_score = piecewise_score(
        ra_raw, sp["risk_adjusted_relative_strength_anchors"]
    )
    consistency_score = piecewise_score(
        consistency, sp["relative_trend_consistency_anchors"]
    )

    if ra_score is None or consistency_score is None:
        score = None
    else:
        score = (
            float(sp["weights"]["risk_adjusted_relative_strength"]) * ra_score
            + float(sp["weights"]["relative_trend_consistency"]) * consistency_score
        )

    return {
        "score": None if score is None else round(float(score), 2),
        "label": strength_label(score, sp["labels"]),
        "eligible_n": len(eligible),
        "eligible_members": eligible,
        "raw": {
            "risk_adjusted_relative_strength": None if ra_raw is None else round(float(ra_raw), 4),
            "relative_trend_consistency": round(consistency, 4),
        },
        "factor_scores": {
            "risk_adjusted_relative_strength": None if ra_score is None else round(float(ra_score), 2),
            "relative_trend_consistency": None if consistency_score is None else round(float(consistency_score), 2),
        },
    }


def compute_velocity_raw(
    price_data: Dict[str, pd.DataFrame],
    core_tickers: List[str],
    bench_ticker: str,
    profile: dict,
) -> dict:
    vp = profile["velocity"]
    level_ma = int(vp["relative_level_ma_days"])
    momentum_days = int(vp["relative_momentum_days"])
    min_members = int(vp["min_eligible_members"])
    min_returns = level_ma + momentum_days + 5

    frame, eligible = aligned_return_frame(
        price_data, core_tickers, bench_ticker, min_returns
    )
    if frame is None or len(eligible) < min_members:
        return {
            "raw_state": None,
            "rs_level": None,
            "rs_momentum": None,
            "eligible_n": len(eligible),
            "eligible_members": eligible,
            "relative_series": None,
        }

    bret = basket_returns(frame, eligible)
    bench = frame["BENCH"]
    rel = ((1.0 + bret) / (1.0 + bench)).cumprod()

    ma = rel.rolling(level_ma).mean()
    if len(rel) < momentum_days + 1 or not np.isfinite(ma.iloc[-1]):
        return {
            "raw_state": None,
            "rs_level": None,
            "rs_momentum": None,
            "eligible_n": len(eligible),
            "eligible_members": eligible,
            "relative_series": rel,
        }

    rs_level = float(rel.iloc[-1] / ma.iloc[-1] - 1.0)
    rs_momentum = float(rel.iloc[-1] / rel.iloc[-1 - momentum_days] - 1.0)

    if rs_level >= 0 and rs_momentum >= 0:
        state = "Leading"
    elif rs_level >= 0 and rs_momentum < 0:
        state = "Weakening"
    elif rs_level < 0 and rs_momentum < 0:
        state = "Lagging"
    else:
        state = "Improving"

    return {
        "raw_state": state,
        "rs_level": round(rs_level, 6),
        "rs_momentum": round(rs_momentum, 6),
        "eligible_n": len(eligible),
        "eligible_members": eligible,
        "relative_series": rel,
    }


def apply_velocity_confirmation(
    raw: dict,
    prior_theme: Optional[dict],
    prior_as_of: Optional[date],
    current_as_of: date,
    profile: dict,
) -> dict:
    raw_state = raw["raw_state"]
    if raw_state is None:
        return {
            "state": None,
            "raw_state": None,
            "candidate": None,
            "candidate_days": 0,
            "confirmed": False,
            "rs_level": raw["rs_level"],
            "rs_momentum": raw["rs_momentum"],
            "eligible_n": raw["eligible_n"],
            "eligible_members": raw["eligible_members"],
        }

    confirm_days = int(profile["velocity"]["confirmation_days"])
    prev_v = (prior_theme or {}).get("velocity") or {}

    if not prev_v.get("state"):
        return {
            "state": raw_state,
            "raw_state": raw_state,
            "candidate": raw_state,
            "candidate_days": 1,
            "confirmed": False,
            "rs_level": raw["rs_level"],
            "rs_momentum": raw["rs_momentum"],
            "eligible_n": raw["eligible_n"],
            "eligible_members": raw["eligible_members"],
        }

    prev_state = prev_v.get("state")
    same_market_day = prior_as_of == current_as_of

    if raw_state == prev_state:
        candidate = raw_state
        candidate_days = 0
        state = prev_state
        confirmed = True
    else:
        prev_candidate = prev_v.get("candidate")
        prev_days = int(prev_v.get("candidate_days") or 0)
        if same_market_day:
            candidate_days = prev_days
        elif prev_candidate == raw_state:
            candidate_days = prev_days + 1
        else:
            candidate_days = 1

        candidate = raw_state
        if candidate_days >= confirm_days:
            state = raw_state
            confirmed = True
            candidate_days = 0
        else:
            state = prev_state
            confirmed = False

    return {
        "state": state,
        "raw_state": raw_state,
        "candidate": candidate,
        "candidate_days": candidate_days,
        "confirmed": confirmed,
        "rs_level": raw["rs_level"],
        "rs_momentum": raw["rs_momentum"],
        "eligible_n": raw["eligible_n"],
        "eligible_members": raw["eligible_members"],
    }


def compute_turning(
    price_data: Dict[str, pd.DataFrame],
    core_tickers: List[str],
    bench_ticker: str,
    as_of: date,
    velocity: dict,
    prior_theme: Optional[dict],
    heat: dict,
    profile: dict,
    stress_active: bool,
) -> dict:
    tp = profile["turning"]
    hist_days = int(tp["history_days"])
    rs_window = int(tp["relative_strength_window_days"])
    min_returns = hist_days + rs_window

    frame, eligible = aligned_return_frame(
        price_data, core_tickers, bench_ticker, min_returns
    )

    empty = {
        "active": False,
        "eligible": False,
        "reasons": [],
        "rs_percentile": None,
        "drawdown_252d": None,
        "no_new_relative_low": None,
        "stress_caution": bool(stress_active),
    }

    if frame is None or len(eligible) < 2 or len(frame) < min_returns:
        return empty

    bret = basket_returns(frame, eligible)
    bench = frame["BENCH"]

    theme63 = rolling_cumulative_return(bret, rs_window)
    bench63 = rolling_cumulative_return(bench, rs_window)
    excess63 = (theme63 - bench63).dropna()

    if len(excess63) < hist_days:
        return empty

    trailing = excess63.iloc[-hist_days:]
    current_excess = float(trailing.iloc[-1])
    percentile = float((trailing <= current_excess).mean())

    wealth = (1.0 + bret).cumprod()
    trailing_wealth = wealth.iloc[-hist_days:]
    drawdown = float(trailing_wealth.iloc[-1] / trailing_wealth.max() - 1.0)

    oversold = (
        percentile <= float(tp["oversold_percentile_threshold"])
        or drawdown <= float(tp["drawdown_threshold"])
    )

    rel = ((1.0 + bret) / (1.0 + bench)).cumprod()
    recent_rel = rel.iloc[-rs_window:]
    min_pos = int(np.argmin(recent_rel.values))
    days_since_rel_low = len(recent_rel) - 1 - min_pos
    no_new_low = days_since_rel_low >= int(tp["no_new_relative_low_days"])

    prev_velocity = ((prior_theme or {}).get("velocity") or {}).get("state")
    raw_velocity = velocity.get("raw_state")
    improving_transition = raw_velocity == "Improving"
    if bool(tp.get("requires_prior_lagging", True)):
        improving_transition = improving_transition and prev_velocity == "Lagging"

    breadth_change = ((heat or {}).get("raw") or {}).get("breadth_change")
    breadth_recovering = (
        breadth_change is not None
        and breadth_change > float(tp["breadth_recovery_min_change"])
    )

    single_stock_ok = not bool((heat or {}).get("single_stock_driven"))

    reasons = []
    if percentile <= float(tp["oversold_percentile_threshold"]):
        reasons.append("RS oversold")
    if drawdown <= float(tp["drawdown_threshold"]):
        reasons.append("deep drawdown")
    if improving_transition:
        reasons.append("Lagging→Improving")
    if breadth_recovering:
        reasons.append("breadth recovering")
    if no_new_low:
        reasons.append("no new relative low")

    active = bool(
        oversold
        and improving_transition
        and breadth_recovering
        and no_new_low
        and single_stock_ok
    )

    return {
        "active": active,
        "eligible": True,
        "reasons": reasons,
        "rs_percentile": round(percentile, 4),
        "drawdown_252d": round(drawdown, 4),
        "no_new_relative_low": no_new_low,
        "stress_caution": bool(stress_active),
    }


def compute_theme_selection(
    theme_results: List[dict],
    price_data: Dict[str, pd.DataFrame],
    as_of: date,
    profile: dict,
) -> dict:
    sp = profile["selection"]
    ranked = [
        t for t in theme_results
        if t["score_mode"] == "ranked"
        and t.get("_selection_returns") is not None
    ]
    if len(ranked) < 3:
        return {
            "label": "UNAVAILABLE",
            "dispersion": None,
            "median_correlation": None,
            "outperforming_spy_fraction": None,
            "eligible_themes": len(ranked),
        }

    win = int(sp["return_window_days"])
    corr_win = int(sp["correlation_window_days"])

    returns_21 = {}
    daily = {}
    outperform = []

    spy = price_data.get("SPY")
    if spy is None:
        return {
            "label": "UNAVAILABLE",
            "dispersion": None,
            "median_correlation": None,
            "outperforming_spy_fraction": None,
            "eligible_themes": 0,
        }

    spy_ret = spy["close"].pct_change()

    for t in ranked:
        s = t["_selection_returns"].dropna()
        aligned = pd.concat([s.rename("theme"), spy_ret.rename("spy")], axis=1).dropna()
        if len(aligned) < max(win, corr_win):
            continue
        tr = cumulative_return(aligned["theme"].tail(win))
        sr = cumulative_return(aligned["spy"].tail(win))
        if tr is None or sr is None:
            continue
        returns_21[t["theme_id"]] = tr
        outperform.append(tr > sr)
        daily[t["theme_id"]] = aligned["theme"].tail(corr_win)

    if len(returns_21) < 3:
        return {
            "label": "UNAVAILABLE",
            "dispersion": None,
            "median_correlation": None,
            "outperforming_spy_fraction": None,
            "eligible_themes": len(returns_21),
        }

    dispersion = float(np.std(list(returns_21.values()), ddof=0))
    daily_df = pd.concat(daily, axis=1).dropna()

    median_corr = None
    if daily_df.shape[1] >= 3 and len(daily_df) >= corr_win:
        corr = daily_df.corr().values
        upper = corr[np.triu_indices_from(corr, k=1)]
        upper = upper[np.isfinite(upper)]
        if len(upper):
            median_corr = float(np.median(upper))

    outperform_frac = float(sum(outperform) / len(outperform)) if outperform else None

    if (
        median_corr is not None
        and dispersion >= float(sp["high_dispersion_threshold"])
        and median_corr <= float(sp["high_max_median_correlation"])
    ):
        label = "HIGH"
    elif (
        median_corr is not None
        and (
            dispersion <= float(sp["low_dispersion_threshold"])
            or median_corr >= float(sp["low_min_median_correlation"])
        )
    ):
        label = "LOW"
    else:
        label = "NORMAL"

    return {
        "label": label,
        "dispersion": round(dispersion, 4),
        "median_correlation": None if median_corr is None else round(median_corr, 4),
        "outperforming_spy_fraction": None if outperform_frac is None else round(outperform_frac, 4),
        "eligible_themes": len(returns_21),
    }


def load_prior() -> Tuple[Optional[dict], Optional[date]]:
    if not OUT_JSON.exists():
        return None, None
    try:
        payload = json.loads(OUT_JSON.read_text(encoding="utf-8"))
        as_of = parse_iso_date(payload.get("as_of"))
        return payload, as_of
    except Exception as exc:
        print(f"[WARN] Could not read prior themes.json: {exc}")
        return None, None


def regime_stress_active() -> bool:
    if not REGIME_JSON.exists():
        return False
    try:
        p = json.loads(REGIME_JSON.read_text(encoding="utf-8"))
        stress = p.get("stress") or {}
        return bool(stress.get("active"))
    except Exception:
        return False


def append_history(payload: dict, prior_as_of: Optional[date]):
    as_of = parse_iso_date(payload["as_of"])
    if prior_as_of == as_of:
        return
    HISTORY_JSONL.parent.mkdir(parents=True, exist_ok=True)
    history_record = {
        "as_of": payload["as_of"],
        "calculated_at": payload["calculated_at"],
        "profile_version": payload["profile_version"],
        "theme_selection": payload["theme_selection"],
        "themes": payload["themes"],
    }
    with HISTORY_JSONL.open("a", encoding="utf-8") as f:
        f.write(json.dumps(history_record, ensure_ascii=False, separators=(",", ":")) + "\n")


def main():
    api_key = os.environ.get("TWELVE_DATA_API_KEY", "").strip()
    if not api_key:
        print("TWELVE_DATA_API_KEY is not set", file=sys.stderr)
        sys.exit(2)

    themes = read_csv(THEMES_CSV)
    entities = read_csv(ENTITIES_CSV)
    memberships = read_csv(MEMBERSHIPS_CSV)
    profile = json.loads(SCORING_JSON.read_text(encoding="utf-8"))

    entity_by_id = {clean(e["entity_id"]): e for e in entities}

    client = TwelveDataClient(api_key, profile)

    print("[INFO] Fetching SPY first to establish official market as_of...")
    spy = client.fetch("SPY")
    if spy is None or spy.empty:
        print("Could not fetch SPY; refusing to calculate themes.", file=sys.stderr)
        sys.exit(3)

    as_of = max(spy.index)
    print(f"[INFO] Official theme as_of = {as_of.isoformat()}")

    active_themes = [
        t for t in themes
        if clean(t.get("status")) in {"active", "watch"}
        and is_effective(t, as_of)
    ]

    if not active_themes:
        future_dates = [
            parse_iso_date(t.get("effective_from"))
            for t in themes
            if parse_iso_date(t.get("effective_from")) is not None
        ]
        next_date = min((d for d in future_dates if d > as_of), default=None)
        print(
            "[INFO] Theme System v1.0 is not effective for this market date."
            + (f" Next effective date: {next_date.isoformat()}." if next_date else "")
        )
        return

    theme_ids = {clean(t["theme_id"]) for t in active_themes}
    active_memberships = [
        m for m in memberships
        if clean(m["theme_id"]) in theme_ids and is_effective(m, as_of)
    ]

    core_tickers = sorted({
        clean(m["ticker"]).upper()
        for m in active_memberships
        if clean(m["role"]) == "core" and clean(m["ticker"])
    })

    overlay_tickers = sorted({
        clean(m["ticker"]).upper()
        for m in active_memberships
        if clean(m["role"]) == "watch"
        and "overlay" in clean(m.get("notes")).lower()
        and clean(m["ticker"])
    })

    benchmarks = {"SPY"}
    for t in active_themes:
        if clean(t.get("score_mode")) != "none":
            b = clean(t.get("primary_benchmark")).upper()
            if b:
                benchmarks.add(b)

    # BTC is secondary display-only in v1. It is not needed for official score calculations.
    fetch_symbols = sorted((set(core_tickers) | set(overlay_tickers) | benchmarks) - {"SPY"})

    price_data: Dict[str, pd.DataFrame] = {"SPY": spy}

    print(f"[INFO] Fetching {len(fetch_symbols)} additional symbols...")
    for idx, symbol in enumerate(fetch_symbols, start=1):
        print(f"[INFO] {idx}/{len(fetch_symbols)} {symbol}")
        price_data[symbol] = client.fetch(symbol)

    prior, prior_as_of = load_prior()
    prior_by_theme = {
        t["theme_id"]: t for t in (prior or {}).get("themes", [])
    }

    stress_active = regime_stress_active()

    by_theme_members = defaultdict(list)
    for m in active_memberships:
        by_theme_members[clean(m["theme_id"])].append(m)

    theme_results = []

    for t in active_themes:
        tid = clean(t["theme_id"])
        score_mode = clean(t["score_mode"])
        theme_class = clean(t["theme_class"])
        bench = clean(t.get("primary_benchmark")).upper()

        members = by_theme_members.get(tid, [])
        core = [
            clean(m["ticker"]).upper()
            for m in members
            if clean(m["role"]) == "core" and clean(m["ticker"])
        ]
        related = [
            clean(m["ticker"]).upper()
            for m in members
            if clean(m["role"]) == "related" and clean(m["ticker"])
        ]
        watch = [
            clean(m["ticker"]).upper()
            for m in members
            if clean(m["role"]) == "watch" and clean(m["ticker"])
        ]

        result = {
            "theme_id": tid,
            "name": clean(t["name"]),
            "family": clean(t["family"]),
            "theme_class": theme_class,
            "score_mode": score_mode,
            "benchmark": bench or None,
            "secondary_benchmark": clean(t.get("secondary_benchmark")) or None,
            "definition_version": clean(t.get("definition_version")),
            "core_members": core,
            "related_members": related,
            "watch_members": watch,
            "strength": None,
            "velocity": None,
            "heat": None,
            "turning_watch": None,
            "data_quality": {},
        }

        if score_mode == "none":
            result["data_quality"] = {
                "status": "watch_only",
                "core_total": len(core),
                "missing_core_data": [],
            }
            theme_results.append(result)
            continue

        missing_core = [ticker for ticker in core if price_data.get(ticker) is None]
        prior_theme = prior_by_theme.get(tid)

        if score_mode in {"ranked", "thin"}:
            strength = compute_strength(price_data, core, bench, score_mode, profile)
            result["strength"] = strength

        # Velocity is useful for Structural and Tactical themes, and Turning Watch
        # depends on it. It is calculated independently from Strength.
        velocity_raw = compute_velocity_raw(price_data, core, bench, profile)
        velocity = apply_velocity_confirmation(
            velocity_raw,
            prior_theme,
            prior_as_of,
            as_of,
            profile,
        )
        result["velocity"] = velocity

        # Used only in Theme Selection for ranked themes; removed before JSON write.
        if score_mode == "ranked":
            frame, eligible = aligned_return_frame(price_data, core, "SPY", 80)
            if frame is not None and len(eligible) >= 4:
                result["_selection_returns"] = basket_returns(frame, eligible)
            else:
                result["_selection_returns"] = None

        heat = compute_heat(price_data, core, bench, as_of, profile)
        result["heat"] = heat

        if theme_class in {"structural", "tactical"}:
            result["turning_watch"] = compute_turning(
                price_data,
                core,
                bench,
                as_of,
                result.get("velocity") or {},
                prior_theme,
                heat,
                profile,
                stress_active,
            )

        strength_eligible = (
            ((result.get("strength") or {}).get("eligible_n"))
            if result.get("strength") is not None else 0
        )
        heat_eligible = ((heat or {}).get("eligible_n") or 0)

        if score_mode == "ranked":
            required = int(profile["strength"]["min_eligible_members_ranked"])
            qstatus = "ok" if strength_eligible >= required else "insufficient"
        elif score_mode == "thin":
            required = int(profile["strength"]["min_eligible_members_thin"])
            qstatus = "thin" if strength_eligible >= required else "insufficient"
        else:
            required = int(profile["heat"]["min_eligible_members"])
            qstatus = "ok" if heat_eligible >= required else "insufficient"

        result["data_quality"] = {
            "status": qstatus,
            "core_total": len(core),
            "strength_eligible_n": strength_eligible,
            "heat_eligible_n": heat_eligible,
            "missing_core_data": missing_core,
        }

        # Official Space basket stays ex-SPCX; SPCX is a display-only overlay.
        if tid == "space_satellite" and "SPCX" in watch and price_data.get("SPCX") is not None:
            d = price_data["SPCX"].loc[price_data["SPCX"].index <= as_of]["close"].dropna()
            overlay = {"ticker": "SPCX", "official_score_member": False}
            for days in (1, 10, 21):
                if len(d) > days:
                    overlay[f"return_{days}d"] = round(float(d.iloc[-1] / d.iloc[-1-days] - 1), 4)
                else:
                    overlay[f"return_{days}d"] = None
            result["overlay"] = overlay

        theme_results.append(result)

    selection = compute_theme_selection(theme_results, price_data, as_of, profile)

    # Strip private pandas objects used for selection.
    for t in theme_results:
        t.pop("_selection_returns", None)

    payload = {
        "schema_version": "1.0",
        "profile_version": clean(profile.get("profile_version")),
        "as_of": as_of.isoformat(),
        "calculated_at": datetime.now(timezone.utc).isoformat(),
        "theme_selection": selection,
        "stress_context": {"active": stress_active},
        "themes": theme_results,
        "data_source": "Twelve Data",
    }

    DATA.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    append_history(payload, prior_as_of)

    print("[INFO] Theme Engine completed.")
    print(f"[INFO] themes.json: {OUT_JSON}")
    print(f"[INFO] history: {HISTORY_JSONL}")
    print(f"[INFO] Theme Selection: {selection['label']}")


if __name__ == "__main__":
    main()
