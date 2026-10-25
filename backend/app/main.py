import os
import math
import time as time_module
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import PyMongoError

# ------------------------------ Configuration ------------------------------

MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DATABASE_NAME", "windlens")
BASE_URL = os.getenv(
    "ELEXON_BASE_URL", "https://data.elexon.co.uk/bmrs/api/v1"
).rstrip("/")

UK = ZoneInfo("Europe/London")
UTC = timezone.utc
JAN_START = datetime(2026, 1, 1, tzinfo=UTC)
FEB_START = datetime(2026, 2, 1, tzinfo=UTC)
FORECAST_PUBLICATION_HOURS = [
    (3, 30), (5, 30), (8, 30), (10, 30),
    (12, 30), (16, 30), (19, 30), (23, 30),
]
DEFAULT_ORIGINS = (
    "https://windlens-hazel.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)

app = FastAPI(title="WindLens API", version="2.1.0")
origins = [
    item.strip().rstrip("/")
    for item in os.getenv("CORS_ORIGINS", ",".join(DEFAULT_ORIGINS)).split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = MongoClient(
    MONGO_URI,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
)
db = client[DB_NAME]
actuals = db["wind_actuals"]
forecasts = db["wind_forecasts"]

session = requests.Session()
session.headers.update({"Accept": "application/json"})


@app.on_event("startup")
def create_indexes():
    actuals.create_index([("startTime", ASCENDING)], unique=True)
    forecasts.create_index(
        [("startTime", ASCENDING), ("publishTime", ASCENDING)],
        unique=True,
    )


# -------------------------------- Helpers ----------------------------------

def parse_time(value):
    if not value:
        return None
    try:
        text = str(value).strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    except (ValueError, TypeError, OverflowError):
        return None


def iso(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def number_or_none(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError, OverflowError):
        return None


def first(row, *keys):
    for key in keys:
        value = row.get(key)
        if value is not None and value != "":
            return value
    return None


def unwrap_records(payload):
    current = payload
    for _ in range(6):
        if isinstance(current, list):
            return [row for row in current if isinstance(row, dict)]
        if not isinstance(current, dict):
            return []
        found = False
        for key in ("data", "results", "result", "items", "records"):
            if isinstance(current.get(key), (list, dict)):
                current = current[key]
                found = True
                break
        if not found:
            return []
    return [row for row in current if isinstance(row, dict)] if isinstance(current, list) else []


def elexon_get(path, params=None, retries=2):
    """Short timeouts and limited retries keep individual calls bounded."""
    url = f"{BASE_URL}/{path.lstrip('/')}"
    last_error = None
    for attempt in range(max(1, retries)):
        try:
            response = session.get(
                url, params=params or {}, timeout=(5, 20)
            )
            response.raise_for_status()
            try:
                return unwrap_records(response.json())
            except ValueError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"Elexon returned invalid JSON for {path}",
                ) from exc
        except requests.RequestException as exc:
            last_error = exc
            if attempt < retries - 1:
                time_module.sleep(0.5 * (attempt + 1))
    raise HTTPException(
        status_code=502,
        detail={
            "message": f"Elexon request failed: {path}",
            "url": url,
            "error": str(last_error),
        },
    )


def in_january(value):
    return value is not None and JAN_START <= value < FEB_START


def delivery_start(row):
    parsed = parse_time(first(
        row, "startTime", "start_time", "deliveryStart",
        "deliveryStartTime", "settlementStartTime",
    ))
    if parsed:
        return parsed

    settlement_date = first(row, "settlementDate", "settlement_date")
    period_value = first(row, "settlementPeriod", "settlement_period")
    if settlement_date is None or period_value is None:
        return None
    try:
        day = date.fromisoformat(str(settlement_date)[:10])
        period = int(period_value)
        if period < 1 or period > 50:
            return None
        local = datetime.combine(day, time.min, tzinfo=UK)
        return (local + timedelta(minutes=30 * (period - 1))).astimezone(UTC)
    except (ValueError, TypeError, OverflowError):
        return None


def hourly_start(value):
    return value.replace(minute=0, second=0, microsecond=0)


def upsert_actual_docs(documents):
    count = 0
    for doc in documents:
        actuals.update_one(
            {"startTime": doc["startTime"]}, {"$set": doc}, upsert=True
        )
        count += 1
    return count


def upsert_forecast_docs(documents):
    count = 0
    for doc in documents:
        forecasts.update_one(
            {"startTime": doc["startTime"], "publishTime": doc["publishTime"]},
            {"$set": doc},
            upsert=True,
        )
        count += 1
    return count


# --------------------------- Actual generation -----------------------------

def hourly_actuals_from_api(start, end):
    """Fetch actuals by day, combine wind types per half-hour, then average hourly."""
    half_hour_latest = {}
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + timedelta(days=1), end)
        rows = elexon_get(
            "/generation/actual/per-type/wind-and-solar",
            {"from": iso(cursor), "to": iso(chunk_end)},
            retries=2,
        )
        for row in rows:
            business_type = str(first(row, "businessType", "business_type") or "")
            psr_type = str(first(row, "psrType", "psr_type") or "").lower()
            if business_type and business_type.lower() != "wind generation":
                continue
            if psr_type and "wind" not in psr_type:
                continue
            stamp = delivery_start(row)
            quantity = number_or_none(first(row, "quantity", "generation"))
            publish = parse_time(first(row, "publishTime", "publish_time"))
            if not in_january(stamp) or quantity is None:
                continue
            wind_type = str(first(row, "psrType", "psr_type") or "Wind")
            key = (iso(stamp), wind_type)
            previous = half_hour_latest.get(key)
            if previous is None or (
                publish is not None
                and (previous["publishTime"] is None or publish > previous["publishTime"])
            ):
                half_hour_latest[key] = {
                    "startTime": stamp,
                    "publishTime": publish,
                    "quantity": quantity,
                    "windType": wind_type,
                }
        cursor = chunk_end

    half_hour_totals = {}
    for row in half_hour_latest.values():
        key = iso(row["startTime"])
        half_hour_totals[key] = half_hour_totals.get(key, 0.0) + row["quantity"]

    hourly = {}
    for stamp_text, quantity in half_hour_totals.items():
        hour = iso(hourly_start(parse_time(stamp_text)))
        hourly.setdefault(hour, []).append(quantity)

    return [
        {
            "startTime": hour,
            "generation": sum(values) / len(values),
            "source": "generation/actual/per-type/wind-and-solar",
            "actualReadingsInHour": len(values),
        }
        for hour, values in sorted(hourly.items())
    ]


# -------------------------- Historical forecasts --------------------------

def expected_publication_times():
    current = date(2025, 12, 30)
    last = date(2026, 1, 31)
    while current <= last:
        for hour, minute in FORECAST_PUBLICATION_HOURS:
            # These are candidate publication times only; API response publishTime
            # is authoritative and is retained without rounding.
            yield datetime(
                current.year, current.month, current.day,
                hour, minute, tzinfo=UTC,
            )
        current += timedelta(days=1)


def historical_forecasts_from_api(offset=0, batch_size=4):
    """Fetch only one bounded batch; callers persist its rows before returning."""
    publication_times = list(expected_publication_times())
    selected = publication_times[offset:offset + batch_size]
    saved = {}
    diagnostics = {
        "requested_vintages": len(selected),
        "rows_received": 0,
        "rows_kept": 0,
        "empty_vintages": 0,
        "failed_vintages": [],
    }

    for requested_publish in selected:
        try:
            rows = elexon_get(
                "/forecast/generation/wind/history",
                {"publishTime": iso(requested_publish)},
                retries=1,
            )
        except HTTPException as exc:
            diagnostics["failed_vintages"].append({
                "publishTime": iso(requested_publish),
                "error": exc.detail,
            })
            continue

        diagnostics["rows_received"] += len(rows)
        if not rows:
            diagnostics["empty_vintages"] += 1

        for row in rows:
            stamp = delivery_start(row)
            publish = parse_time(first(row, "publishTime", "publish_time"))
            generation = number_or_none(first(row, "generation", "generationMW"))
            if not in_january(stamp) or publish is None or generation is None:
                continue
            doc = {
                "startTime": iso(hourly_start(stamp)),
                "publishTime": iso(publish),
                "generation": generation,
                "source": "forecast/generation/wind/history",
            }
            saved[(doc["startTime"], doc["publishTime"])] = doc

        diagnostics["rows_kept"] += len(saved)
        time_module.sleep(0.05)

    return list(saved.values()), diagnostics, len(selected), len(publication_times)


# ------------------------------ Metrics ------------------------------------

def get_cutoff(selected_date, decision_hour):
    local = datetime.combine(
        selected_date - timedelta(days=1), time(decision_hour), tzinfo=UK
    )
    return local, local.astimezone(UTC)


def metric_summary(points):
    matched = [
        p for p in points
        if p["actual"] is not None and p["forecast"] is not None
    ]
    if not matched:
        return {
            "matched_periods": 0, "mae_mw": None, "rmse_mw": None,
            "wape_percent": None, "bias_mw": None,
        }
    errors = [p["forecast"] - p["actual"] for p in matched]
    total_actual = sum(abs(p["actual"]) for p in matched)
    return {
        "matched_periods": len(matched),
        "mae_mw": sum(abs(e) for e in errors) / len(errors),
        "rmse_mw": math.sqrt(sum(e * e for e in errors) / len(errors)),
        "wape_percent": sum(abs(e) for e in errors) / total_actual * 100 if total_actual else None,
        "bias_mw": sum(errors) / len(errors),
    }


# ------------------------------ Endpoints ----------------------------------

@app.get("/")
def root():
    return {"name": "WindLens API", "version": "2.1.0", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    try:
        client.admin.command("ping")
        return {"status": "ok", "mongodb": "connected"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail="MongoDB connection failed") from exc


@app.post("/api/sync/january-2026")
def sync_january_2026(
    kind: str = Query(default="forecasts", pattern="^(actuals|forecasts)$"),
    offset: int = Query(default=0, ge=0),
    batch_size: int = Query(default=4, ge=1, le=8),
    actual_days: int = Query(default=3, ge=1, le=5),
):
    """
    Resumable sync endpoint. Run repeated requests using the returned next_offset.
    Examples:
      POST /api/sync/january-2026?kind=actuals&offset=0&actual_days=3
      POST /api/sync/january-2026?kind=forecasts&offset=0&batch_size=4
    """
    actual_saved = forecast_saved = 0
    raw_actuals = raw_forecasts = []
    diagnostics = None

    try:
        if kind == "actuals":
            total_units = (FEB_START - JAN_START).days
            if offset >= total_units:
                next_offset, done = total_units, True
            else:
                start = JAN_START + timedelta(days=offset)
                end = min(start + timedelta(days=actual_days), FEB_START)
                raw_actuals = hourly_actuals_from_api(start, end)
                actual_saved = upsert_actual_docs(raw_actuals)
                next_offset = min(offset + actual_days, total_units)
                done = next_offset >= total_units
        else:
            raw_forecasts, diagnostics, processed, total_units = historical_forecasts_from_api(
                offset=offset, batch_size=batch_size
            )
            forecast_saved = upsert_forecast_docs(raw_forecasts)
            next_offset = offset + processed
            done = next_offset >= total_units

    except (HTTPException, PyMongoError):
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"January {kind} sync failed: {exc}") from exc

    return {
        "message": f"January {kind} batch processed.",
        "kind": kind,
        "requested_range": {"from": iso(JAN_START), "to": iso(FEB_START)},
        "offset": offset,
        "next_offset": next_offset,
        "total_units": total_units,
        "done": done,
        "actual_records_processed": actual_saved,
        "forecast_records_processed": forecast_saved,
        "total_actuals_in_database": actuals.count_documents({}),
        "total_forecasts_in_database": forecasts.count_documents({}),
        "actual_sample": raw_actuals[:2],
        "forecast_sample": raw_forecasts[:2],
        "forecast_diagnostics": diagnostics,
    }


@app.get("/api/summary")
def summary():
    latest = forecasts.find_one(
        {}, {"_id": 0, "publishTime": 1}, sort=[("publishTime", DESCENDING)]
    )
    return {
        "actual_records": actuals.count_documents({}),
        "forecast_records": forecasts.count_documents({}),
        "latest_publish_time": latest.get("publishTime") if latest else None,
    }


@app.get("/api/analysis")
def analyse(
    delivery_date: str = Query(default="2026-01-15"),
    decision_hour: int = Query(default=12, ge=0, le=23),
):
    try:
        selected_date = date.fromisoformat(delivery_date)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="delivery_date must use YYYY-MM-DD format") from exc

    if not date(2026, 1, 1) <= selected_date <= date(2026, 1, 31):
        raise HTTPException(status_code=422, detail="Dataset delivery dates are 2026-01-01 through 2026-01-31.")

    cutoff_local, cutoff_utc = get_cutoff(selected_date, decision_hour)
    day_start = datetime.combine(selected_date, time.min, tzinfo=UK)
    day_end = day_start + timedelta(days=1)
    start, end, cutoff_text = iso(day_start.astimezone(UTC)), iso(day_end.astimezone(UTC)), iso(cutoff_utc)

    actual_docs = list(actuals.find(
        {"startTime": {"$gte": start, "$lt": end}}, {"_id": 0}
    ).sort("startTime", ASCENDING))

    forecast_docs = list(forecasts.find(
        {
            "startTime": {"$gte": start, "$lt": end},
            "publishTime": {"$lte": cutoff_text},
        },
        {"_id": 0},
    ).sort([("startTime", ASCENDING), ("publishTime", DESCENDING)]))

    latest_by_delivery = {}
    for row in forecast_docs:
        latest_by_delivery.setdefault(row["startTime"], row)

    actual_map = {row["startTime"]: row for row in actual_docs}
    all_times = sorted(set(actual_map) | set(latest_by_delivery))
    points = []
    for stamp in all_times:
        actual = actual_map.get(stamp)
        forecast = latest_by_delivery.get(stamp)
        actual_value = actual.get("generation") if actual else None
        forecast_value = forecast.get("generation") if forecast else None
        points.append({
            "startTime": stamp,
            "actual": actual_value,
            "forecast": forecast_value,
            "publishTime": forecast.get("publishTime") if forecast else None,
            "error": forecast_value - actual_value
                if actual_value is not None and forecast_value is not None else None,
        })

    metrics = metric_summary(points)
    return {
        "delivery_date": selected_date.isoformat(),
        "decision_cutoff_uk": cutoff_local.isoformat(),
        "decision_cutoff_utc": cutoff_text,
        "matched_periods": metrics["matched_periods"],
        "total_periods": len(points),
        "actual_periods": len(actual_docs),
        "forecast_periods_available_at_cutoff": len(latest_by_delivery),
        "mae_mw": metrics["mae_mw"],
        "rmse_mw": metrics["rmse_mw"],
        "wape_percent": metrics["wape_percent"],
        "bias_mw": metrics["bias_mw"],
        "points": points,
        "method_note": (
            "Hourly actual generation is the mean of available half-hourly wind "
            "actuals after combining onshore and offshore. For each delivery hour, "
            "the newest forecast published on or before the previous day's UK "
            "decision cutoff is selected."
        ),
    }
