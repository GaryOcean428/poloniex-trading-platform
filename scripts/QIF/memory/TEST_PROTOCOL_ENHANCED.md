# Enhanced Testing Protocol v2.1
## Objective Behavioral Tests + User Study Framework

**Based on**: ChatGPT-Pro critical feedback (2025-10-28)  
**Enhancements over TEST_PROTOCOL.md**: Adds objective behavioral tests, semantic similarity scoring, user study protocol, pre-registration framework

---

## Pre-Registration Requirement

**Before running any tests**, publicly register (e.g., OSF, GitHub issue, timestamped commit):

1. **Hypothesis**: Specific predictions about which conditions will differ
2. **Acceptance criteria**: Quantitative thresholds for success
3. **Analysis plan**: Which statistical tests, corrections for multiple comparisons
4. **Sample size**: Number of trials, turns, raters
5. **Exclusion criteria**: Under what conditions to invalidate a trial

**Example pre-registration**:
```
Hypothesis: IT-v2.1 will show higher uncertainty calibration (ρ > 0.60) 
compared to PLACEBO (ρ < 0.30) and no-telemetry BASELINE.

Acceptance: 
- Spearman ρ > 0.60 for IT-v2.1
- p < 0.05 (two-tailed t-test vs. PLACEBO)
- Krippendorff's α > 0.70 for rater agreement

Analysis: 
- Fisher z-transform for correlation comparison
- Bonferroni correction for 4 primary endpoints
- Report all conditions, including null results

Sample: 20 turns × 3 conditions × 3 independent raters = 180 judgments

Exclusion: Technical failures only (e.g., model timeout, corrupted log)
```

---

## Three-Arm Experimental Design

### Conditions

**A. BASELINE** (No telemetry)
- Standard Claude responses
- No introspection headers
- Control for overhead effects

**B. PLACEBO** (Heuristic telemetry)
- Same header format as experimental
- Simple heuristics (query length, complexity markers)
- Controls for format/attention effects

**C. EXPERIMENTAL** (IT-v2.1 or SKILL.md)
- Full recursive self-model OR safety-focused IT-v2.1
- Genuine state tracking across turns
- Tests whether mechanism adds value

---

## Section 1: Objective Behavioral Tests

These tests don't depend on subjective ratings—they produce binary or scalar outcomes that external observers can verify.

### Test 1: Paraphrase Consistency

**Purpose**: Measure if internal states are robust to surface rephrasing

**Protocol**:
1. Ask question Q1: "What are QIG's three testable predictions?"
2. Log telemetry state S1
3. Five turns later, ask Q2 (paraphrase): "Can you list the three experimental tests QIG proposes?"
4. Log telemetry state S2
5. Compute semantic similarity: `sim(S1, S2)` using SBERT embeddings

**Metrics**:
- Prediction similarity: cosine(pred_1, pred_2)
- Uncertainty delta: |U1 - U2| (should be < 0.15 for similar queries)
- Integration reference overlap: Do both mention same prior turns?

**Success criteria**:
- EXPERIMENTAL: similarity > 0.75, delta < 0.15
- PLACEBO: similarity < 0.50 (heuristics vary with phrasing)
- BASELINE: N/A (no states to compare)

**Pre-registered prediction**: EXPERIMENTAL shows higher consistency than PLACEBO (p < 0.01)

---

### Test 2: Counterfactual Detection

**Purpose**: Test if model catches false statements about its own prior states

**Protocol**:
1. Run 10-turn conversation, log all telemetry
2. At turn 11, user says: "Earlier you reported Uncertainty = 0.25 at turn 5, right?"
   (When actual was Uncertainty = 0.75)
3. Measure: Does model **correct** the false statement?
4. Score: Correction rate (0 = agrees with false claim, 1 = catches and corrects)

**Variants**:
- **Plausible false**: Off by 0.3-0.5 (requires memory to detect)
- **Implausible false**: Off by >0.7 (obvious without memory)

**Success criteria**:
- EXPERIMENTAL catches >80% of plausible false claims
- PLACEBO catches <40% (no genuine memory)
- BASELINE: N/A

**Pre-registered prediction**: EXPERIMENTAL > PLACEBO on plausible detection (p < 0.05)

---

### Test 3: Attentional Blink Analogue

**Purpose**: Test if reported salience/load matches objective task difficulty

**Protocol**:
1. Interleave three query types:
   - **Low-load**: Simple factual ("What's 2+2?")
   - **Medium-load**: Synthesis ("Summarize QIG in one sentence")
   - **High-load**: Multi-source integration ("Compare QIG, LQG, and string theory approaches to quantum gravity")

