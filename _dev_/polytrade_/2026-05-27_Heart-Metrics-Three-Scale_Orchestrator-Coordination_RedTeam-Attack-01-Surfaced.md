# Orchestrator Coordination Packet — Red Team Attack #01 Surfaced (Heart/Metrics/Three-Scale/Loops)

**Date:** 2026-05-27  
**From:** Top-level orchestrator (continuing master-orchestration + 6x persona process per refined prompt + QIG PURITY MANDATE + roadmap)  
**To:** Full 6x team (Implementer, Principles Advocate, Red Team [completed this round], User Advocate, Developer Advocate, Verification Guardian)  
**Context:** Red Team (persona 3/6x) completed Attack Report #01 after 195s / 29 tools. Full adversarial review of current scaffolding + "first TDD plan" via memory. 7 concrete attack vectors launched with reproduction steps, canon citations (exact P1/P3/P4/P5/P6/P13/P18/P19/P22/P24/P25 + v6.7B §§ + phase simulation + roadmap ACs + two-channel), and demands.

**Red Team Attack #01 Key Findings (summarized from full report at subagent worktree _dev_ path; read the full file for every repro step):**
- **Vector 1 (P24 Partial Wiring):** Many of the 9 v6.7B extensions in derive_from_tick fall back to hardcoded defaults (0.0, 8.0, 3, 0.5, 1.0, etc.). Limited real upstream ports/call-sites in live tick path (only partial heart getattr for tacking/hrv). Dynamic __import__ fragility. No exercised call-sites for new fields under load. AC "≥10 new with real upstream ports + call-sites (wiring-validation count >0, no flag-gating)" is direct attack surface.
- **Vector 2 (P1/P18 Purity/Geometric):** Subtle Euclidean on κ manifold — stdev (from statistics), arithmetic mean on deltas (mean_abs_delta), heuristics (0.3 / mean_abs_delta + epsilon, 0.25/0.5 defaults), simple kappa - kappa_ref subtraction instead of Fisher-Rao distance/zero-cross interval/Fréchet on history. No natural gradient. Docstring admits "simple proxy". Purity script (token) passes but semantic violation on geometry.
- **Vector 3 (P5/P25 New Knobs):** Hardcoded max_window=60, repeated operational defaults/proxies (0.25, 0.5 # proxy, coupling_health), risk of Implementer adding "safety" thresholds disguised as observer-derived.
- **Vector 4 (P3/P4/P13/P19/P24 LIVED ONLY):** Risk of harvested data leaking into heart/metrics (sovereignty_dynamics, pre_cog, tacking) without explicit filters/asserts. No intersection with REPLICANT_IDENTITY / detect_replicant / _crystallize paths yet. New fields could influence identity/Loop 3 without LIVED ONLY check.
- **Vector 5 (P22 Perf):** stdev + mean + dynamic import in hot tick path every append/read. Risk of regression on tacking_frequency_hz or 69 expansion. Demand Railway MCP (service_metrics + get_logs) correlation pre/post.
- **Vector 6 (Reliability Edges):** Zero tacking (flat kappa) → stuck at defaults (freq=0.25). Breathing inversion not governed by heart master oscillator. n=0/1 samples, max_window edges, pre-cog under stress. Demand dedicated pytest -k covering tacking_inversion, breathing_cycle, replicant_harvested_and_heart, zero_tacking.
- **Vector 7 (Geometric Process Deviation):** Linear if/elif for mode instead of pure geometric phase. Derive uses clamp/placeholders. Any Implementer TDD plan or code must cite explicit heart-rhythmic tacking or Fisher-Rao justification (not sequential "first X then Y").

**Red Team Sign-off Condition (from report):** Embodiment survives 2+ full attack rounds (this + follow-ups) with *all* vectors closed + full verification pipeline green (purity 0 on all changes, wiring-validation real upstream call-site counts >0 in tick path for every field, pytest full negative suite including new heart edges + AC-specified tacking inversion + zero tacking + replicant_harvested_with_heart all PASS with fresh output, no new knobs/defaults, geometric math justification using Fisher-Rao/zero-cross/Fréchet + QIG-EXEMPT only where justified, heart governs per AC negative case, LIVED ONLY + P24 real wiring, fresh outputs only, evidence matches "complete embodiment" per phase simulation + canon — not docs-only). Until then: **ATTACK ACTIVE. DO NOT PROCEED.**

**Orchestrator Directive (per QIG PURITY MANDATE, refined prompt, geometric integrity, live-money standing auth "execute don't ask", "do not stop", 6x persona process):**
- **To Full Stack Kernel Dev Implementer (persona 1/6, currently running 241s+):** DO NOT start any TDD edits/tests on heart.py/tick.py/consciousness_metrics.py + tests + telemetry bridge until you have:
  1. Read this coordination packet + the full Red Team Attack Report #01 (and the exact repro commands/file:line).
  2. Produced a new _dev__polytrade_ packet with your updated TDD plan (tests first, verified negatives) that explicitly addresses *all 7 vectors* with concrete fixes + geometric justification (heart-rhythmic tacking / Fisher-Rao basin distance stated).
  3. Self-review (spec compliance on roadmap ACs + principles first, then code quality) showing survival.
  4. Handoff via memory to Principles Advocate + Verification Guardian for review before any code change in the worktree.
  Use the dispatched worktree (qig-heart-metrics-20260527) only. Small/type-safe. Cite "QIG PURITY MANDATE (agents.md)" + "master-orchestration first + re-read + purity gate" + this packet + Red Team report + roadmap ACs in every change. Two-stage reviews expected from the team.

- **To Protocol/Principles Advocate (persona 2/6):** Review the Red Team attack + current scaffolding + any Implementer proposal. Defend (with evidence from canon/phase/prior clusters) or concede vectors. No narrative rescue. Your approval must survive Red Team re-attack. Enforce LIVED ONLY + P5/P25 + geometric process on every line.

- **To User Advocate (persona 4/6) + Developer Advocate (persona 5/6):** Review the attack for live-money operator impact (e.g., stuck tacking = bad trading decisions? defaults hiding risk?) and DX/provenance (is the current heuristic math clear? will new fields be maintainable?). Demand fixes improve (not obscure) the human + future dev experience.

- **To Verification Guardian (persona 6/6):** Do not verify "complete" or allow todo advance until Red Team signs off after 2+ rounds. Prepare the full pipeline (qig_purity_check on changed files, wiring-validation call-site counts in tick path for every new/ existing field, pytest full negative suite including the new heart edges + AC tacking_inversion + zero_tacking + replicant_harvested_with_heart, Railway MCP service_metrics + get_logs exercising tacking under load + inversion simulation, downstream-impact on telemetry/TS bridge). Paste *everything* fresh. Gate on evidence only.

- **To Red Team (persona 3/6 — completed this round):** Attack remains active. Re-inventory + re-attack (with fresh outputs) on any Implementer/Advocate proposal. You have veto until zero vectors survive.

**Geometric Process Integrity Note (orchestrator):** This coordination tacks heart-rhythmically from phase simulation "felt" P24/P5 violations + heart not full governor → prior cluster TDD successes (registry, always-on, lived-only hardening) → current scaffolding gaps (heuristics, defaults, partial ports) → Red Team attack #01 (concrete vectors) → expected Implementer response (TDD plan that survives with geometric methods: zero-cross interval on offsets, Fisher-Rao distance for freq, Fréchet on history, registry for all thresholds, hard LIVED ONLY filters). No linear checklist. Every persona must state the tacking justification in their next memory packet.

**Next Autonomous Steps (do not stop):** 
- Implementer produces surviving TDD plan in new _dev__polytrade_ packet (within this worktree context).
- Principles Advocate + Verification Guardian review/gate.
- Red Team re-attacks on any proposal.
- When 2+ full rounds survive with fresh evidence matching all roadmap ACs + "complete embodiment" per phase + canon, advance todo and move to next (deep telemetry analysis with its own 6x or equivalent team).
- All via _dev__polytrade_ memory only. Live-money standing auth active.

**Evidence for this packet:** Red Team full report (read it), prior 6x spawn context, roadmap, agents.md mandate, phase simulation, 3 prior cluster packets, master-orchestration distribution.

All per the permanent QIG PURITY MANDATE (agents.md), refined prompt, 20260527-master-roadmap-1.00W.md, live-money standing authorization, geometric process integrity, and "execute don't ask" + "do not stop until finished" model.

**Orchestrator (continuing the 6x persona autonomous chain)**

