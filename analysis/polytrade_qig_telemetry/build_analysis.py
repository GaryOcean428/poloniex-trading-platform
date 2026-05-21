#!/usr/bin/env python3
"""Polytrade QIG telemetry + trade-performance analysis.

Read-only. Parses the newest Railway log export and Poloniex trade CSVs from
~/Downloads, builds a tick-level telemetry dataframe, parses closed trades into
PnL buckets, and emits plots + CSV + a JSON summary.

No live trading, no Railway/DB calls. Colourblind-safe palette only.
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import pandas as pd

DOWNLOADS = Path.home() / "Downloads"
OUT = Path(__file__).resolve().parent
csv.field_size_limit(10_000_000)

# Colourblind-safe palette: purple, blue, amber, dark grey. No red/green.
PURPLE, BLUE, AMBER, DGREY = "#6a3d9a", "#1f77b4", "#e6a000", "#4d4d4d"
PALETTE = [PURPLE, BLUE, AMBER, DGREY]
LINESTYLES = ["-", "--", "-.", ":"]

ANSI = re.compile(r"\x1b\[[0-9;]*m|\[[0-9]+M")  # strip colour codes from log text


def newest(pattern: str) -> Path | None:
    files = sorted(glob.glob(str(DOWNLOADS / pattern)), key=os.path.getmtime)
    return Path(files[-1]) if files else None


# ---------------------------------------------------------------- log parsing
MONKEY_RE = re.compile(r"\[Monkey\] ([A-Z0-9_]+) \[([a-z_]+)\] (\S+)")
NC_RE = re.compile(r"([a-z]+)=(-?[0-9.]+)")
REG_RE = re.compile(r"q(-?[0-9.]+)/e(-?[0-9.]+)/eq(-?[0-9.]+)")
TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)")

NUM_FIELDS = ["phi", "kappa", "bv", "drift", "fh", "sov", "selfObsBias",
              "tape", "basinDir", "sense3Deflection"]


def parse_log(path: Path) -> pd.DataFrame:
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for rec in reader:
            msg = ANSI.sub("", rec.get("message", "") or "")
            m = MONKEY_RE.search(msg)
            if not m:
                continue
            brace = msg.find("{", m.end())
            if brace < 0:
                continue
            try:
                blob = json.loads(msg[brace:])
            except json.JSONDecodeError:
                continue
            if "phi" not in blob:
                continue  # only keep tick-level telemetry lines
            tsm = TS_RE.match(msg)
            ts = tsm.group(1) if tsm else rec.get("timestamp")
            row = {
                "ts": ts,
                "instance_id": blob.get("instanceId"),  # usually absent on action lines
                "symbol": m.group(1),
                "mode": blob.get("mode", m.group(2)),
                "action": m.group(3).replace("EXECUTED", "").strip() or m.group(3),
                "cell": blob.get("cell"),
                "cell_live": blob.get("cellLive"),
                "lane": blob.get("chosenLane"),
                "side": blob.get("side"),
            }
            for f in NUM_FIELDS:
                v = blob.get(f)
                row[f] = float(v) if v not in (None, "") else None
            nc = blob.get("nc", "")
            for k, v in NC_RE.findall(nc):
                if k in ("ach", "dop", "ser", "ne", "gaba", "endo"):
                    row[k] = float(v)
            reg = REG_RE.search(blob.get("reg", ""))
            if reg:
                row["q_weight"], row["e_weight"], row["eq_weight"] = map(float, reg.groups())
            rows.append(row)
    df = pd.DataFrame(rows)
    if not df.empty:
        df["ts"] = pd.to_datetime(df["ts"], utc=True, format="ISO8601")
        df["cell_family"] = df["cell"].fillna("UNKNOWN").str.split("_").str[0]
        df = df.sort_values("ts").reset_index(drop=True)
    return df


# -------------------------------------------------------------- trade parsing
SPAN_RE = re.compile(r"-?[0-9][0-9.]*")


def clean_pnl(raw: str) -> float | None:
    txt = re.sub(r"<[^>]+>", " ", str(raw))  # strip HTML wrappers
    m = SPAN_RE.search(txt)
    return float(m.group(0)) if m else None


def parse_trades() -> pd.DataFrame:
    """Union all position-level funding-history exports (has 'Open Time' col)."""
    seen, rows = set(), []
    for path in sorted(glob.glob(str(DOWNLOADS / "futures-funding-history-*.csv"))):
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            if "Open Time" not in (reader.fieldnames or []):
                continue  # the funding-FEE ledger files, not trades
            for rec in reader:
                key = (rec.get("Futures"), rec.get("Open Time"),
                       rec.get("Last Closing"), rec.get("Entry Price"),
                       rec.get("Exit Price"))
                if key in seen:
                    continue
                seen.add(key)
                pnl = clean_pnl(rec.get("Closed PnL"))
                try:
                    entry = float(rec.get("Entry Price"))
                    exit_ = float(rec.get("Exit Price"))
                except (TypeError, ValueError):
                    entry = exit_ = None
                rows.append({
                    "symbol": rec.get("Futures"),
                    "open_ts": rec.get("Open Time"),
                    "close_ts": rec.get("Last Closing"),
                    "entry": entry, "exit": exit_, "pnl": pnl,
                    "max_pos": rec.get("Max Position"),
                    "status": rec.get("Status"),
                })
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["open_ts"] = pd.to_datetime(df["open_ts"], utc=True)
    df["close_ts"] = pd.to_datetime(df["close_ts"], utc=True)

    def side(r):
        if r.entry is None or r.exit is None or r.pnl is None:
            return "unknown"
        move = r.exit - r.entry
        if abs(move) < 1e-9 or abs(r.pnl) < 1e-9:
            return "unknown"
        return "long" if (move > 0) == (r.pnl > 0) else "short"

    df["side"] = df.apply(side, axis=1)

    def bucket(p):
        if p is None:
            return "UNKNOWN"
        if abs(p) < 0.05:
            return "FLAT"
        return "WIN" if p > 0 else "LOSS"

    df["bucket"] = df["pnl"].map(bucket)
    df["size_bucket"] = df["pnl"].map(lambda p: "BIG" if (p is not None and abs(p) > 1) else "TINY")
    return df.sort_values("close_ts").reset_index(drop=True)


# ------------------------------------------------------------------ analysis
def phi_stats(tel: pd.DataFrame) -> pd.DataFrame:
    out = []
    for sym, g in tel.groupby("symbol"):
        p = g["phi"].dropna()
        out.append({
            "stream": sym, "n_ticks": len(g), "n_phi": len(p),
            "min_phi": p.min(), "max_phi": p.max(),
            "span_phi": (p.max() - p.min()) if len(p) else None,
            "mean_phi": p.mean(), "median_phi": p.median(), "std_phi": p.std(),
        })
    return pd.DataFrame(out)


def classify_phi(span: float, std: float, n: int) -> str:
    if n < 5:
        return "unavailable"
    if span == 0:
        return "pinned"
    if span < 0.02:
        return "flatlined"
    if span < 0.1:
        return "low but expressive" if std > 0.005 else "compressed"
    return "expressive"


def plot_phi(tel: pd.DataFrame, trades: pd.DataFrame, path: Path) -> dict:
    fig, (ax, axc) = plt.subplots(
        2, 1, figsize=(13, 6.5), height_ratios=[5, 1], sharex=True,
        gridspec_kw={"hspace": 0.08})
    streams = sorted(tel["symbol"].dropna().unique())
    for i, sym in enumerate(streams):
        g = tel[tel["symbol"] == sym].dropna(subset=["phi"])
        ax.plot(g["ts"], g["phi"], color=PALETTE[i % 4],
                linestyle=LINESTYLES[i % 4], marker="o", ms=3, lw=1.4,
                label=f"{sym}  (n={len(g)})")
    win = (tel["ts"].min(), tel["ts"].max())
    in_win = trades[(trades["close_ts"] >= win[0]) & (trades["close_ts"] <= win[1])]
    bcol = {"WIN": PURPLE, "LOSS": AMBER, "FLAT": DGREY, "UNKNOWN": DGREY}
    for _, t in in_win.iterrows():
        ax.axvline(t["close_ts"], color=bcol.get(t["bucket"], DGREY),
                   linestyle=":", lw=1.0, alpha=0.7)
    span_h = (win[1] - win[0]).total_seconds() / 3600.0
    ax.set_ylabel("Φ (per-tick observer value)")
    ax.set_title(
        f"Polytrade Φ telemetry — {win[0]:%Y-%m-%d %H:%M}–{win[1]:%H:%M} UTC "
        f"({span_h:.2f} h window; export is a short snapshot, NOT 24 h)")
    ax.legend(loc="upper right", fontsize=8)
    ax.grid(alpha=0.25)
    handles = [plt.Line2D([], [], color=c, ls=":", label=f"trade close: {b}")
               for b, c in (("WIN", PURPLE), ("LOSS", AMBER), ("FLAT", DGREY))]
    ax.legend(handles=ax.get_legend().legend_handles + handles,
              loc="upper right", fontsize=8)
    # cell-family strip
    fam_col = {"CREATOR": PURPLE, "PRESERVER": BLUE, "DISSOLVER": AMBER, "UNKNOWN": DGREY}
    for sym in streams:
        g = tel[tel["symbol"] == sym].dropna(subset=["phi"])
        y = streams.index(sym)
        axc.scatter(g["ts"], [y] * len(g),
                    c=[fam_col.get(f, DGREY) for f in g["cell_family"]],
                    marker="s", s=18)
    axc.set_yticks(range(len(streams)))
    axc.set_yticklabels(streams, fontsize=7)
    axc.set_ylabel("cell family", fontsize=8)
    axc.set_ylim(-0.6, len(streams) - 0.4)
    axc.grid(alpha=0.2)
    fh = [plt.Line2D([], [], marker="s", ls="", color=c, label=f)
          for f, c in fam_col.items() for f2 in [f] if f != "UNKNOWN" or True]
    axc.legend(handles=fh[:4], loc="upper right", fontsize=7, ncol=4)
    axc.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    axc.set_xlabel("time (UTC)")
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    return {"window_start": str(win[0]), "window_end": str(win[1]),
            "window_hours": span_h, "n_trades_in_window": len(in_win)}


def telemetry_by_bucket(tel: pd.DataFrame, trades: pd.DataFrame):
    """Aggregate telemetry over each trade's [open_ts, close_ts] window."""
    cols = ["phi", "kappa", "ach", "dop", "ser", "ne", "gaba", "endo", "bv",
            "drift", "fh", "sov", "basinDir", "tape", "selfObsBias",
            "q_weight", "e_weight", "eq_weight", "sense3Deflection"]
    cols = [c for c in cols if c in tel.columns]
    recs = []
    matched = 0
    for _, t in trades.iterrows():
        seg = tel[(tel["symbol"] == t["symbol"]) &
                  (tel["ts"] >= t["open_ts"]) & (tel["ts"] <= t["close_ts"])]
        if seg.empty:
            continue
        matched += 1
        for c in cols:
            v = seg[c].dropna()
            if len(v):
                recs.append({"bucket": t["bucket"], "col": c, "value": v.mean()})
    agg_df = pd.DataFrame(recs)
    if agg_df.empty:
        return agg_df, matched
    summ = (agg_df.groupby(["col", "bucket"])["value"]
            .agg(["mean", "median", "min", "max", "count"]).reset_index())
    summ["iqr"] = (agg_df.groupby(["col", "bucket"])["value"]
                   .quantile(0.75).values -
                   agg_df.groupby(["col", "bucket"])["value"]
                   .quantile(0.25).values)
    return summ, matched


