#!/usr/bin/env python3
"""
Validate My Stock OS Theme System v1.0 config.

Usage:
    python scripts/validate_theme_config.py

Uses only the Python standard library.
"""

from __future__ import annotations

import csv
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config"

THEMES_FILE = CONFIG / "themes.csv"
ENTITIES_FILE = CONFIG / "entities.csv"
MEMBERSHIPS_FILE = CONFIG / "memberships.csv"

REQUIRED_THEME_COLUMNS = {
    "theme_id",
    "name",
    "family",
    "theme_class",
    "score_mode",
    "primary_benchmark",
    "secondary_benchmark",
    "status",
    "definition_version",
    "effective_from",
}

REQUIRED_ENTITY_COLUMNS = {
    "entity_id",
    "name",
    "ticker",
    "exchange",
    "asset_type",
    "status",
    "data_status",
    "ipo_date",
    "notes",
}

REQUIRED_MEMBERSHIP_COLUMNS = {
    "theme_id",
    "entity_id",
    "ticker",
    "role",
    "purity",
    "effective_from",
    "effective_to",
    "change_reason",
    "notes",
}

ALLOWED_THEME_CLASSES = {"structural", "tactical", "watch"}
ALLOWED_SCORE_MODES = {"ranked", "thin", "heat_only", "none"}
ALLOWED_ROLES = {"core", "related", "watch", "exclude"}
ALLOWED_PURITY = {"high", "medium", "low"}

ALLOWED_MODE_BY_CLASS = {
    "structural": {"ranked", "thin"},
    "tactical": {"heat_only"},
    "watch": {"none"},
}

MIN_CORE_BY_SCORE_MODE = {
    "ranked": 4,
    "thin": 2,
    "heat_only": 2,
    "none": 0,
}


def read_csv(path: Path):
    if not path.exists():
        fail(f"Missing file: {path.relative_to(ROOT)}")
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            fail(f"No header row: {path.relative_to(ROOT)}")
        return reader.fieldnames, list(reader)


def parse_date(value: str, label: str, errors: list[str], allow_blank: bool = False):
    value = (value or "").strip()
    if not value:
        if allow_blank:
            return None
        errors.append(f"{label}: date is blank")
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        errors.append(f"{label}: invalid ISO date '{value}'")
        return None


def intervals_overlap(a_start, a_end, b_start, b_end):
    a_end = a_end or date.max
    b_end = b_end or date.max
    return max(a_start, b_start) <= min(a_end, b_end)


def fail(message: str):
    print(f"CONFIG VALIDATION FAILED\n- {message}", file=sys.stderr)
    sys.exit(1)


