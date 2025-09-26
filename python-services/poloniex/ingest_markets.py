#!/usr/bin/env python3
"""
Poloniex Futures Markets Ingestion (Python service)

Goal:
- Fetch Poloniex Futures v3 markets (product info + risk limits)
- Normalize to project catalog schema: docs/markets/poloniex-futures-v3.json
- Use official SDK if available; otherwise fallback to signed REST
- No secrets committed. Reads env vars:
    - POLO_API_KEY / POLO_API_SECRET (preferred for Python SDK)
    - POLONIEX_API_KEY / POLONIEX_API_SECRET (fallback names)

Requirements:
- Python 3.8+
- requests (if SDK not used)
- Optional: polo-sdk-python (git+https://github.com/poloniex/polo-sdk-python)

Run:
  export POLO_API_KEY="..."
  export POLO_API_SECRET="..."
  python3 python-services/poloniex/ingest_markets.py

or using Poloniex env names:
  export POLONIEX_API_KEY="..."
  export POLONIEX_API_SECRET="..."
  python3 python-services/poloniex/ingest_markets.py
"""
import base64
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Try to import SDK (if installed)
SDK_AVAILABLE = False
try:
    # The SDK structure/documentation is sparse; keep import optional.
    # If a Futures client exists under polosdk, import it here.
    # Fallback to REST if import fails.
    import polosdk  # type: ignore
    SDK_AVAILABLE = True
except Exception:
    SDK_AVAILABLE = False

import requests


# Hosts and prefixes (updated for proper v3 API)
PRIMARY_HOST = "https://api.poloniex.com"
PRIMARY_PREFIX = "/v3"  # correct v3 API prefix
FALLBACK_HOST = "https://api.poloniex.com" 
FALLBACK_PREFIX = "/v3"  # consistent v3 prefix

# Correct v3 API endpoints
PATH_ALL_PRODUCT_INFO = "/market/allInstruments"
PATH_MARKET_INFO = "/market/tickers"
PATH_FUTURES_RISK_LIMIT = "/market/riskLimit"


