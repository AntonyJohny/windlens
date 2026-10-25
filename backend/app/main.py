
import os
import time as time_module
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import PyMongoError


# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------

MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DATABASE_NAME", "windlens")

BASE_URL = os.getenv(
    "ELEXON_BASE_URL",
    "https://data.elexon.co.uk/bmrs/api/v1",
).rstrip("/")

UK = ZoneInfo("Europe/London")
UTC = timezone.utc

JAN_START = datetime(2026, 1, 1, tzinfo=UTC)
FEB_START = datetime(2026, 2, 1, tzinfo=UTC)

FORECAST_PUBLICATION_HOURS = [
    (3, 30),
    (5, 30),
    (8, 30),
    (10, 30),
    (12, 30),
    (16, 30),
    (19, 30),
    (23, 30),
]


# ---------------------------------------------------------
# FastAPI application and CORS
# ---------------------------------------------------------

app = FastAPI(title="WindLens API", version="2.0.1")

# Include your production frontend domain and local development.
# Add any other stable frontend domain you use in Vercel.
default_origins = (
    "https://windlens-hazel.vercel.app,"
    "http://localhost:5173,"
    "http://127.0.0.1:5173"
)

ALLOWED_ORIGINS = [
    origin.rstrip("/")
    for origin in os.getenv(
        "CORS_ORIGINS",
        ",".join(default_origins)
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# MongoDB
# ---------------------------------------------------------

client = MongoClient(
    MONGO_URI,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
)

db = client[DB_NAME]
actuals = db["wind_actuals"]
forecasts = db["wind_forecasts"]


# ---------------------------------------------------------
# Elexon HTTP session
# ---------------------------------------------------------

session = requests.Session()
session.headers.update({"Accept": "application/json"})


@app.on_event("startup")
def create_indexes():
    """Create indexes for actual and forecast records."""
    actuals.create_index(
        [("startTime", ASCENDING)],
        unique=True,
    )

    forecasts.create_index(
        [
            ("startTime", ASCENDING),
            ("publishTime", ASCENDING),
        ],
        unique=True,
    )


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def parse_time(value):
    if not value:
        return None

    try:
        text = str(value).strip()

        if text.endswith("Z"):
            text = text[:-1] + "+00:00"

        result = datetime.fromisoformat(text)

        if result.tzinfo is None:
            result = result.replace(tzinfo=UTC)

        return result.astimezone(UTC)

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

        if not (-float("inf") < result < float("inf")):
            return None

        return result

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

    for _ in range(5):
        if isinstance(current, list):
            return [
                row for row in current
                if isinstance(row, dict)
            ]

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

    return current if isinstance(current, list) else []


def elexon_get(path, params=None, retries=3):
    url = f"{BASE_URL}/{path.lstrip('/')}"
    last_error = None

    for attempt in range(retries):
        try:
            response = session.get(
                url,
                params=params or {},
                timeout=(15, 90),
            )

            if response.status_code == 429 or response.status_code >= 500:
                response.raise_for_status()

            response.raise_for_status()
            return unwrap_records(response.json())

        except requests.RequestException as exc:
            last_error = exc

            if attempt < retries - 1:
                time_module.sleep(1.5 * (attempt + 1))

        except ValueError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Elexon returned invalid JSON for {path}",
            ) from exc

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
    value = first(
        row,
        "startTime",
        "start_time",
        "deliveryStart",
        "deliveryStartTime",
        "settlementStartTime",
    )

    parsed = parse_time(value)

    if parsed:
        return parsed

    settlement_date = first(
        row,
        "settlementDate",
        "settlement_date",
    )

    period_value = first(
        row,
        "settlementPeriod",
        "settlement_period",
    )

    if settlement_date is None or period_value is None:
        return None

    try:
        day = date.fromisoformat(str(settlement_date)[:10])
        period = int(period_value)

        if period < 1 or period > 50:
            return None

        local = datetime.combine(
            day,
            time.min,
            tzinfo=UK,
        )

        local += timedelta(minutes=30 * (period - 1))

        return local.astimezone(UTC)

    except (ValueError, TypeError, OverflowError):
        return None


def hourly_start(value):
    """Floor a timestamp to the start of its UTC hour."""
    return value.replace(
        minute=0,
        second=0,
        microsecond=0,
    )


# ---------------------------------------------------------
# Actual wind generation
# ---------------------------------------------------------

def hourly_actuals_from_api(start, end):
    """
    Fetch actual wind records in one-day requests.

    Keep the newest published version for each wind type and
    half-hour period. Combine onshore/offshore generation, then
    average available half-hourly readings into hourly values.
    """

    half_hour_latest = {}
    cursor = start

    while cursor < end:
        chunk_end = min(
            cursor + timedelta(days=1),
            end,
        )

        rows = elexon_get(
            "/generation/actual/per-type/wind-and-solar",
            {
                "from": iso(cursor),
                "to": iso(chunk_end),
            },
        )

        for row in rows:
            business_type = str(
                first(row, "businessType", "business_type") or ""
            )

            psr_type = str(
                first(row, "psrType", "psr_type") or ""
            ).lower()

            if (
                business_type
                and business_type.lower() != "wind generation"
            ):
                continue

            if psr_type and "wind" not in psr_type:
                continue

            stamp = delivery_start(row)

            quantity = number_or_none(
                first(row, "quantity", "generation")
            )

            publish = parse_time(
                first(row, "publishTime", "publish_time")
            )

            if not in_january(stamp) or quantity is None:
                continue

            wind_type = str(
                first(row, "psrType", "psr_type") or "Wind"
            )

            key = (iso(stamp), wind_type)
            previous = half_hour_latest.get(key)

            if previous is None:
                use_row = True
            elif publish is None:
                use_row = False
            elif previous["publishTime"] is None:
                use_row = True
            else:
                use_row = publish > previous["publishTime"]

            if use_row:
                half_hour_latest[key] = {
                    "startTime": stamp,
                    "publishTime": publish,
                    "quantity": quantity,
                    "windType": wind_type,
                }

        cursor = chunk_end

    # Sum onshore and offshore generation for each half-hour.
    half_hour_totals = {}

    for row in half_hour_latest.values():
        stamp_key = iso(row["startTime"])

        half_hour_totals[stamp_key] = (
            half_hour_totals.get(stamp_key, 0.0)
            + row["quantity"]
        )

    # Group half-hour readings by UTC hour.
    hourly_buckets = {}

    for stamp_text, quantity in half_hour_totals.items():
        stamp = parse_time(stamp_text)
        hour = hourly_start(stamp)

        hourly_buckets.setdefault(
            iso(hour),
            [],
        ).append(quantity)

    results = []

    for hour_text, values in sorted(hourly_buckets.items()):
        results.append({
            "startTime": hour_text,
            "generation": sum(values) / len(values),
            "source": "generation/actual/per-type/wind-and-solar",
            "actualReadingsInHour": len(values),
        })

    return results


# ---------------------------------------------------------
# Historical wind forecasts
# ---------------------------------------------------------

def expected_publication_times():
    """
    Generate candidate forecast publication timestamps from
    30 December 2025 through 31 January 2026.
    """

    current = date(2025, 12, 30)
    last = date(2026, 1, 31)

    while current <= last:
        for hour, minute in FORECAST_PUBLICATION_HOURS:
            yield datetime(
                current.year,
                current.month,
                current.day,
                hour,
                minute,
                tzinfo=UTC,
            )

        current += timedelta(days=1)


def historical_forecasts_from_api():
    """
    Retrieve historical forecast vintages.
    Use publishTime returned by Elexon for cutoff checks.
    """

    saved = {}

    for requested_publish in expected_publication_times():
        try:
            rows = elexon_get(
                "/forecast/generation/wind/history",
                {
                    "publishTime": iso(requested_publish),
                },
                retries=2,
            )

        except HTTPException:
            # Continue collecting other publication vintages.
            continue

        for row in rows:
            stamp = delivery_start(row)

            publish = parse_time(
                first(row, "publishTime", "publish_time")
            )

            generation = number_or_none(
                first(row, "generation", "generationMW")
            )

            if (
                not in_january(stamp)
                or publish is None
                or generation is None
            ):
                continue

            doc = {
                "startTime": iso(hourly_start(stamp)),
                "publishTime": iso(publish),
                "generation": generation,
                "source": "forecast/generation/wind/history",
            }

            key = (
                doc["startTime"],
                doc["publishTime"],
            )

            saved[key] = doc

        time_module.sleep(0.08)

    return list(saved.values())


# ---------------------------------------------------------
# Forecast decision cutoff and metrics
# ---------------------------------------------------------

def get_cutoff(selected_date, decision_hour):
    cutoff_local = datetime.combine(
        selected_date - timedelta(days=1),
        time(decision_hour),
        tzinfo=UK,
    )

    return cutoff_local, cutoff_local.astimezone(UTC)


def metric_summary(points):
    matched = [
        point for point in points
        if (
            point["actual"] is not None
            and point["forecast"] is not None
        )
    ]

    if not matched:
        return {
            "matched_periods": 0,
            "mae_mw": None,
            "rmse_mw": None,
            "wape_percent": None,
            "bias_mw": None,
        }

    errors = [
        point["forecast"] - point["actual"]
        for point in matched
    ]

    mae = sum(abs(error) for error in errors) / len(errors)

    rmse = (
        sum(error * error for error in errors) / len(errors)
    ) ** 0.5

    total_actual = sum(
        abs(point["actual"])
        for point in matched
    )

    return {
        "matched_periods": len(matched),
        "mae_mw": mae,
        "rmse_mw": rmse,
        "wape_percent": (
            sum(abs(error) for error in errors)
            / total_actual
            * 100
            if total_actual
            else None
        ),
        "bias_mw": sum(errors) / len(errors),
    }


# ---------------------------------------------------------
# Basic endpoints
# ---------------------------------------------------------

@app.get("/")
def root():
    return {
        "name": "WindLens API",
        "version": "2.0.1",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health():
    try:
        client.admin.command("ping")

        return {
            "status": "ok",
            "mongodb": "connected",
        }

    except Exception:
        raise HTTPException(
            status_code=503,
            detail="MongoDB connection failed",
        )


# ---------------------------------------------------------
# January 2026 sync endpoint
# ---------------------------------------------------------

@app.post("/api/sync/january-2026")
def sync_january_2026():
    try:
        raw_actuals = hourly_actuals_from_api(
            start=JAN_START,
            end=FEB_START,
        )

        raw_forecasts = historical_forecasts_from_api()

        actual_saved = 0
        forecast_saved = 0

        for doc in raw_actuals:
            actuals.update_one(
                {"startTime": doc["startTime"]},
                {"$set": doc},
                upsert=True,
            )
            actual_saved += 1

        for doc in raw_forecasts:
            forecasts.update_one(
                {
                    "startTime": doc["startTime"],
                    "publishTime": doc["publishTime"],
                },
                {"$set": doc},
                upsert=True,
            )
            forecast_saved += 1

    except (HTTPException, PyMongoError):
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"January sync failed: {exc}",
        ) from exc

    total_actuals = actuals.count_documents({})
    total_forecasts = forecasts.count_documents({})

    if actual_saved == 0 or forecast_saved == 0:
        message = (
            "Sync completed but one or more data sources returned no "
            "usable January records. Check the diagnostics before "
            "analysing results."
        )
    else:
        message = "January 2026 sync completed."

    return {
        "message": message,
        "requested_range": {
            "from": iso(JAN_START),
            "to": iso(FEB_START),
        },
        "actual_source": (
            "/generation/actual/per-type/wind-and-solar"
        ),
        "forecast_source": (
            "/forecast/generation/wind/history"
        ),
        "actual_records_processed": actual_saved,
        "forecast_records_processed": forecast_saved,
        "total_actuals_in_database": total_actuals,
        "total_forecasts_in_database": total_forecasts,
        "actual_sample": raw_actuals[:2],
        "forecast_sample": raw_forecasts[:2],
    }


# ---------------------------------------------------------
# Summary endpoint
# ---------------------------------------------------------

@app.get("/api/summary")
def summary():
    latest = forecasts.find_one(
        {},
        {"_id": 0, "publishTime": 1},
        sort=[("publishTime", DESCENDING)],
    )

    return {
        "actual_records": actuals.count_documents({}),
        "forecast_records": forecasts.count_documents({}),
        "latest_publish_time": (
            latest.get("publishTime")
            if latest
            else None
        ),
    }


# ---------------------------------------------------------
# Analysis endpoint
# ---------------------------------------------------------

@app.get("/api/analysis")
def analyse(
    delivery_date: str = Query(default="2026-01-15"),
    decision_hour: int = Query(default=12, ge=0, le=23),
):
    try:
        selected_date = date.fromisoformat(delivery_date)

    except (ValueError, TypeError):
        raise HTTPException(
            status_code=422,
            detail="delivery_date must use YYYY-MM-DD format",
        )

    if not date(2026, 1, 1) <= selected_date <= date(2026, 1, 31):
        raise HTTPException(
            status_code=422,
            detail=(
                "This dataset contains delivery dates from "
                "2026-01-01 to 2026-01-31."
            ),
        )

    cutoff_local, cutoff_utc = get_cutoff(
        selected_date,
        decision_hour,
    )

    day_start_local = datetime.combine(
        selected_date,
        time.min,
        tzinfo=UK,
    )

    day_end_local = day_start_local + timedelta(days=1)

    start = iso(day_start_local.astimezone(UTC))
    end = iso(day_end_local.astimezone(UTC))
    cutoff_text = iso(cutoff_utc)

    actual_docs = list(
        actuals.find(
            {
                "startTime": {
                    "$gte": start,
                    "$lt": end,
                },
            },
            {"_id": 0},
        ).sort("startTime", ASCENDING)
    )

    forecast_docs = list(
        forecasts.find(
            {
                "startTime": {
                    "$gte": start,
                    "$lt": end,
                },
                "publishTime": {
                    "$lte": cutoff_text,
                },
            },
            {"_id": 0},
        ).sort(
            [
                ("startTime", ASCENDING),
                ("publishTime", DESCENDING),
            ]
        )
    )

    # Select the newest forecast available before the cutoff
    # for each delivery hour.
    latest_by_delivery = {}

    for row in forecast_docs:
        latest_by_delivery.setdefault(
            row["startTime"],
            row,
        )

    actual_map = {
        row["startTime"]: row
        for row in actual_docs
    }

    all_times = sorted(
        set(actual_map) | set(latest_by_delivery)
    )

    points = []

    for stamp in all_times:
        actual = actual_map.get(stamp)
        forecast = latest_by_delivery.get(stamp)

        actual_value = (
            actual.get("generation")
            if actual
            else None
        )

        forecast_value = (
            forecast.get("generation")
            if forecast
            else None
        )

        points.append({
            "startTime": stamp,
            "actual": actual_value,
            "forecast": forecast_value,
            "publishTime": (
                forecast.get("publishTime")
                if forecast
                else None
            ),
            "error": (
                forecast_value - actual_value
                if (
                    actual_value is not None
                    and forecast_value is not None
                )
                else None
            ),
        })

    metrics = metric_summary(points)

    return {
        "delivery_date": selected_date.isoformat(),
        "decision_cutoff_uk": cutoff_local.isoformat(),
        "decision_cutoff_utc": cutoff_text,
        "matched_periods": metrics["matched_periods"],
        "total_periods": len(points),
        "actual_periods": len(actual_docs),
        "forecast_periods_available_at_cutoff": len(forecast_docs),
        "mae_mw": metrics["mae_mw"],
        "rmse_mw": metrics["rmse_mw"],
        "wape_percent": metrics["wape_percent"],
        "bias_mw": metrics["bias_mw"],
        "points": points,
        "method_note": (
            "Hourly actual generation is the mean of available "
            "half-hourly wind actuals after combining onshore and "
            "offshore. For each delivery hour, the newest forecast "
            "published on or before the previous day's UK decision "
            "cutoff is selected."
        ),
    }