def main():
    errors: list[str] = []
    warnings: list[str] = []

    theme_fields, themes = read_csv(THEMES_FILE)
    entity_fields, entities = read_csv(ENTITIES_FILE)
    membership_fields, memberships = read_csv(MEMBERSHIPS_FILE)

    for filename, fields, required in [
        ("themes.csv", set(theme_fields), REQUIRED_THEME_COLUMNS),
        ("entities.csv", set(entity_fields), REQUIRED_ENTITY_COLUMNS),
        ("memberships.csv", set(membership_fields), REQUIRED_MEMBERSHIP_COLUMNS),
    ]:
        missing = required - fields
        if missing:
            errors.append(f"{filename}: missing columns {sorted(missing)}")

    theme_ids = [r["theme_id"].strip() for r in themes]
    entity_ids = [r["entity_id"].strip() for r in entities]

    for label, values in [("theme_id", theme_ids), ("entity_id", entity_ids)]:
        dup = sorted(k for k, c in Counter(values).items() if k and c > 1)
        if dup:
            errors.append(f"Duplicate {label}: {dup}")
        if any(not x for x in values):
            errors.append(f"Blank {label} found")

    theme_by_id = {r["theme_id"].strip(): r for r in themes}
    entity_by_id = {r["entity_id"].strip(): r for r in entities}

    # Nonblank tickers should identify one entity only.
    ticker_to_entities = defaultdict(list)
    for e in entities:
        ticker = e["ticker"].strip().upper()
        if ticker:
            ticker_to_entities[ticker].append(e["entity_id"].strip())

        status = e["status"].strip()
        data_status = e["data_status"].strip()
        if status == "public" and data_status in {"active", "data_review"} and not ticker:
            errors.append(
                f"entities.csv: public entity {e['entity_id']} has no ticker"
            )

    duplicate_tickers = {
        t: ids for t, ids in ticker_to_entities.items() if len(ids) > 1
    }
    if duplicate_tickers:
        errors.append(f"Ticker assigned to multiple entities: {duplicate_tickers}")

    # Validate themes.
    for t in themes:
        tid = t["theme_id"].strip()
        cls = t["theme_class"].strip()
        mode = t["score_mode"].strip()

        if cls not in ALLOWED_THEME_CLASSES:
            errors.append(f"{tid}: invalid theme_class '{cls}'")
        if mode not in ALLOWED_SCORE_MODES:
            errors.append(f"{tid}: invalid score_mode '{mode}'")

        if cls in ALLOWED_MODE_BY_CLASS and mode not in ALLOWED_MODE_BY_CLASS[cls]:
            errors.append(
                f"{tid}: theme_class={cls} cannot use score_mode={mode}"
            )

        parse_date(
            t["effective_from"],
            f"themes.csv {tid}.effective_from",
            errors,
        )

        if mode != "none" and not t["primary_benchmark"].strip():
            errors.append(f"{tid}: scored theme requires primary_benchmark")

    # Validate memberships and build counts.
    role_counts = defaultdict(Counter)
    core_intervals = defaultdict(list)

    seen_exact_rows = Counter()

    for i, m in enumerate(memberships, start=2):
        tid = m["theme_id"].strip()
        eid = m["entity_id"].strip()
        ticker = m["ticker"].strip().upper()
        role = m["role"].strip()
        purity = m["purity"].strip()

        if tid not in theme_by_id:
            errors.append(f"memberships.csv line {i}: unknown theme_id '{tid}'")
        if eid not in entity_by_id:
            errors.append(f"memberships.csv line {i}: unknown entity_id '{eid}'")

        if role not in ALLOWED_ROLES:
            errors.append(f"memberships.csv line {i}: invalid role '{role}'")
        if purity not in ALLOWED_PURITY:
            errors.append(f"memberships.csv line {i}: invalid purity '{purity}'")

        start = parse_date(
            m["effective_from"],
            f"memberships.csv line {i}.effective_from",
            errors,
        )
        end = parse_date(
            m["effective_to"],
            f"memberships.csv line {i}.effective_to",
            errors,
            allow_blank=True,
        )

        if start and end and end < start:
            errors.append(
                f"memberships.csv line {i}: effective_to is before effective_from"
            )

        if eid in entity_by_id:
            entity_ticker = entity_by_id[eid]["ticker"].strip().upper()
            if ticker and entity_ticker and ticker != entity_ticker:
                errors.append(
                    f"memberships.csv line {i}: ticker {ticker} does not match "
                    f"entities.csv ticker {entity_ticker} for {eid}"
                )

        if tid in theme_by_id:
            role_counts[tid][role] += 1

            theme = theme_by_id[tid]
            if theme["score_mode"].strip() == "none" and role == "core":
                errors.append(
                    f"{tid}: score_mode=none cannot have role=core membership"
                )

        if role == "core" and start:
            core_intervals[eid].append((start, end, tid, i))

        exact_key = (
            tid,
            eid,
            role,
            m["effective_from"].strip(),
            m["effective_to"].strip(),
        )
        seen_exact_rows[exact_key] += 1

    dup_memberships = [k for k, c in seen_exact_rows.items() if c > 1]
    if dup_memberships:
        errors.append(
            f"Duplicate membership rows found: {dup_memberships[:10]}"
        )

    # Single source of truth rule:
    # one entity may never have overlapping active Core memberships.
    for eid, rows in core_intervals.items():
        rows = sorted(rows, key=lambda x: x[0])
        for idx, a in enumerate(rows):
            for b in rows[idx + 1 :]:
                if intervals_overlap(a[0], a[1], b[0], b[1]):
                    errors.append(
                        f"{eid}: overlapping Home Core memberships: "
                        f"{a[2]} (line {a[3]}) and {b[2]} (line {b[3]})"
                    )

    # Minimum basket rules for current definition.
    for tid, t in theme_by_id.items():
        mode = t["score_mode"].strip()
        core_n = role_counts[tid]["core"]
        minimum = MIN_CORE_BY_SCORE_MODE.get(mode, 0)

        if core_n < minimum:
            errors.append(
                f"{tid}: score_mode={mode} requires at least {minimum} Core "
                f"members, found {core_n}"
            )

        if mode == "none" and core_n != 0:
            errors.append(f"{tid}: Watch/none theme must have zero Core members")

        if mode == "ranked" and core_n < 4:
            errors.append(
                f"{tid}: Ranked theme has only {core_n} Core members"
            )

    # Frozen Space rule.
    space = "space_satellite"
    if space in theme_by_id:
        space_core = {
            m["ticker"].strip().upper()
            for m in memberships
            if m["theme_id"].strip() == space and m["role"].strip() == "core"
        }
        if space_core != {"RKLB", "ASTS"}:
            errors.append(
                "Frozen Space rule violated: official Space Core must be "
                "exactly RKLB and ASTS"
            )
        for m in memberships:
            if (
                m["theme_id"].strip() == space
                and m["ticker"].strip().upper() == "SPCX"
                and m["role"].strip() == "core"
            ):
                errors.append(
                    "Frozen Space rule violated: SPCX cannot be in official Space Core"
                )

    # Helpful warnings only.
    for tid, t in theme_by_id.items():
        if t["score_mode"].strip() == "thin":
            core_n = role_counts[tid]["core"]
            warnings.append(f"{tid}: Thin Monitor ({core_n} Core members)")

    if errors:
        print("CONFIG VALIDATION FAILED")
        for err in errors:
            print(f"- {err}")
        if warnings:
            print("\nWarnings:")
            for warning in warnings:
                print(f"- {warning}")
        sys.exit(1)

    print("CONFIG VALIDATION PASSED")
    print(f"Themes:      {len(themes)}")
    print(f"Entities:    {len(entities)}")
    print(f"Memberships: {len(memberships)}")
    print("Home Core overlap errors: 0")
    print("Frozen Space rule: OK")
    print("\nTheme counts:")
    mode_counts = Counter(t["score_mode"].strip() for t in themes)
    for mode in ("ranked", "thin", "heat_only", "none"):
        print(f"  {mode}: {mode_counts[mode]}")
    print("\nThin monitors:")
    for warning in warnings:
        print(f"  - {warning}")


if __name__ == "__main__":
    main()
