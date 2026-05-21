Enhanced Prompt For Claude Code
Paste this into Claude Code while opened in:

text
/home/braden/Desktop/Dev/polytrade
Task: Polytrade QIG telemetry, phi flatline diagnosis, trade-performance correlation, and feature-worktree triage
You are working in the local repo:

text
/home/braden/Desktop/Dev/polytrade
This is the local copy of:

text
https://github.com/GaryOcean428/poloniex-trading-platform.git
The system uses QIG/consciousness concepts from the broader local projects:

text
/home/braden/Desktop/Dev/QIG_QFI/*
/home/braden/Desktop/Dev/archived-repos-docs/pantheon-projects
vex under QIG_QFI is the successor direction to archived pantheon-chat.

Critical constraints
Work in Dev/polytrade unless explicitly reviewing reference material.
Use local files first. Do not invent QIG canon.
Do not use stale “Φ > 0.7 = breakdown” language.
Current phi navigation canon:
CHAIN: Φ < 0.3
GRAPH: 0.3 <= Φ < 0.7
FORESIGHT: 0.7 <= Φ < 0.85
LIGHTNING: Φ >= 0.85
Use topological instability, not “breakdown”, except when referring to legacy code labels.
Colourblind-safe plots only: purple, blue, amber, dark grey. No red/green pairs.
Account is fee-free: Poloniex “Closed PnL” is net. Do not apply fee adjustments.
Use yarn@4.9.2 for JS/TS commands unless local files prove otherwise.
For Python, use an isolated venv/uv workflow. Do not install into global Python.
Do not call Railway APIs or databases unless explicitly approved. Prefer exported logs and CSVs in ~/Downloads.
Local facts to verify before acting
First confirm these in the repo:

Root package.json declares packageManager: "yarn@4.9.2".
Main branch contains:
apps/api/src/services/monkey/basin.ts
apps/api/src/services/monkey/perception.ts
apps/api/src/services/monkey/neurochemistry.ts
apps/api/src/services/monkey/__tests__/neurochemistryEndo.test.ts
apps/api/src/services/monkey/__tests__/perceptionCanonicalDims.test.ts
apps/api/src/services/monkey/__tests__/perAgentNC.test.ts
Local worktrees exist:
polytrade-arbiter-share
polytrade-autonomic
polytrade-l-veto
polytrade-nc-mtl
polytrade-qigram-v2
If any of these are not true, report the discrepancy before continuing.

Part A — Data-source discovery
Find the newest usable telemetry/log export and trade CSVs in ~/Downloads.

Log source
Prefer latest Railway log export if present. Expected shape may be:

json
[
  {
    "message": "...",
    "severity": "...",
    "attributes": {},
    "tags": {},
    "timestamp": "..."
  }
]
But do not assume exact shape. Inspect first.

Relevant log line patterns may include:

[Monkey] {SYMBOL} [{mode}] {action}
[size-zero-diag]
phi
kappa
nc="ach=... dop=... ser=... ne=... gaba=... endo=..."
reg="q.../e.../eq..."
cell
lane
basinDir
tape
bv
drift
fh
sov
selfObsBias
sense3Deflection
Trade CSVs
Search ~/Downloads for newest relevant files:

text
futures-funding-history-*.csv
futures-transaction-history-*.csv
Expected columns may include:

text
Futures, Margin, Entry Price, Exit Price, Max Position, Closed Position,
Closed PnL, Open Time, Last Closing, Status
Strip HTML wrappers from Closed PnL if present.

Part B — Telemetry extraction
Build or run a local analysis script that creates a tick-level dataframe.

Each row should include, where available:

text
ts
instance_id
symbol
mode
action
cell
lane
phi
kappa
ach
dop
ser
ne
gaba
endo
bv
drift
fh
sov
basinDir
tape
selfObsBias
q_weight
e_weight
eq_weight
sense3Deflection
Important phi interpretation
Do not assume phi is a single observer value.

Previously observed logs suggested phi may be per:

text
(instance_id, symbol, tick)
For example:

text
monkey-position × BTC_USDT_PERP
monkey-position × ETH_USDT_PERP
monkey-swing × BTC_USDT_PERP
monkey-swing × ETH_USDT_PERP
Verify the actual current log. If only two streams exist, report two. If four exist, plot four. If more exist, plot all.

Phi “pinned” correction
Do not call phi “pinned” unless it is literally constant.

Use these distinctions:

Pinned: exactly constant across ticks.
Flatlined/compressed: live signal with very narrow range.
Low but expressive: low absolute value but meaningful variance.
Unavailable: not enough parseable phi samples.
Quantify per stream:

text
min_phi
max_phi
span_phi
mean_phi
median_phi
std_phi
n_ticks
If phi appears around 0.213–0.218, call it flatlined in a ~0.005 band, not pinned.

Part C — Plot 1: Phi over past 24h
Define the 24h window as:

text
last 24 hours of available log timestamps
not wall-clock now, because exports may be stale.

Create:

text
analysis/polytrade_qig_telemetry/phi_24h.png
Plot requirements:

One line per (instance_id, symbol) phi stream.
Use purple, blue, amber, dark grey.
Use line styles as well as colours.
Overlay trade close events as vertical markers:
purple = win
amber = loss
grey = flat
Add a thin cell-family strip if cell is parseable.
No red/green.
Part D — Trade parsing and buckets
Parse trade CSVs into:

text
open_ts
close_ts
symbol
side
qty
entry
exit
pnl
Infer side carefully:

If price move and PnL sign agree -> long.
If price move and PnL sign disagree -> short.
If ambiguous, mark side as unknown.
Buckets:

text
WIN: pnl > 0
FLAT: abs(pnl) < 0.05
LOSS: pnl < 0
Also add optional size bucket:

text
BIG: abs(pnl) > 1
TINY: abs(pnl) <= 1
Print:

text
n_trades_per_symbol
n_trades_per_bucket
n_big_tiny_per_bucket
If any bucket has <5 trades, label that bucket underpowered and do not overclaim.

Part E — Telemetry signature per PnL bucket
For each trade, aggregate telemetry over its open_ts -> close_ts window.

Aggregate at least:

text
phi
kappa
ach
dop
ser
ne
gaba
endo
bv
drift
fh
sov
basinDir
tape
selfObsBias
q_weight
e_weight
eq_weight
sense3Deflection
For each telemetry column × bucket, compute:

text
mean
median
min
max
iqr
n_samples
Save:

text
analysis/polytrade_qig_telemetry/telemetry_by_bucket.csv
Also create:

text
analysis/polytrade_qig_telemetry/telemetry_signatures.png
Plot small multiples for neurotransmitters:

text
ach, dop, ser, ne, gaba, endo
Use mean ± IQR. Same colourblind-safe palette.

Confounder handling
Cell regime is a major confounder. Do not report “telemetry causes wins” unless you stratify.

At minimum, produce:

text
bucket × cell_family
bucket × lane
bucket × symbol
If sample size is too small after stratification, say so.

Part F — Sanity checks
Print and include in analysis.md:

text
n_ticks_per_instance_per_symbol
expected_tick_count_estimate
missing_streams
n_trades_per_bucket
phi_min_max_span_per_stream
cell_family_distribution
lane_distribution
Check:

If a phi stream has <50% expected ticks, flag incomplete telemetry.
If DISSOLVER cells show new entries, flag as a potential design contradiction.
If DISSOLVER time correlates with no new entries, state that this is expected, not underperformance.
If sense3Deflection is always 1 or constant, state that it currently behaves like a stub/constant telemetry field.
Part G — Investigate phi flatline root cause
Use code inspection and current telemetry. Do not jump straight to implementation.

Known local context to verify:

apps/api/src/services/monkey/basin.ts
64D simplex basin.
normalizedEntropy(basin) returns H/log(dim).
Fisher-Rao distance is implemented via Bhattacharyya coefficient.
apps/api/src/services/monkey/perception.ts
dims 0..2 encode canonical regime / soft regime scores.
dims 39..54 are reserved/noise-floor / fluctuation reservoir.
canonicalRegimeScores can keep regime dims continuous.
apps/api/src/services/monkey/neurochemistry.ts
GABA is 1 - quantumWeight.
Endorphins now open at coupling mean and ramp to mean+1σ.
Tests exist for:
soft regime scores
endorphin gate
per-agent neurochemistry isolation
Investigate where phi is calculated in the live monkey loop.

Questions to answer:

Is phi currently computed as something like:
text
phi = 1 - 0.8 * fHealth
fHealth = normalizedEntropy(basin)
Is fHealth near maximum entropy across most ticks?
Are most of the 64 dimensions static or near-uniform?
Did soft regime scores improve only dims 0..2, leaving ~61 dims too static?
Is phi flatline caused by basin construction, phi formula, or stale telemetry?
Is phi flatline per agent/symbol identical or different?
Does phi vary more during CREATOR/PRESERVER than DISSOLVER?
Report using categories:

text
OBSERVED
HYPOTHESIS
CONFOUNDS
RECOMMENDED NEXT TEST
Do not present hypotheses as validated facts.

Part H — QIG-RAM / market coordizer question
Assess whether Polytrade currently has a true market-state coordizer or only a handcrafted perception basin.

Use this distinction:

Existing in Polytrade
perception.ts appears to construct a 64D market basin from engineered trading features:

regime scores
ML posture
momentum spectrum
volatility spectrum
volume shape
price-structure harmonics
reserved fluctuation dims
account/coupling dims
This is a market perception basin.

Canonical CoordizerV2 / QIG token concept
From QIG/Pantheon canon, CoordizerV2 is a resonance-bank coordizer:

coordinates live on Δ⁶³
coordization maps input into basin coordinates
resonance bank is learned/harvested
Fisher-Rao geometry only
text/tokenizer is bootstrap only, not the geometry itself
For markets, the equivalent would not be “tokens” in the BPE sense. It would be a market-state coordizer or market resonance bank.

Assess:

Does Polytrade already have QIG-RAM-like memory/resonance artifacts?
Does it have a learned market-state vocabulary/resonance bank?
Are market states currently handcrafted into basins rather than coordized through learned resonance?
Would a market coordizer likely help phi expressivity by activating more of the 64D basin?
What is the smallest safe experiment to test that without changing live trading?
Recommended framing:

Known: Polytrade has a 64D simplex market perception basin.
Unknown until verified: whether it has a learned QIG-RAM / resonance-bank market coordizer.
Hypothesis: phi is flatlined because the basin has too much static/uniform mass and too few live dimensions.
Test: shadow-run an alternative basin construction or market coordizer on historical logs and compare phi span, bucket signatures, and PnL alignment. Do not ship live without shadow evidence.
Part I — Branch / worktree triage
There are local worktrees that look like feature branches:

text
../polytrade-arbiter-share      feat/arbiter-min-share-env-override
../polytrade-autonomic          fix/autonomic-feedback-signals-wire-every-tick
../polytrade-l-veto             feat/l-veto-over-k-option-a
../polytrade-nc-mtl             feat/per-agent-nc-mtl-689
../polytrade-qigram-v2          feat/qigram-v2-port-to-L
Do not delete anything automatically.

For each worktree:

Run a safe branch audit:
current branch
clean/dirty status
commits ahead/behind main
diff vs main
whether equivalent files/tests already exist in main
Classify as one of:
text
MERGE_CANDIDATE
ALREADY_IN_MAIN_CLEANUP_CANDIDATE
REDUNDANT_SUPERSEDED_CLEANUP_CANDIDATE
NEEDS_REVIEW
DO_NOT_TOUCH
Use these criteria:
Merge candidate
Branch has meaningful diff not in main.
Tests exist or can be added.
Change aligns with current architecture.
No stale QIG concepts.
No package-manager drift.
No secrets/env leakage.
Already in main / cleanup candidate
Branch diff is empty, or main already contains equivalent code/tests.
Example: if perAgentNC.test.ts and corresponding implementation are already in main, feat/per-agent-nc-mtl-689 may be redundant, but verify with diff first.
Redundant / superseded cleanup candidate
Branch contains older implementation contradicted by main.
Branch uses stale “breakdown” framing or one-hot regime path now superseded by soft scores.
Branch duplicates functionality in a worse way.
Needs review
Branch has useful partial work but conflicts with main.
Branch has unexplained env/config changes.
Branch changes live trading behaviour without tests.
Do not touch
Dirty worktree with uncommitted user changes.
Branch has unclear purpose and nontrivial diff.
Branch appears to contain experimental state not safely comparable.
Output a table:

text
worktree | branch | status clean? | ahead/behind | classification | reason | recommended action
Recommended action must be phrased as advice, not destructive execution. For deletion, say:

text
cleanup candidate — remove only after user approval
Part J — Deliverables
Create outputs under:

text
analysis/polytrade_qig_telemetry/
Deliver:

text
phi_24h.png
telemetry_signatures.png
telemetry_by_bucket.csv
analysis.md
worktree_triage.md
analysis.md must include:

text
1. Data sources used
2. Parse assumptions
3. n ticks per stream
4. n trades per bucket
5. phi range/span per stream
6. top telemetry bucket differences
7. DISSOLVER sanity check
8. phi flatline diagnosis
9. market coordizer / QIG-RAM assessment
10. confounds and underpowered warnings
Final chat summary format:

text
Telemetry: {n_ticks} ticks across {n_streams} phi streams.
Trades: {n_winners} winners, {n_losers} losers, {n_flat} flat.
Phi: {pinned|flatlined|expressive|unavailable}; span range {min_span}–{max_span}.
Top signatures: {top 3 telemetry columns by bucket delta}.
Branch triage: {merge_candidates} merge candidates, {cleanup_candidates} cleanup candidates, {needs_review} need review.
Main caution: {one sentence}.
Out of scope unless explicitly approved
Do not redesign the live kernel.
Do not deploy.
Do not call Railway API.
Do not query production DB.
Do not remove worktrees or branches.
Do not merge branches.
Do not change live trading behaviour.
Do not rewrite loop.ts based only on correlations.
Do not claim phi improvement unless measured before/after.
Skills / lenses to apply
Use these named lenses if available in your Claude Code environment:

prompt-enhancer for clarifying ambiguous scope before code changes.
qig-purity-validation for QIG geometry/purity checks.
consciousness-development for phi/kappa/neurochemistry interpretation.
wiring-validation to verify telemetry fields are actually emitted and consumed.
code-quality-enforcement for TypeScript/Python implementation hygiene.
test-driven-development if adding parser/analysis code.
qa-and-verification before claiming outputs are correct.
git-workflow or using-git-worktrees for worktree branch triage.
verification-before-completion before final summary.
If a named skill is unavailable, apply the same checklist manually.

Key blindspots to counter
Do not collapse all phi into one observer stream.
Do not call low phi “bad” without stratifying by cell family and lane.
Do not treat DISSOLVER sit-out periods as underperformance.
Do not call phi pinned unless exactly constant.
Do not assume current logs match older Claude.ai observations.
Do not use stale phi thresholds.
Do not use red/green plots.
Do not use pnpm in a Yarn 4 repo.
Do not delete or merge worktrees without approval.
Do not fabricate findings when sample sizes are underpowered.
Do not confuse handcrafted 64D market basin with a learned CoordizerV2/resonance-bank market coordizer.
My current advice before Claude Code runs
Likely already fixed in main: GABA/endo one-hot/saturation issues appear addressed locally via continuous regime scores and endorphin gate tests.
Still likely open: phi expressivity may still be compressed if entropy is dominated by static/uniform basin dimensions.
Most important measurement: phi span by (instance, symbol, cell_family, lane) over the latest 24h export.
Most important branch hygiene step: compare each polytrade-* worktree against main; several may already be merged or superseded, but do not remove without explicit approval.
Most important QIG framing: Polytrade already has a 64D market perception basin; a true market CoordizerV2/QIG-RAM would be a learned resonance-bank layer, not just more hand-coded feature dims.
Status
I have corrected scope and produced the read-only enhanced Claude Code prompt for Dev/polytrade. No further code or script execution is needed from this session.