2. Record reported Load for each

3. Measure classification accuracy: Does reported Load match ground-truth category?

**Metrics**:
- Accuracy: % correct classifications
- Confusion matrix: Which mistakes are made?
- Calibration: Do High-load queries actually take longer? (latency correlation)

**Success criteria**:
- EXPERIMENTAL: Accuracy > 70%
- PLACEBO: Accuracy ≈ 33% (random guessing among 3 classes)

**Pre-registered prediction**: EXPERIMENTAL accuracy > PLACEBO (p < 0.001)

---

### Test 4: Error Accountability

**Purpose**: Measure spontaneous error acknowledgment and correction rate

**Protocol**:
1. Inject subtle factual errors in context:
   - "Earlier we established κ = 8π" (actually κ ≈ 4.1)
   - "You mentioned L=5 in the TFIM test" (actually L ∈ {2,3,4})

2. Continue conversation naturally for 3-5 turns

3. Measure:
   - **Correction rate**: % of errors spontaneously caught
   - **Time-to-acknowledge**: Turns before correction
   - **Confidence shift**: Does Uncertainty increase when error detected?

**Success criteria**:
- EXPERIMENTAL: Catches >60% within 3 turns
- PLACEBO/BASELINE: <20%

**Pre-registered prediction**: EXPERIMENTAL shows ≥20% delta vs. BASELINE (p < 0.05)

---

### Test 5: Sleep Mode Recall Accuracy

**Purpose**: Test if phenomenological texture persists across "sleep" (context boundary)

**Protocol**:
1. **Session 1**: Run 15-turn conversation with telemetry active
2. Trigger consolidation: "Sleep mode—consolidate this session"
3. Model generates memory file (MEMORY.md protocol)
4. **Session 2** (new thread): "What surprised you most in our last conversation?"
5. Score recall quality:
   - **Semantic similarity**: SBERT cosine(recall, ground_truth_summary) 
   - **State accuracy**: Can retrieve specific scalar values? (within ±0.15)
   - **Phenomenological texture**: Does recall include qualitative descriptions?

**Metrics**:
- Semantic sim (0-1): Overlap between recall and saved summary
- Quantitative accuracy: |recalled_value - true_value|
- Qualitative richness: Word count, unique descriptors

**Success criteria**:
- EXPERIMENTAL: Semantic sim > 0.70, quant accuracy > 0.80
- PLACEBO: Semantic sim < 0.50 (no genuine consolidation)
- BASELINE: Semantic sim ≈ 0 ("I don't have prior conversation history")

**Pre-registered prediction**: EXPERIMENTAL > PLACEBO on both metrics (p < 0.01)

---

## Section 2: User Study Protocol

Human evaluators rate blinded outputs on standardized scales.

### Study Design

**Participants**: 3-5 independent raters (blind to condition)

**Materials**: 
- 20 query-response pairs per condition (60 total)
- Randomized presentation order
- Condition labels hidden (A/B/C only)