def env_str(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    return ""


API_KEY = env_str("POLO_API_KEY", "POLONIEX_API_KEY")
API_SECRET = env_str("POLO_API_SECRET", "POLONIEX_API_SECRET")


def sign_message(secret: str, msg: str) -> str:
    mac = hmac.new(secret.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256)
    return base64.b64encode(mac.digest()).decode("utf-8")


def build_headers(method: str, request_path: str, body: str = "") -> Dict[str, str]:
    """
    Build Poloniex v3 API authentication headers.
    Signature format: METHOD\n + REQUEST_PATH\n + BODY + timestamp
    """
    timestamp = str(int(time.time() * 1000))  # v3 API expects milliseconds
    
    # Build signature string per v3 spec
    message = f"{method.upper()}\n{request_path}\n{body}{timestamp}"
    sig = sign_message(API_SECRET, message)
    
    return {
        "Accept": "application/json", 
        "Content-Type": "application/json",
        "key": API_KEY,
        "signature": sig,
        "signTimestamp": timestamp,
        "signatureMethod": "HmacSHA256",
        "signatureVersion": "2"
    }


def fetch_json(url: str, headers: Optional[Dict[str, str]] = None, method: str = "GET", body: Optional[str] = None) -> Any:
    if method == "GET":
        resp = requests.get(url, headers=headers, timeout=20)
    else:
        resp = requests.request(method, url, headers=headers, data=body or "", timeout=20)
    ctype = resp.headers.get("content-type", "")
    if not resp.ok:
        preview = ""
        try:
            preview = resp.text[:400]
        except Exception:
            preview = ""
        raise RuntimeError(f"HTTP {resp.status_code} for {url} :: {preview}")
    if "application/json" not in ctype:
        text = ""
        try:
            text = resp.text[:400]
        except Exception:
            text = ""
        raise RuntimeError(f"Non-JSON from {url}: {text}")
    return resp.json()


def try_candidates(relative_path: str, signed: bool = True) -> Any:
    """
    Try (host, prefix) combinations with optional signed headers.
    """
    errors: List[str] = []
    for host, prefix in ((PRIMARY_HOST, PRIMARY_PREFIX), (FALLBACK_HOST, FALLBACK_PREFIX)):
        request_path = prefix + relative_path
        url = host + request_path
        try:
            headers = build_headers("GET", request_path, "") if signed else {"Accept": "application/json"}
            data = fetch_json(url, headers=headers)
            return data
        except Exception as e:
            errors.append(f"{url} :: {e}")
            continue
    raise RuntimeError("All candidates failed for " + relative_path + " :: " + " | ".join(errors))


def safe_number(v: Any, fallback: Optional[float] = None) -> Optional[float]:
    try:
        n = float(v)
        if n == float("inf") or n == float("-inf"):
            return fallback
        return n
    except Exception:
        return fallback


def infer_precisions_from_tick_lot(tick: Optional[float], lot: Optional[float]) -> Tuple[Optional[int], Optional[int]]:
    def decimals(x: Optional[float]) -> Optional[int]:
        if x is None:
            return None
        s = f"{x}"
        if "." in s:
            return len(s.split(".")[1])
        return 0
    return decimals(tick), decimals(lot)


def extract_products_common(src_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in src_list:
        symbol = str(p.get("symbol") or p.get("contract") or p.get("instId") or p.get("name") or "").replace("-", "").upper()
        if not symbol:
            continue
        base = str(p.get("baseCurrency") or p.get("base") or "").upper()
        quote = str(p.get("quoteCurrency") or p.get("quote") or "").upper()

        tick_size = safe_number(p.get("tickSize")) or safe_number(p.get("priceTick")) or safe_number(p.get("priceTickSize"))
        lot_size = safe_number(p.get("lotSize")) or safe_number(p.get("qtyStep")) or safe_number(p.get("quantityStep"))
        min_notional = safe_number(p.get("minNotional")) or safe_number(p.get("minValue")) or safe_number(p.get("minTradeValue"))
        max_leverage = safe_number(p.get("maxLeverage")) or safe_number(p.get("lever") or p.get("leverage"))
        status_raw = str(p.get("status") or p.get("state") or "").lower()
        if "trade" in status_raw or status_raw in ("online", "open"):
            status = "trading"
        elif "pause" in status_raw:
            status = "paused"
        elif "delist" in status_raw:
            status = "delisted"
        else:
            status = "trading"

        price_precision = None
        qty_precision = None
        if isinstance(p.get("pricePrecision"), (int, float)):
            price_precision = int(p.get("pricePrecision"))
        if isinstance(p.get("quantityPrecision") or p.get("qtyPrecision"), (int, float)):
            qty_precision = int(p.get("quantityPrecision") or p.get("qtyPrecision"))

        if price_precision is None or qty_precision is None:
            inf_pp, inf_qp = infer_precisions_from_tick_lot(tick_size, lot_size)
            if price_precision is None:
                price_precision = inf_pp
            if qty_precision is None:
                qty_precision = inf_qp

        contract_type = str(p.get("contractType") or p.get("type") or "perpetual").lower()

        out.append({
            "symbol": symbol,
            "base": base,
            "quote": quote,
            "contractType": contract_type,
            "status": status,
            "pricePrecision": price_precision,
            "quantityPrecision": qty_precision,
            "tickSize": tick_size,
            "lotSize": lot_size,
            "minNotional": min_notional,
            "maxLeverage": max_leverage,
        })
    return out


def extract_from_all_product_info(json_obj: Any) -> List[Dict[str, Any]]:
    data = []
    if isinstance(json_obj, dict):
        if isinstance(json_obj.get("data"), list):
            data = json_obj["data"]
        elif isinstance(json_obj.get("products"), list):
            data = json_obj["products"]
    elif isinstance(json_obj, list):
        data = json_obj
    return extract_products_common(data)


def extract_from_market_info(json_obj: Any) -> List[Dict[str, Any]]:
    candidates = []
    if isinstance(json_obj, dict):
        for key in ("data", "symbols"):
            val = json_obj.get(key)
            if isinstance(val, list):
                candidates = val
                break
        if not candidates and isinstance(json_obj.get("data"), dict):
            if isinstance(json_obj["data"].get("symbols"), list):
                candidates = json_obj["data"]["symbols"]
    elif isinstance(json_obj, list):
        candidates = json_obj
    return extract_products_common(candidates)


def build_risk_map(risk_json: Any) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    lst = []
    if isinstance(risk_json, dict):
        if isinstance(risk_json.get("data"), list):
            lst = risk_json["data"]
        elif isinstance(risk_json.get("riskLimits"), list):
            lst = risk_json["riskLimits"]
    elif isinstance(risk_json, list):
        lst = risk_json
    for item in lst:
        # Accept shape: { symbol, tiers: [...] } or a list of tiers
        symbol = str(item.get("symbol") or item.get("contract") or item.get("instId") or "").replace("-", "").upper()
        tiers: List[Dict[str, Any]] = []
        if isinstance(item.get("tiers"), list):
            src = item["tiers"]
        elif isinstance(item, list):
            src = item
        else:
            src = [item]
        for t in src:
            tiers.append({
                "tier": int(t.get("tier") or 0),
                "maxPosition": safe_number(t.get("maxPosition")),
                "initialMarginRate": safe_number(t.get("initialMarginRate")),
                "maintenanceMarginRate": safe_number(t.get("maintenanceMarginRate")),
            })
        if symbol:
            out[symbol] = tiers
    return out


def merge_products_with_risk(products: List[Dict[str, Any]], risk_map: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    for prod in products:
        sym = prod["symbol"]
        tiers = risk_map.get(sym, [])
        maintenance_table = []
        for t in tiers:
            mmr = t.get("maintenanceMarginRate")
            if mmr is not None:
                maintenance_table.append({
                    "notionalFloor": t.get("maxPosition") or 0,
                    "maintenanceMarginRate": mmr,
                })
        merged.append({
            **prod,
            "maintenanceMarginTable": maintenance_table,
            "riskLimits": tiers,
            "feesBps": {"maker": None, "taker": None},
            "funding": {"intervalHours": 8, "rateCap": None},
        })
    return merged


def load_catalog(catalog_path: Path) -> Dict[str, Any]:
    if not catalog_path.exists():
        return {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "_note": "Generated markets catalog. Policy: include all markets; use exchange max leverage and exchange fees.",
            "version": 1,
            "source": "../railway-poloniex-docs.md",
            "lastSynced": "",
            "markets": []
        }
    try:
        return json.loads(catalog_path.read_text(encoding="utf-8"))
    except Exception:
        return {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "_note": "Generated markets catalog. Policy: include all markets; use exchange max leverage and exchange fees.",
            "version": 1,
            "source": "../railway-poloniex-docs.md",
            "lastSynced": "",
            "markets": []
        }


def save_catalog(catalog_path: Path, data: Dict[str, Any]) -> None:
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def main() -> int:
    print("[PY-INGEST] Starting Poloniex Futures markets ingestion (Python).", flush=True)

    # Locate project root and catalog path
    service_dir = Path(__file__).resolve().parent
    project_root = service_dir.parents[1]  # python-services/poloniex -> python-services -> project root
    catalog_path = (project_root / "docs" / "markets" / "poloniex-futures-v3.json").resolve()

    use_signed = bool(API_KEY and API_SECRET)
    if not use_signed:
        print("[PY-INGEST] Warning: API key/secret not set (POLO_API_KEY/POLO_API_SECRET or POLONIEX_API_*). "
              "Unsigned requests will likely return 400 or 503.", flush=True)

    products: List[Dict[str, Any]] = []
    # Try signed get-all-product-info
    try:
        data = try_candidates(PATH_ALL_PRODUCT_INFO, signed=use_signed)
        products = extract_from_all_product_info(data)
        if products:
            print(f"[PY-INGEST] Extracted {len(products)} products from get-all-product-info", flush=True)
    except Exception as e:
        print(f"[PY-INGEST] get-all-product-info failed: {e}", flush=True)

    # Fallback to get-market-info if needed
    if not products:
        try:
            data2 = try_candidates(PATH_MARKET_INFO, signed=use_signed)
            products = extract_from_market_info(data2)
            if products:
                print(f"[PY-INGEST] Extracted {len(products)} products from get-market-info", flush=True)
        except Exception as e:
            print(f"[PY-INGEST] get-market-info failed: {e}", flush=True)

    # Risk limits
    risk_map: Dict[str, List[Dict[str, Any]]] = {}
    try:
        risk_json = try_candidates(PATH_FUTURES_RISK_LIMIT, signed=use_signed)
        risk_map = build_risk_map(risk_json)
        print(f"[PY-INGEST] Risk map entries: {len(risk_map)}", flush=True)
    except Exception as e:
        print(f"[PY-INGEST] get-futures-risk-limit failed: {e}", flush=True)

    if not products:
        print("[PY-INGEST] No products extracted. Catalog will not be updated with markets.", flush=True)
        # We still update lastSynced to reflect attempt, but keep empty markets
        catalog = load_catalog(catalog_path)
        updated = {
            **catalog,
            "lastSynced": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "markets": catalog.get("markets", []),
        }
        save_catalog(catalog_path, updated)
        print(f"[PY-INGEST] Catalog written (no markets) at {catalog_path}", flush=True)
        return 0

    merged = merge_products_with_risk(products, risk_map)
    catalog = load_catalog(catalog_path)
    prev_count = len(catalog.get("markets", [])) if isinstance(catalog.get("markets"), list) else 0
    next_count = len(merged)
    version = catalog.get("version")
    try:
        version_num = int(version)
    except Exception:
        version_num = 1

    updated = {
        **catalog,
        "version": version_num + (1 if next_count != prev_count else 0),
        "lastSynced": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "markets": merged,
    }
    save_catalog(catalog_path, updated)
    print(f"[PY-INGEST] Catalog updated at {catalog_path} with {next_count} markets.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
