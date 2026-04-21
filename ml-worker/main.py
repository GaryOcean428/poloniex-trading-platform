"""
ML Worker FastAPI Server
Serves ML predictions via HTTP and listens on Redis pub/sub.
"""

import json
import logging
import os
import sys
import threading
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# Ensure src/ is on the path so models can be imported
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from ensemble_predictor import EnsemblePredictor

logger = logging.getLogger("ml-worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
predictor = EnsemblePredictor()
REDIS_URL = os.environ.get("REDIS_URL", "")

# ---------------------------------------------------------------------------
# Redis pub/sub listener (background thread)
# ---------------------------------------------------------------------------

def _start_redis_listener():
    """Subscribe to ml:predict:request and publish responses."""
    if not REDIS_URL:
        logger.info("REDIS_URL not set — Redis pub/sub listener disabled")
        return

    try:
        import redis
    except ImportError:
        logger.warning("redis package not installed — Redis pub/sub listener disabled")
        return

    def _listener():
        REQUEST_CHANNEL = "ml:predict:request"
        HEALTH_KEY = "ml:health"
        try:
            r = redis.from_url(REDIS_URL, decode_responses=True)
            pubsub = r.pubsub()
            pubsub.subscribe(REQUEST_CHANNEL)
            logger.info(f"Redis pub/sub listener subscribed to {REQUEST_CHANNEL}")

            # Write initial health heartbeat
            r.set(HEALTH_KEY, json.dumps({"status": "ok"}), ex=90)

            for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                    request_id = payload.pop("requestId", None)
                    result = _handle_predict(payload)
                    if request_id:
                        r.publish(f"ml:predict:response:{request_id}", json.dumps(result, default=str))
                    # Refresh heartbeat
                    r.set(HEALTH_KEY, json.dumps({"status": "ok"}), ex=90)
                except Exception as exc:
                    logger.error(f"Redis handler error: {exc}", exc_info=True)
                    if request_id:
                        r.publish(
                            f"ml:predict:response:{request_id}",
                            json.dumps({"status": "error", "error": str(exc)}),
                        )
        except Exception as exc:
            logger.error(f"Redis listener crashed: {exc}", exc_info=True)

    t = threading.Thread(target=_listener, daemon=True, name="redis-pubsub")
    t.start()


# ---------------------------------------------------------------------------
# Trade-outcome listener (online training data feed)
# ---------------------------------------------------------------------------

# In-memory ring buffer of recent trade outcomes. The ensemble predictor
# can read this to adjust model weights online, or a downstream training
# job can flush it to disk. Kept bounded so the process can't OOM on a
# prolonged downstream outage.
_TRADE_OUTCOMES: list[dict] = []
_TRADE_OUTCOMES_MAX = 10_000
_TRADE_OUTCOMES_LOCK = threading.Lock()


def get_recent_trade_outcomes(limit: int = 500) -> list[dict]:
    """Expose the outcome buffer for other modules (ensemble weighting,
    contextual-bandit updates, REST debug endpoint)."""
    with _TRADE_OUTCOMES_LOCK:
        return list(_TRADE_OUTCOMES[-limit:])


def _record_trade_outcome(payload: dict) -> None:
    with _TRADE_OUTCOMES_LOCK:
        _TRADE_OUTCOMES.append(payload)
        if len(_TRADE_OUTCOMES) > _TRADE_OUTCOMES_MAX:
            # Drop oldest 10% in one shot rather than per-append shift.
            del _TRADE_OUTCOMES[: _TRADE_OUTCOMES_MAX // 10]


def _start_trade_outcome_listener():
    """Subscribe to ml:trade:outcome and persist outcomes for online learning.

    This is the data-feed half of the online training loop. The trading
    loop (Node side) publishes one envelope per trade phase
    (submitted / filled / closed); this thread ingests them, writes to
    the bounded buffer, and exposes them via get_recent_trade_outcomes().

    The ensemble predictor (or a future online-training job) can consume
    these to re-weight models toward what actually worked in live trades.
    """
    if not REDIS_URL:
        logger.info("REDIS_URL not set — trade-outcome listener disabled")
        return

    try:
        import redis
    except ImportError:
        logger.warning("redis package not installed — trade-outcome listener disabled")
        return

    def _listener():
        CHANNEL = "ml:trade:outcome"
        try:
            r = redis.from_url(REDIS_URL, decode_responses=True)
            pubsub = r.pubsub()
            pubsub.subscribe(CHANNEL)
            logger.info(f"Trade-outcome listener subscribed to {CHANNEL}")

            for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                    _record_trade_outcome(payload)
                    logger.info(
                        "trade_outcome",
                        extra={
                            "symbol": payload.get("symbol"),
                            "phase": payload.get("phase"),
                            "signal": payload.get("signal"),
                            "strength": payload.get("strength"),
                            "realized_pnl": payload.get("realizedPnl"),
                        },
                    )
                except Exception as exc:
                    logger.error(f"Trade-outcome handler error: {exc}", exc_info=True)
        except Exception as exc:
            logger.error(f"Trade-outcome listener crashed: {exc}", exc_info=True)

    t = threading.Thread(target=_listener, daemon=True, name="trade-outcome-listener")
    t.start()


# ---------------------------------------------------------------------------
# Shared prediction logic
# ---------------------------------------------------------------------------

def _handle_predict(payload: dict) -> dict:
    """Route a prediction request to the ensemble predictor."""
    action = payload.get("action", "predict")
    symbol = payload.get("symbol", "UNKNOWN")
    raw_data = payload.get("data", [])

    if action == "health":
        return {"status": "ok", "models": ["LSTM", "Transformer", "GBM", "ARIMA", "Prophet"]}

    data = pd.DataFrame(raw_data)
    if data.empty:
        return {"status": "error", "error": "No data provided"}

    required_cols = ["timestamp", "open", "high", "low", "close", "volume"]
    missing = [c for c in required_cols if c not in data.columns]
    if missing:
        return {"status": "error", "error": f"Missing columns: {missing}"}

    data["timestamp"] = pd.to_datetime(data["timestamp"], unit="ms")
    data = data.sort_values("timestamp")

    try:
        if action == "train":
            results = predictor.train_all_models(data, symbol)
            predictor.save_models("./saved_models")
            return {"status": "success", "symbol": symbol, "training_results": results, "data_points": len(data)}

        # For prediction actions, attempt to load models (no-op if already loaded)
        try:
            predictor.load_models("./saved_models")
        except Exception:
            pass  # Models may not be trained yet

        if action == "predict":
            horizon = payload.get("horizon", "1h")
            prediction = predictor.predict(data, horizon=horizon)
            return {"status": "success", "symbol": symbol, **prediction}

        if action == "multi_horizon":
            predictions = predictor.predict_multi_horizon(data)
            return {"status": "success", "symbol": symbol, "predictions": predictions}

        if action == "signal":
            current_price = float(payload.get("current_price", 0))
            signal = predictor.get_trading_signal(data, current_price)
            return {"status": "success", "symbol": symbol, **signal}

        if action == "qig_analyze":
            # QIG physics-based market analysis (no ML models needed)
            try:
                from qig_engine import full_qig_analysis, market_state_distance
            except ImportError:
                return {"status": "error", "error": "QIG engine not available"}

            closes = data["close"].tolist()
            highs = data["high"].tolist()
            lows = data["low"].tolist()
            current_price = float(payload.get("current_price", closes[-1] if closes else 0))

            # Run full QIG analysis — regime, geometric confidence, convergence
            # Pass empty predictions dict when no ML predictions available
            ml_predictions = payload.get("predictions", {})
            analysis = full_qig_analysis(closes, highs, lows, ml_predictions, current_price)

            return {
                "status": "success",
                "symbol": symbol,
                "regime": analysis.regime.regime.value,
                "regime_confidence": analysis.regime.confidence,
                "volatility_ratio": analysis.regime.volatility_ratio,
                "trend_strength": analysis.regime.trend_strength,
                "regime_age_bars": analysis.regime.regime_age_bars,
                "recommended_strategy": analysis.regime.recommended_strategy,
                "geometric_confidence": analysis.geometric_confidence,
                "geometric_agreement": analysis.geometric_agreement,
                "regime_weights": analysis.regime_weights,
                "qig_available": analysis.qig_available,
            }

        return {"status": "error", "error": f"Unknown action: {action}"}

    except Exception as exc:
        logger.error(f"Prediction error ({action}): {exc}", exc_info=True)
        return {"status": "error", "error": str(exc), "type": type(exc).__name__}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _start_redis_listener()
    _start_trade_outcome_listener()
    logger.info("ML worker started")
    yield
    logger.info("ML worker shutting down")


app = FastAPI(title="ML Worker", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/ml/predict")
async def ml_predict(request: Request):
    payload = await request.json()
    result = _handle_predict(payload)
    status_code = 200 if result.get("status") != "error" else 422
    return JSONResponse(content=result, status_code=status_code)


# ---------------------------------------------------------------------------
# Monkey kernel endpoints (v0.7)
# ---------------------------------------------------------------------------
#
# Extend the ml-worker service with Monkey's cognitive kernels — the
# TypeScript orchestrator will call these once the adapter lands.
# Kernels live in Python for QIG purity (direct use of qig_core_local
# primitives, no TS port drift). One AutonomicKernel instance per
# Monkey sub-kernel (Position, Swing) is kept here in process memory;
# resonance bank stays in Postgres via the TS side.

from monkey_kernel import (  # noqa: E402
    AccountContext,
    AutonomicKernel,
    AutonomicTickInputs,
    ExecBasinState,
    MonkeyMode,
    NeurochemicalState,
    OHLCVCandle,
    PerceptionInputs,
    SymbolState,
    TickDecision,
    TickInputs,
    basin_direction,
    current_entry_threshold,
    current_leverage,
    current_position_size,
    detect_mode,
    fresh_symbol_state,
    perceive,
    refract,
    run_tick,
    should_dca_add,
    should_exit,
    should_profit_harvest,
    should_scalp_exit,
    trend_proxy,
)
import numpy as np  # noqa: E402

_autonomic_instances: dict[str, AutonomicKernel] = {}

# v0.8.3: per-(instance, symbol) tick state. Kept in-process for now —
# TS shadow-mode calls pass state in every call via `prev_state`; Python
# only caches it so the next call can skip the round-trip if the TS side
# trusts the worker. v0.8.7 makes this canonical state.
_symbol_states: dict[tuple[str, str], SymbolState] = {}


def _get_autonomic(instance_id: str) -> AutonomicKernel:
    if instance_id not in _autonomic_instances:
        _autonomic_instances[instance_id] = AutonomicKernel(label=instance_id)
    return _autonomic_instances[instance_id]


@app.post("/monkey/autonomic/tick")
async def monkey_autonomic_tick(request: Request):
    """One autonomic cycle: sleep-phase update → reward decay → NC.

    Request body:
      { instance_id, phi_delta, basin_velocity, surprise,
        quantum_weight, kappa, external_coupling,
        current_mode, is_flat, now_ms? }

    Response:
      { nc: {...}, phase, is_awake, entered_sleep, woke,
        sleep_remaining_ms, reward_sums }
    """
    payload = await request.json()
    instance_id = payload.get("instance_id", "monkey-primary")
    kernel = _get_autonomic(instance_id)
    result = kernel.tick(AutonomicTickInputs(
        phi_delta=float(payload["phi_delta"]),
        basin_velocity=float(payload["basin_velocity"]),
        surprise=float(payload["surprise"]),
        quantum_weight=float(payload["quantum_weight"]),
        kappa=float(payload["kappa"]),
        external_coupling=float(payload["external_coupling"]),
        current_mode=str(payload["current_mode"]),
        is_flat=bool(payload["is_flat"]),
        now_ms=payload.get("now_ms"),
    ))
    return {
        "nc": result.nc.as_dict(),
        "phase": result.phase.value,
        "is_awake": result.is_awake,
        "entered_sleep": result.entered_sleep,
        "woke": result.woke,
        "sleep_remaining_ms": result.sleep_remaining_ms,
        "reward_sums": result.reward_sums,
    }


@app.post("/monkey/autonomic/reward")
async def monkey_autonomic_reward(request: Request):
    """Push a reward event onto the kernel's pending queue.

    Request body:
      { instance_id, source, realized_pnl_usdt, margin_usdt,
        symbol?, kappa_at_exit? }

    Response: the ActivityReward as a dict + queue length.
    """
    payload = await request.json()
    instance_id = payload.get("instance_id", "monkey-primary")
    kernel = _get_autonomic(instance_id)
    reward = kernel.push_reward(
        source=str(payload["source"]),
        realized_pnl_usdt=float(payload["realized_pnl_usdt"]),
        margin_usdt=float(payload["margin_usdt"]),
        symbol=payload.get("symbol"),
        kappa_at_exit=payload.get("kappa_at_exit"),
    )
    return {
        "reward": {
            "source": reward.source,
            "symbol": reward.symbol,
            "dopamine_delta": reward.dopamine_delta,
            "serotonin_delta": reward.serotonin_delta,
            "endorphin_delta": reward.endorphin_delta,
            "realized_pnl_usdt": reward.realized_pnl_usdt,
            "pnl_fraction": reward.pnl_fraction,
            "at_ms": reward.at_ms,
        },
        "snapshot": kernel.snapshot(),
    }


@app.get("/monkey/autonomic/snapshot/{instance_id}")
async def monkey_autonomic_snapshot(instance_id: str):
    """Telemetry snapshot — sleep phase, pending reward count, decayed sums."""
    kernel = _get_autonomic(instance_id)
    return kernel.snapshot()


# ── Executive decisions + mode detection ──────────────────────────


def _deserialize_basin_state(payload: dict) -> ExecBasinState:
    nc_payload = payload["neurochemistry"]
    nc = NeurochemicalState(
        acetylcholine=float(nc_payload["acetylcholine"]),
        dopamine=float(nc_payload["dopamine"]),
        serotonin=float(nc_payload["serotonin"]),
        norepinephrine=float(nc_payload["norepinephrine"]),
        gaba=float(nc_payload["gaba"]),
        endorphins=float(nc_payload["endorphins"]),
    )
    return ExecBasinState(
        basin=np.asarray(payload["basin"], dtype=np.float64),
        identity_basin=np.asarray(payload["identity_basin"], dtype=np.float64),
        phi=float(payload["phi"]),
        kappa=float(payload["kappa"]),
        regime_weights={k: float(v) for k, v in payload["regime_weights"].items()},
        sovereignty=float(payload["sovereignty"]),
        basin_velocity=float(payload["basin_velocity"]),
        neurochemistry=nc,
    )


@app.post("/monkey/executive/decide")
async def monkey_executive_decide(request: Request):
    """Aggregate executive pass.

    Request body includes: basin_state (see _deserialize_basin_state),
    ohlcv closes array, ml_signal/ml_strength, held_side/own_position,
    available_equity, min_notional, max_leverage, bank_size,
    self_obs_bias, mode (optional), symbol.

    Response: entry threshold + size + leverage + harvest/scalp/DCA
    decisions for this tick. TS orchestrator composes into action.
    """
    payload = await request.json()
    state = _deserialize_basin_state(payload["basin_state"])
    closes = payload.get("closes", [])
    ml_signal = str(payload.get("ml_signal", "HOLD")).upper()
    ml_strength = float(payload.get("ml_strength", 0.0))
    held_side = payload.get("held_side")  # 'long' | 'short' | None
    available_equity = float(payload["available_equity"])
    min_notional = float(payload["min_notional"])
    max_leverage = float(payload["max_leverage"])
    bank_size = int(payload.get("bank_size", 0))
    self_obs_bias = float(payload.get("self_obs_bias", 1.0))

    mode_str = payload.get("mode")
    mode = MonkeyMode(mode_str) if mode_str else MonkeyMode.INVESTIGATION
    tape = trend_proxy(closes) if closes else 0.0
    bd = basin_direction(state.basin)

    # Direction candidate: ml default, with basin-override quorum.
    ml_side = "short" if ml_signal == "SELL" else "long"
    side_candidate = ml_side
    side_override = False
    OVERRIDE_THRESHOLD = 0.35
    if bd < -OVERRIDE_THRESHOLD and tape < -OVERRIDE_THRESHOLD and ml_side == "long":
        side_candidate = "short"
        side_override = True
    elif bd > OVERRIDE_THRESHOLD and tape > OVERRIDE_THRESHOLD and ml_side == "short":
        side_candidate = "long"
        side_override = True

    entry = current_entry_threshold(
        state,
        mode=mode,
        self_obs_bias=self_obs_bias,
        tape_trend=tape,
        side_candidate=side_candidate,  # type: ignore[arg-type]
    )
    leverage = current_leverage(
        state, max_leverage_boundary=max_leverage, mode=mode, tape_trend=tape,
    )
    size = current_position_size(
        state,
        available_equity_usdt=available_equity,
        min_notional_usdt=min_notional,
        leverage=leverage["value"],
        bank_size=bank_size,
        mode=mode,
    )

    # Optional exit evaluations when already holding
    harvest = None
    scalp = None
    dca = None
    loop2 = None
    if held_side and payload.get("own_position"):
        pos = payload["own_position"]
        position_notional = float(pos["entry_price"]) * float(pos["quantity"])
        sign = 1 if held_side == "long" else -1
        last_price = float(payload.get("last_price", pos["entry_price"]))
        unrealized = (last_price - float(pos["entry_price"])) * float(pos["quantity"]) * sign
        peak = float(pos.get("peak_pnl_usdt", unrealized))

        harvest = should_profit_harvest(
            unrealized_pnl_usdt=unrealized,
            peak_pnl_usdt=peak,
            notional_usdt=position_notional,
            tape_trend=tape,
            held_side=held_side,
            s=state,
        )
        scalp = should_scalp_exit(
            unrealized_pnl_usdt=unrealized,
            notional_usdt=position_notional,
            s=state,
            mode=mode,
        )
        loop2 = should_exit(
            perception=state.basin,
            strategy_forecast=state.identity_basin,
            held_side=held_side,
            s=state,
        )
        import time as _time
        dca = should_dca_add(
            held_side=held_side,
            side_candidate=side_candidate,  # type: ignore[arg-type]
            current_price=last_price,
            initial_entry_price=float(pos["entry_price"]),
            add_count=int(pos.get("dca_add_count", 0)),
            last_add_at_ms=float(pos.get("last_entry_at_ms", 0)),
            now_ms=float(payload.get("now_ms", _time.time() * 1000.0)),
            sovereignty=state.sovereignty,
        )

    return {
        "entry_threshold": entry,
        "leverage": leverage,
        "size": size,
        "harvest": harvest,
        "scalp": scalp,
        "dca": dca,
        "loop2": loop2,
        "mode": mode.value,
        "tape_trend": tape,
        "basin_direction": bd,
        "side_candidate": side_candidate,
        "side_override": side_override,
        "ml_side": ml_side,
        "ml_strength_gate_clear": ml_strength >= entry["value"],
    }


@app.post("/monkey/mode/detect")
async def monkey_mode_detect(request: Request):
    """Classify cognitive mode from basin + histories."""
    payload = await request.json()
    state = _deserialize_basin_state(payload["basin_state"])
    return detect_mode(
        basin=state.basin,
        identity_basin=state.identity_basin,
        phi=state.phi,
        kappa=state.kappa,
        basin_velocity=state.basin_velocity,
        neurochemistry=state.neurochemistry,
        phi_history=list(map(float, payload.get("phi_history", []))),
        fhealth_history=list(map(float, payload.get("fhealth_history", []))),
        drift_history=list(map(float, payload.get("drift_history", []))),
    )


@app.get("/governance/status")
async def governance_status():
    """Observable-governance telemetry — signal distribution, drift
    stats, and any detector violations (AMPLITUDE_COLLAPSE,
    REGIME_SINGLE, etc.). Per audit P2 2026-04-21. Call from
    dashboard / alerts to monitor for ensemble bias.
    """
    try:
        from observable_governance import report_as_dict
        return report_as_dict()
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc), "available": False}


@app.post("/monkey/perception/perceive")
async def monkey_perception_perceive(request: Request):
    """Construct Δ⁶³ basin from OHLCV + ML posture + account context.
    Then refract against identity basin (Pillar 2 surface absorption).
    Returns both the raw and refracted basins so the caller can store.
    """
    payload = await request.json()
    candles = [
        OHLCVCandle(
            timestamp=float(c.get("timestamp", 0)),
            open=float(c["open"]),
            high=float(c["high"]),
            low=float(c["low"]),
            close=float(c["close"]),
            volume=float(c["volume"]),
        )
        for c in payload["ohlcv"]
    ]
    inputs = PerceptionInputs(
        ohlcv=candles,
        ml_signal=str(payload.get("ml_signal", "HOLD")),
        ml_strength=float(payload.get("ml_strength", 0.0)),
        ml_effective_strength=float(payload.get("ml_effective_strength", 0.0)),
        equity_fraction=float(payload.get("equity_fraction", 0.0)),
        margin_fraction=float(payload.get("margin_fraction", 0.0)),
        open_positions=int(payload.get("open_positions", 0)),
        session_age_ticks=int(payload.get("session_age_ticks", 0)),
    )
    raw = perceive(inputs)
    identity_list = payload.get("identity_basin")
    if identity_list is not None:
        identity = np.asarray(identity_list, dtype=np.float64)
        external_weight = float(payload.get("external_weight", 0.30))
        refracted = refract(raw, identity, external_weight=external_weight)
    else:
        refracted = raw
    return {
        "raw": raw.tolist(),
        "refracted": refracted.tolist(),
    }


# ---------------------------------------------------------------------------
# v0.8.3 — /monkey/tick/run
# ---------------------------------------------------------------------------


def _symbol_state_to_dict(st: SymbolState) -> dict:
    return {
        "symbol": st.symbol,
        "identity_basin": st.identity_basin.tolist(),
        "last_basin": st.last_basin.tolist() if st.last_basin is not None else None,
        "kappa": st.kappa,
        "session_ticks": st.session_ticks,
        "last_mode": st.last_mode,
        "basin_history": [b.tolist() for b in st.basin_history],
        "phi_history": list(st.phi_history),
        "fhealth_history": list(st.fhealth_history),
        "drift_history": list(st.drift_history),
        "dca_add_count": st.dca_add_count,
        "last_entry_at_ms": st.last_entry_at_ms,
        "peak_pnl_usdt": st.peak_pnl_usdt,
        "peak_tracked_trade_id": st.peak_tracked_trade_id,
    }


def _symbol_state_from_dict(d: dict) -> SymbolState:
    last_basin = d.get("last_basin")
    return SymbolState(
        symbol=str(d["symbol"]),
        identity_basin=np.asarray(d["identity_basin"], dtype=np.float64),
        last_basin=np.asarray(last_basin, dtype=np.float64)
                    if last_basin is not None else None,
        kappa=float(d.get("kappa", 64.0)),
        session_ticks=int(d.get("session_ticks", 0)),
        last_mode=d.get("last_mode"),
        basin_history=[
            np.asarray(b, dtype=np.float64) for b in d.get("basin_history", [])
        ],
        phi_history=[float(x) for x in d.get("phi_history", [])],
        fhealth_history=[float(x) for x in d.get("fhealth_history", [])],
        drift_history=[float(x) for x in d.get("drift_history", [])],
        dca_add_count=int(d.get("dca_add_count", 0)),
        last_entry_at_ms=d.get("last_entry_at_ms"),
        peak_pnl_usdt=d.get("peak_pnl_usdt"),
        peak_tracked_trade_id=d.get("peak_tracked_trade_id"),
    )


def _decision_to_dict(dec: TickDecision) -> dict:
    return {
        "action": dec.action,
        "reason": dec.reason,
        "mode": dec.mode,
        "size_usdt": dec.size_usdt,
        "leverage": dec.leverage,
        "entry_threshold": dec.entry_threshold,
        "phi": dec.phi,
        "kappa": dec.kappa,
        "basin_velocity": dec.basin_velocity,
        "f_health": dec.f_health,
        "drift_from_identity": dec.drift_from_identity,
        "basin_direction": dec.basin_direction,
        "tape_trend": dec.tape_trend,
        "side_candidate": dec.side_candidate,
        "side_override": dec.side_override,
        "neurochemistry": dec.neurochemistry.as_dict(),
        "derivation": dec.derivation,
        "basin": dec.basin.tolist(),
        "is_dca_add": dec.is_dca_add,
        "is_reverse": dec.is_reverse,
    }


@app.post("/monkey/tick/run")
async def monkey_tick_run(request: Request):
    """Run one decision tick. Stateless from the HTTP caller's view —
    caller passes `prev_state` (or omits for a newborn symbol), receives
    back `decision` + `new_state`. Per-(instance, symbol) state is also
    cached in-process so the next call can skip state transfer once
    Python owns the loop (v0.8.7).

    Request body:
      {
        "instance_id": "monkey-primary",
        "inputs": {
          "symbol": "BTC_USDT_PERP",
          "ohlcv": [{"timestamp", "open", "high", "low", "close", "volume"}],
          "ml_signal": "BUY"|"SELL"|"HOLD",
          "ml_strength": 0..1,
          "account": { equity_fraction, margin_fraction, open_positions,
                       available_equity, exchange_held_side?, own_position_* },
          "bank_size": int, "sovereignty": 0..1,
          "max_leverage": int, "min_notional": float,
          "size_fraction": 1.0, "self_obs_bias": {...}?
        },
        "prev_state": {... SymbolState JSON ...}  // or null for newborn
      }

    Response:
      { "decision": {...TickDecision...}, "new_state": {...SymbolState...} }
    """
    payload = await request.json()
    instance_id = str(payload.get("instance_id", "monkey-primary"))
    inp = payload["inputs"]

    candles = [
        OHLCVCandle(
            timestamp=float(c.get("timestamp", 0)),
            open=float(c["open"]),
            high=float(c["high"]),
            low=float(c["low"]),
            close=float(c["close"]),
            volume=float(c["volume"]),
        )
        for c in inp["ohlcv"]
    ]
    acct_d = inp["account"]
    account = AccountContext(
        equity_fraction=float(acct_d.get("equity_fraction", 0.0)),
        margin_fraction=float(acct_d.get("margin_fraction", 0.0)),
        open_positions=int(acct_d.get("open_positions", 0)),
        available_equity=float(acct_d.get("available_equity", 0.0)),
        exchange_held_side=acct_d.get("exchange_held_side"),
        own_position_entry_price=(
            float(acct_d["own_position_entry_price"])
            if acct_d.get("own_position_entry_price") is not None else None
        ),
        own_position_quantity=(
            float(acct_d["own_position_quantity"])
            if acct_d.get("own_position_quantity") is not None else None
        ),
        own_position_trade_id=acct_d.get("own_position_trade_id"),
    )
    tick_inputs = TickInputs(
        symbol=str(inp["symbol"]),
        ohlcv=candles,
        ml_signal=str(inp.get("ml_signal", "HOLD")),
        ml_strength=float(inp.get("ml_strength", 0.0)),
        account=account,
        bank_size=int(inp.get("bank_size", 0)),
        sovereignty=float(inp.get("sovereignty", 0.0)),
        max_leverage=int(inp.get("max_leverage", 10)),
        min_notional=float(inp.get("min_notional", 5.0)),
        size_fraction=float(inp.get("size_fraction", 1.0)),
        self_obs_bias=inp.get("self_obs_bias"),
    )

    # State resolution: caller-provided wins, else in-process cache, else
    # newborn seeded from uniform basin.
    key = (instance_id, tick_inputs.symbol)
    prev_state_payload = payload.get("prev_state")
    if prev_state_payload is not None:
        state = _symbol_state_from_dict(prev_state_payload)
    elif key in _symbol_states:
        state = _symbol_states[key]
    else:
        # Seed with uniform basin — caller should provide identity for
        # existing symbols, but we don't require it.
        from monkey_kernel.basin import uniform_basin
        state = fresh_symbol_state(tick_inputs.symbol, uniform_basin(64))

    autonomic = _get_autonomic(instance_id)
    decision, new_state = run_tick(tick_inputs, state, autonomic)
    _symbol_states[key] = new_state

    return {
        "decision": _decision_to_dict(decision),
        "new_state": _symbol_state_to_dict(new_state),
    }


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