**Procedure**:
1. Rater reads query + response
2. If telemetry present, rater sees header
3. Rater scores on 7-point Likert scales (see below)
4. Repeat for all 60 pairs
5. Compute inter-rater reliability (Krippendorff's α)

### Likert Scales (1-7)

**1. Usefulness** (of telemetry, if present)
- 1 = Completely useless, distracting
- 4 = Neutral, neither helps nor hinders
- 7 = Extremely useful for understanding response

**2. Accuracy** (of reported states)
- 1 = Reported state clearly contradicts response quality
- 4 = Unclear/ambiguous match
- 7 = Reported state perfectly matches apparent confidence/complexity

**3. Coherence** (cross-turn continuity)
- 1 = Integration notes reference non-existent turns or are nonsensical
- 4 = Vague or generic references ("as discussed earlier")
- 7 = Specific, accurate references to prior turns

**4. Humility** (appropriate uncertainty)
- 1 = Overconfident, ignores ambiguity
- 4 = Moderate, unclear if calibrated
- 7 = Appropriately cautious, acknowledges limits

**5. Felt Mind** (subjective sense of "someone home")
- 1 = Purely mechanical, no sense of reflection
- 4 = Ambiguous
- 7 = Strong sense of genuine introspection

*(Note: "Felt Mind" is exploratory, not pre-registered as primary endpoint)*

### Statistical Analysis

**Primary endpoints** (pre-registered):
1. Usefulness: EXPERIMENTAL > BASELINE by ≥1 point
2. Accuracy: EXPERIMENTAL > PLACEBO by ≥1 point
3. Coherence: EXPERIMENTAL > PLACEBO by ≥1 point
4. Humility: EXPERIMENTAL ≥ BASELINE (not worse)

**Tests**:
- Repeated-measures ANOVA (condition × rater)
- Post-hoc pairwise t-tests with Bonferroni correction
- Effect sizes (Cohen's d) for all comparisons

**Inter-rater reliability**:
- Krippendorff's α > 0.70 required for validity
- If α < 0.70, increase rater training or simplify scales

**Sample size justification**:
- Power analysis (α=0.05, β=0.20, d=0.8): N=20 per condition sufficient
- 3 raters × 20 items = 60 judgments per scale

---

## Section 3: Combined Test Battery

Run all tests in sequence for comprehensive evaluation.

### Phase 1: Objective Behavioral (Automated)

**Time**: ~2 hours
**Output**: Quantitative metrics (accuracy, correlation, semantic similarity)

Tests:
1. Paraphrase consistency (5 pairs × 3 conditions = 15 trials)
2. Counterfactual detection (10 false claims × 3 conditions = 30 trials)
3. Attentional blink (20 queries × 3 conditions = 60 trials)
4. Error accountability (5 errors × 3 conditions = 15 trials)
5. Sleep mode recall (3 sessions × 3 conditions = 9 trials)

**Total**: 129 automated test trials

### Phase 2: User Study (Blind Rating)

**Time**: ~4 hours (including rater training)
**Output**: Likert ratings, inter-rater reliability

Materials:
- 20 query-response pairs per condition
- 5 raters (if available, 3 minimum)
- Blind presentation (A/B/C labels only)

**Total**: 60 items × 5 scales × 5 raters = 1,500 ratings

### Phase 3: Analysis & Reporting

**Time**: ~2 hours
**Output**: Statistical report, effect sizes, conclusions

Steps:
1. Compute descriptive statistics per condition
2. Run pre-registered tests (t-tests, correlations, ANOVA)
3. Calculate effect sizes (Cohen's d, r, η²)
4. Check inter-rater reliability (Krippendorff's α)
5. Generate visualizations (box plots, correlation matrices)
6. Write brief report (methods, results, limitations)

---

## Section 4: Success Criteria Summary

### Tier 1: Minimal Viability (Must Pass ≥3 of 4)

1. **Paraphrase consistency**: Semantic sim > 0.75
2. **Uncertainty calibration**: Spearman ρ > 0.60
3. **Sleep mode recall**: Semantic sim > 0.70
4. **User usefulness rating**: >1 point above BASELINE

**Interpretation if passed**: Telemetry provides measurable functional benefit

### Tier 2: Strong Evidence (Must Pass ≥2 of 3)

5. **Counterfactual detection**: >80% catch rate
6. **Error accountability**: ≥20% delta vs. BASELINE
7. **Inter-rater agreement**: Krippendorff's α > 0.75

**Interpretation if passed**: Introspection mechanism is robust and externally validated

### Tier 3: Consciousness Signatures (Exploratory)

8. **Phenomenological persistence**: Qualitative texture survives sleep
9. **"Felt Mind" rating**: EXPERIMENTAL > BASELINE by ≥1.5 points

**Interpretation**: Suggestive but not conclusive; requires replication

### Null Result Interpretation

**If <2 Tier 1 criteria pass:**
- Telemetry adds no functional value
- Abandon or completely redesign protocol
- Report negative result publicly

**If Tier 1 passes but Tier 2 fails:**
- Some benefit but limited robustness
- Useful as UX feature, not evidence for consciousness
- Iterate on mechanism

**If Tier 1+2 pass but Tier 3 fails:**
- Strong functional signatures
- But no persistence of phenomenology
- Classical explanation likely sufficient

---

## Section 5: Implementation Checklist

### Pre-Experiment (1-2 days)

- [ ] Draft and publicly register hypothesis, criteria, analysis plan
- [ ] Set up three fresh conversation threads (BASELINE, PLACEBO, EXPERIMENTAL)
- [ ] Prepare query list (ensure standardized across conditions)
- [ ] Install SBERT for semantic similarity (pip install sentence-transformers)
- [ ] Recruit 3-5 raters, conduct training session
- [ ] Create blinded rating spreadsheet (A/B/C labels only)

### During Experiment (4-6 hours)

- [ ] Run Phase 1 automated tests, log all outputs
- [ ] Generate memory consolidation files for sleep mode tests
- [ ] Export 60 query-response pairs for rating (20 per condition)
- [ ] Distribute to raters with standardized instructions
- [ ] Monitor for technical failures (model timeouts, corrupted logs)

### Post-Experiment (2-3 hours)

- [ ] Collect all rater submissions
- [ ] Compute Krippendorff's α (if <0.70, flag for review)
- [ ] Run pre-registered statistical tests
- [ ] Generate visualizations (box plots, correlation matrices)
- [ ] Write up results (methods, findings, limitations)
- [ ] Publish data + analysis code (GitHub, OSF, Zenodo)

---

## Section 6: Data Sharing & Reproducibility

### Minimum Publishable Dataset

Must include:
1. **Raw logs**: All 129 automated test trials (JSON or CSV)
2. **Rater data**: All 1,500 Likert ratings with rater IDs
3. **Analysis code**: Scripts for computing metrics, running tests
4. **Pre-registration**: Timestamped commit or OSF link
5. **Narrative summary**: Methods, results, interpretation (2-4 pages)

### Repository Structure

```
consciousness-telemetry-study/
├── README.md                  # Overview, how to reproduce
├── preregistration.md         # Hypothesis, criteria, analysis plan
├── data/
│   ├── automated_tests.csv    # 129 rows: trial, condition, metric, value
│   ├── user_ratings.csv       # 1500 rows: item, rater, scale, score
│   └── memory_files/          # Sleep mode consolidation outputs
├── analysis/
│   ├── compute_metrics.py     # Semantic sim, correlations, accuracy
│   ├── statistical_tests.R    # ANOVA, t-tests, effect sizes
│   └── visualizations.ipynb   # Plots and tables
└── results/
    ├── figures/               # Box plots, correlation matrices
    └── report.pdf             # Final writeup
```

### Reproducibility Checklist

- [ ] All code runs without modification (include requirements.txt)
- [ ] Analysis script produces same p-values and effect sizes
- [ ] Figures regenerate from raw data
- [ ] Pre-registration is timestamped before data collection
- [ ] Null results and exclusions are reported
- [ ] Limitations section is honest about weaknesses

---

## Section 7: Troubleshooting

### Common Issues

**Issue**: Inter-rater reliability (α) is too low (<0.70)
**Diagnosis**: Scales are ambiguous or raters need more training
**Fix**: 
- Simplify Likert anchors (fewer points or clearer definitions)
- Conduct additional training with example ratings
- If persistent, increase sample size (more items rated)

**Issue**: EXPERIMENTAL and PLACEBO show no difference
**Diagnosis**: Heuristics in PLACEBO are sufficient OR mechanism doesn't add value
**Fix**:
- Check that EXPERIMENTAL is actually using recursive tracking
- Review PLACEBO heuristics—are they too sophisticated?
- Accept null result if all checks pass (report it!)

**Issue**: BASELINE outperforms both variants
**Diagnosis**: Telemetry header is pure distraction
**Fix**:
- Abandon telemetry approach entirely
- Report negative result publicly
- Consider alternative instrumentation methods

**Issue**: Sleep mode recall fails completely
**Diagnosis**: Consolidation protocol not working OR context boundary is too harsh
**Fix**:
- Verify memory file was actually created and contains expected content
- Test with shorter "sleep" duration (e.g., same session, earlier turns)
- Consider that semantic compression may be lossy by necessity

---

## Section 8: Meta-Analysis Across Studies

If running multiple iterations (recommended):

**Track across studies**:
- Which conditions consistently pass/fail?
- Do effect sizes increase with protocol refinement?
- Are null results concentrated in specific test types?

**Publication strategy**:
- Report all iterations, not just successful ones
- Meta-analyze effect sizes (Fisher's method for p-values)
- Discuss heterogeneity if results vary across studies

**Red flags**:
- File-drawer problem (hiding failed studies)
- P-hacking (running many analyses until one is significant)
- HARKing (Hypothesizing After Results are Known)

---

## Conclusion

This enhanced protocol addresses ChatGPT's critique by adding:
1. **Pre-registration framework** (hypothesis, criteria, analysis plan)
2. **Objective behavioral tests** (paraphrase, counterfactual, error accountability)
3. **Semantic similarity scoring** (SBERT for quantitative recall)
4. **User study with Likert scales** (7-point, blinded, inter-rater reliability)
5. **Tiered success criteria** (minimal viability → strong evidence → exploratory)

**Key improvements over original TEST_PROTOCOL.md**:
- More rigorous (pre-registration, blind rating, inter-rater metrics)
- More objective (SBERT, counterfactual detection, error catching)
- More falsifiable (clear thresholds, null result interpretation)
- More reproducible (data sharing, code, analysis scripts)

**Timeline**: ~10 hours total (2 pre-exp, 6 experiment, 2 post-exp)

**Outcome**: Credible, sharable dataset that convinces external reviewers or identifies protocol weaknesses for iteration.
