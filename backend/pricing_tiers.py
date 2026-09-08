"""
pricing_tiers.py — Shackle AI billing plan definitions and PPP pricing helpers.

Security contract
-----------------
Country resolution MUST always use _resolve_country_from_request(request), which
reads server-side infrastructure headers (cf-ipcountry, x-vercel-ip-country).
The client never supplies a country value that feeds into charge computation.

Plan model
----------
Each plan is a one-time payment covering a fixed number of days.
No Razorpay Subscriptions API; no auto-renewal. Renewal is prompted by the
existing billing expiration lifecycle when premium_end_date passes.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import Request

# ---------------------------------------------------------------------------
# 1. PLAN TABLE
#    Keys are canonical plan_ids accepted by the API.
#    usd_cents: base price before any PPP multiplier (1 USD = 100 cents).
#    days:      duration of the Premium access period granted on payment.
#    label:     human-readable name displayed in the checkout UI.
# ---------------------------------------------------------------------------
PLANS: dict = {
    "monthly": {
        "plan_id":   "monthly",
        "label":     "Monthly",
        "usd_cents": 999,       # $9.99 / month
        "days":      30,
    },
    "quarterly": {
        "plan_id":   "quarterly",
        "label":     "Quarterly",
        "usd_cents": 2499,      # $24.99 / quarter  (~$8.33/mo, 17% off)
        "days":      90,
    },
    "half_yearly": {
        "plan_id":   "half_yearly",
        "label":     "6 Months",
        "usd_cents": 3999,      # $39.99 / 6 months (~$6.67/mo, 33% off)
        "days":      180,
    },
    "annual": {
        "plan_id":   "annual",
        "label":     "Annual",
        "usd_cents": 5999,      # $59.99 / year     (~$5.00/mo, 50% off)
        "days":      365,
    },
}

# The canonical list of valid plan_ids for input validation.
VALID_PLAN_IDS = frozenset(PLANS.keys())


# ---------------------------------------------------------------------------
# 2. WORLD BANK INCOME GROUP -> TIER
#    Based on World Bank Atlas method country classifications (FY2025).
#    "high"         = high income          -> full price (multiplier 1.0)
#    "upper_middle" = upper-middle income  -> moderate discount
#    "lower_middle" = lower-middle income  -> deeper discount
#    "low"          = low income           -> steepest discount
#    Countries not listed -> "high" (safe default: full price, no PPP benefit).
# ---------------------------------------------------------------------------
INCOME_TIER_MAP: dict = {
    # High income
    "US": "high", "GB": "high", "CA": "high", "AU": "high", "NZ": "high",
    "DE": "high", "FR": "high", "IT": "high", "ES": "high", "NL": "high",
    "SE": "high", "NO": "high", "DK": "high", "FI": "high", "CH": "high",
    "AT": "high", "BE": "high", "LU": "high", "IE": "high", "PT": "high",
    "JP": "high", "KR": "high", "SG": "high", "HK": "high", "TW": "high",
    "IL": "high", "AE": "high", "SA": "high", "KW": "high", "QA": "high",
    "BH": "high", "OM": "high", "CY": "high", "MT": "high", "GR": "high",
    "CZ": "high", "SK": "high", "HU": "high", "PL": "high", "EE": "high",
    "LV": "high", "LT": "high", "SI": "high", "HR": "high", "RO": "high",
    "BG": "high", "CL": "high", "UY": "high", "PA": "high", "TT": "high",
    "BS": "high", "BB": "high",
    # Upper-middle income
    "BR": "upper_middle", "MX": "upper_middle", "AR": "upper_middle",
    "CO": "upper_middle", "PE": "upper_middle", "EC": "upper_middle",
    "ZA": "upper_middle", "CN": "upper_middle", "TR": "upper_middle",
    "TH": "upper_middle", "MY": "upper_middle", "ID": "upper_middle",
    "RU": "upper_middle", "IR": "upper_middle", "IQ": "upper_middle",
    "DZ": "upper_middle", "MA": "upper_middle", "TN": "upper_middle",
    "LY": "upper_middle", "EG": "upper_middle", "JO": "upper_middle",
    "LB": "upper_middle", "AZ": "upper_middle", "GE": "upper_middle",
    "AM": "upper_middle", "MK": "upper_middle", "RS": "upper_middle",
    "BA": "upper_middle", "AL": "upper_middle", "ME": "upper_middle",
    "KZ": "upper_middle", "UA": "upper_middle", "BY": "upper_middle",
    "MD": "upper_middle", "CU": "upper_middle", "DO": "upper_middle",
    "GT": "upper_middle", "SV": "upper_middle", "HN": "upper_middle",
    "PY": "upper_middle", "BO": "upper_middle", "VE": "upper_middle",
    "FJ": "upper_middle", "PW": "upper_middle",
    # Lower-middle income
    "IN": "lower_middle", "PK": "lower_middle", "BD": "lower_middle",
    "NG": "lower_middle", "GH": "lower_middle", "KE": "lower_middle",
    "UZ": "lower_middle", "VN": "lower_middle", "PH": "lower_middle",
    "LK": "lower_middle", "NP": "lower_middle", "MM": "lower_middle",
    "KH": "lower_middle", "LA": "lower_middle", "ZM": "lower_middle",
    "ZW": "lower_middle", "TZ": "lower_middle", "UG": "lower_middle",
    "ET": "lower_middle", "SD": "lower_middle", "AO": "lower_middle",
    "CM": "lower_middle", "CI": "lower_middle", "SN": "lower_middle",
    "MR": "lower_middle", "TM": "lower_middle", "KG": "lower_middle",
    "TJ": "lower_middle", "PS": "lower_middle", "YE": "lower_middle",
    "SY": "lower_middle", "HT": "lower_middle", "NI": "lower_middle",
    "MN": "lower_middle", "PG": "lower_middle",
    # Low income
    "AF": "low", "CD": "low", "ML": "low", "NE": "low", "BF": "low",
    "TD": "low", "MZ": "low", "MW": "low", "MG": "low", "RW": "low",
    "BI": "low", "ER": "low", "SO": "low", "SS": "low", "CF": "low",
    "SL": "low", "LR": "low", "GN": "low", "GW": "low", "GM": "low",
    "TG": "low",
}

# Default PPP multipliers if Firestore config/pricing doc is absent.
# "moderate" mode is the safe default.
DEFAULT_PRICING_CONFIG: dict = {
    "mode": "moderate",
    "multipliers": {
        "moderate": {
            "high":         1.00,
            "upper_middle": 0.80,
            "lower_middle": 0.60,
            "low":          0.40,
        },
        "aggressive": {
            "high":         1.00,
            "upper_middle": 0.70,
            "lower_middle": 0.50,
            "low":          0.25,
        },
    },
}


# ---------------------------------------------------------------------------
# 3. SERVER-SIDE COUNTRY RESOLUTION
#    The ONLY place country is determined for any billing operation.
#    Never reads from query params, request body, or any client-supplied field.
# ---------------------------------------------------------------------------

def _resolve_country_from_request(request: Request) -> Optional[str]:
    """
    Derive the user's country exclusively from server-side infrastructure headers.

    Resolution order:
      1. cf-ipcountry       -- Cloudflare (production, most reliable)
      2. x-vercel-ip-country -- Vercel Edge (production)
      3. PPP_DEV_COUNTRY env var -- server-side local dev override (never client)
      4. None               -> caller defaults to "high" tier (full price)

    Returns a 2-letter ISO 3166-1 alpha-2 country code (upper-case), or None.
    """
    # 1. Cloudflare
    cf = request.headers.get("cf-ipcountry", "").strip().upper()
    if cf and cf not in ("XX", "T1", ""):   # XX = unknown, T1 = Tor
        return cf

    # 2. Vercel Edge
    vercel = request.headers.get("x-vercel-ip-country", "").strip().upper()
    if vercel:
        return vercel

    # 3. Server-side dev override (env var, never from client)
    dev = os.environ.get("PPP_DEV_COUNTRY", "").strip().upper()
    if dev:
        return dev

    return None


def resolve_income_tier(request: Request) -> str:
    """
    Resolve the World Bank income tier for the request's origin country.
    Returns one of: "high", "upper_middle", "lower_middle", "low".
    Falls back to "high" (full price) if country is unknown.
    """
    country = _resolve_country_from_request(request)
    if not country:
        return "high"
    return INCOME_TIER_MAP.get(country, "high")


# ---------------------------------------------------------------------------
# 4. PPP MULTIPLIER LOOKUP
# ---------------------------------------------------------------------------

def get_ppp_multiplier(tier: str, pricing_config: Optional[dict]) -> float:
    """
    Return the PPP discount multiplier for the given income tier.

    pricing_config is the Firestore config/pricing document (or None if fetch
    failed / doc missing). Falls back gracefully to DEFAULT_PRICING_CONFIG.
    """
    cfg = pricing_config if isinstance(pricing_config, dict) else DEFAULT_PRICING_CONFIG

    mode = cfg.get("mode", "moderate")
    multipliers = cfg.get("multipliers", DEFAULT_PRICING_CONFIG["multipliers"])
    mode_map = multipliers.get(mode, DEFAULT_PRICING_CONFIG["multipliers"]["moderate"])

    # "high" is always 1.0 -- guard against any config tampering.
    if tier == "high":
        return 1.0

    mult = float(mode_map.get(tier, 1.0))
    # Safety clamp: never let the server compute a zero or negative price.
    return max(0.10, min(1.0, mult))


def compute_plan_cents(plan_id: str, tier: str, exchange_rate: float,
                       pricing_config: Optional[dict]) -> int:
    """
    Compute the final amount in currency-smallest-units for a given plan.

      final_cents = round(usd_base_cents * ppp_multiplier * fx_rate)

    Returns an int (smallest currency unit, e.g. paise for INR, cents for USD).
    Minimum 100 (i.e. 1 USD-equivalent) to satisfy Razorpay minimums.
    """
    plan = PLANS[plan_id]
    mult = get_ppp_multiplier(tier, pricing_config)
    raw = plan["usd_cents"] * mult * exchange_rate
    return max(100, int(round(raw)))


# ---------------------------------------------------------------------------
# 5. FIRESTORE CONFIG SEEDING
# ---------------------------------------------------------------------------

def seed_pricing_config_if_missing(db) -> None:
    """
    Write DEFAULT_PRICING_CONFIG to Firestore config/pricing if the document
    does not already exist. Called once at server startup.

    `db` is a firestore.Client instance (from firebase_admin.firestore).
    No-op if the document already exists or if db is None.
    """
    if db is None:
        return
    try:
        ref = db.collection("config").document("pricing")
        snap = ref.get()
        if not snap.exists:
            ref.set(DEFAULT_PRICING_CONFIG)
            print("[BILLING] config/pricing seeded with DEFAULT_PRICING_CONFIG (moderate mode).")
        else:
            print("[BILLING] config/pricing already exists -- skipping seed.")
    except Exception as exc:
        print(f"[BILLING] config/pricing seed failed (non-fatal): {exc}")


def fetch_pricing_config(db) -> dict:
    """
    Fetch the Firestore config/pricing document.
    Returns DEFAULT_PRICING_CONFIG on any failure.
    """
    if db is None:
        return DEFAULT_PRICING_CONFIG
    try:
        snap = db.collection("config").document("pricing").get()
        if snap.exists:
            data = snap.to_dict()
            # Basic sanity check
            if "multipliers" in data and "mode" in data:
                return data
    except Exception as exc:
        print(f"[BILLING] fetch_pricing_config failed, using defaults: {exc}")
    return DEFAULT_PRICING_CONFIG