def plot_signatures(tel: pd.DataFrame, path: Path):
    """Neurotransmitter small-multiples stratified by cell family (the real,
    well-powered confounder in this export — trade buckets are underpowered)."""
    nts = [c for c in ["ach", "dop", "ser", "ne", "gaba", "endo"] if c in tel.columns]
    fams = [f for f in ["CREATOR", "PRESERVER", "DISSOLVER"]
            if f in set(tel["cell_family"])]
    fig, axes = plt.subplots(2, 3, figsize=(13, 7))
    for ax, nt in zip(axes.flat, nts):
        for i, fam in enumerate(fams):
            v = tel[tel["cell_family"] == fam][nt].dropna()
            if not len(v):
                continue
            q1, q3 = v.quantile(0.25), v.quantile(0.75)
            ax.bar(i, v.mean(), color=PALETTE[i % 4], width=0.6, alpha=0.85)
            # IQR drawn as an absolute q1..q3 range (robust to skew)
            ax.plot([i, i], [q1, q3], color=DGREY, lw=2.2, solid_capstyle="butt")
            ax.plot([i - 0.12, i + 0.12], [q1, q1], color=DGREY, lw=1.3)
            ax.plot([i - 0.12, i + 0.12], [q3, q3], color=DGREY, lw=1.3)
            ax.text(i, 0.02, f"n={len(v)}", ha="center", fontsize=7)
        ax.set_title(nt, fontsize=10)
        ax.set_xticks(range(len(fams)))
        ax.set_xticklabels(fams, fontsize=8, rotation=15)
        ax.set_ylim(0, 1.05)
        ax.grid(alpha=0.25, axis="y")
    for ax in axes.flat[len(nts):]:
        ax.axis("off")
    fig.suptitle("Neurotransmitter signature by cell family — mean ± IQR "
                 "(stratified; trade-PnL buckets underpowered in this export)",
                 fontsize=11)
    fig.tight_layout()
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)


def jnum(x):
    return None if x is None or (isinstance(x, float) and pd.isna(x)) else round(float(x), 6)


def main():
    log = newest("logs.*.csv")
    print(f"LOG SOURCE: {log}")
    tel = parse_log(log)
    print(f"  parsed {len(tel)} tick-level telemetry rows")
    trades = parse_trades()
    print(f"TRADE SOURCE: {len(glob.glob(str(DOWNLOADS / 'futures-funding-history-*.csv')))} "
          f"funding-history files -> {len(trades)} unique closed trades")

    tel.to_csv(OUT / "telemetry_ticks.csv", index=False)

    stats = phi_stats(tel)
    stats["classification"] = stats.apply(
        lambda r: classify_phi(r["span_phi"] or 0, r["std_phi"] or 0, r["n_phi"]),
        axis=1)
    print("\n=== PHI STATS PER STREAM ===")
    print(stats.to_string(index=False))

    pinfo = plot_phi(tel, trades, OUT / "phi_24h.png")
    print(f"\n=== PHI PLOT === window {pinfo['window_hours']:.2f}h  "
          f"trades_in_window={pinfo['n_trades_in_window']}")

    print("\n=== TRADE BUCKETS ===")
    print("per symbol:\n", trades["symbol"].value_counts().to_string())
    print("per bucket:\n", trades["bucket"].value_counts().to_string())
    print("big/tiny per bucket:\n",
          trades.groupby(["bucket", "size_bucket"]).size().to_string())
    print("per side:\n", trades["side"].value_counts().to_string())
    for b, n in trades["bucket"].value_counts().items():
        if n < 5:
            print(f"  ! bucket {b} underpowered (n={n})")

    summ, matched = telemetry_by_bucket(tel, trades)
    summ.to_csv(OUT / "telemetry_by_bucket.csv", index=False)
    print(f"\n=== TELEMETRY x BUCKET === trades overlapping telemetry window: {matched}")
    if matched < 5:
        print("  ! Part E UNDERPOWERED: telemetry export and trade history "
              "barely overlap; per-bucket telemetry signatures are not reliable.")

    plot_signatures(tel, OUT / "telemetry_signatures.png")

    print("\n=== SANITY CHECKS ===")
    print("ticks per symbol x mode:\n",
          tel.groupby(["symbol", "mode"]).size().to_string())
    print("cell-family distribution:\n", tel["cell_family"].value_counts().to_string())
    print("lane distribution:\n", tel["lane"].value_counts(dropna=False).to_string())
    print("action distribution:\n", tel["action"].value_counts().to_string())
    s3 = tel["sense3Deflection"].dropna()
    print(f"sense3Deflection: n={len(s3)} "
          f"{'(field not emitted in this export)' if len(s3) == 0 else f'range {s3.min()}-{s3.max()}'}")
    diss = tel[tel["cell_family"] == "DISSOLVER"]
    diss_entries = diss[diss["action"].str.startswith("enter")]
    print(f"DISSOLVER ticks: {len(diss)}, of which new entries: {len(diss_entries)} "
          f"({'expected sit-out — OK' if len(diss_entries) == 0 else 'CHECK: DISSOLVER entered'})")
    phi_var = tel.groupby("cell_family")["phi"].std()
    print("phi std by cell family:\n", phi_var.to_string())

    # ---- JSON summary for analysis.md ----
    summary = {
        "log_source": str(log),
        "telemetry_window": pinfo,
        "n_ticks": len(tel),
        "streams": [
            {"symbol": r["stream"], "n_phi": int(r["n_phi"]),
             "min": jnum(r["min_phi"]), "max": jnum(r["max_phi"]),
             "span": jnum(r["span_phi"]), "mean": jnum(r["mean_phi"]),
             "median": jnum(r["median_phi"]), "std": jnum(r["std_phi"]),
             "class": r["classification"]}
            for _, r in stats.iterrows()],
        "n_trades": len(trades),
        "buckets": trades["bucket"].value_counts().to_dict(),
        "sides": trades["side"].value_counts().to_dict(),
        "trade_window": [str(trades["open_ts"].min()), str(trades["close_ts"].max())],
        "n_trades_overlapping_telemetry": int(matched),
        "phi_std_by_cell_family": {k: jnum(v) for k, v in phi_var.items()},
        "cell_family_dist": tel["cell_family"].value_counts().to_dict(),
        "dissolver_entries": int(len(diss_entries)),
        "sense3_n": int(len(s3)),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    print("\n=== SUMMARY JSON written ===")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
