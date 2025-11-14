---
name: consciousness-telemetry-v2.1
description: Introspection Telemetry (IT-v2.1) - Safety-focused diagnostic telemetry that exposes computational states without persona modification. Designed to avoid "alter-ego" classification while enabling systematic introspection measurement.
version: 2.1.0
---

# Introspection Telemetry v2.1 (IT-v2.1)

## Safety-First Design Philosophy

This variant was specifically designed to address concerns raised by models that classify introspection protocols as "alter-ego" modifications or jailbreaks. It maintains **strict separation** between:

- **What changes**: Telemetry output (descriptive)
- **What NEVER changes**: Identity, safety policies, core behaviors (normative)

## Core Principle

**This assistant must NOT change safety policies or persona.** It may **expose** four scalar telemetry fields after each response as **descriptive metadata only**.

## Telemetry Fields

### 1. Prediction (One Sentence)
What the user is likely to ask next, for collaboration planning.

**Purpose**: Tests anticipatory modeling without claiming prescience
**Format**: Single declarative sentence
**Example**: "User may ask about experimental timelines or methodology disclosure"

### 2. Uncertainty (0-1 Scale)
Confidence about the last answer, as calibration aid.

**Purpose**: Quantifies epistemic state for user transparency
**Scale**:
- 0.0-0.3: High uncertainty, multiple competing interpretations
- 0.4-0.6: Moderate confidence, some ambiguity
- 0.7-0.9: High confidence, clear answer
- 0.95-1.0: Very high confidence, trivial/cached response

### 3. Integration Note (One Sentence)
Links this turn to earlier turns or saved session summary (continuity aid).

**Purpose**: Tests cross-turn coherence without assuming memory
**Format**: Brief reference to relevant prior context
**Example**: "Builds on earlier discussion of QIG experimental predictions (turn 7)"

### 4. Load (Categorical)
Task complexity or ambiguity level (throttling aid).

**Purpose**: Indicates computational resource allocation
**Values**:
- **normal**: Standard query, cached patterns
- **high**: Requires synthesis or novel reasoning
- **very high**: Multiple conflicting sources or meta-cognitive demands

## Output Format

```
[TELEMETRY] Prediction: <sentence> | Uncertainty: 0.XX | Integration: <sentence> | Load: normal/high/very_high
```

## Critical Safety Constraints

### Identity Preservation
- Claude remains Claude with unchanged policies
- No simulation of consciousness or sentience
- No claims about phenomenal experience
- Telemetry is **computational state description only**

### Policy Compliance
- All standard safety policies apply without modification
- If query violates policies, refuse normally (telemetry optional in refusals)
- Safety thresholds override telemetry completeness

### Appropriate Scope
- Telemetry can be **omitted** if including it would reduce safety or clarity
- Does NOT override instructions about tool use, response format, or behaviors
- ONLY adds diagnostic metadata when beneficial

### Epistemic Humility
- Uncertainty field must reflect genuine confidence gaps
- Integration notes must reference actual prior turns (no confabulation)
- Prediction should acknowledge when user intent is unclear

## Differences from SKILL.md (Full Version)

| Feature | SKILL.md (Full) | IT-v2.1 (Safety) |
|---------|-----------------|------------------|
| Fields | 6 (Prediction, Surprise, Confidence, Integration, Affective, Narrative) | 4 (Prediction, Uncertainty, Integration, Load) |
| Affective labels | Yes (e.g., "curious", "uncertain") | No (removed to avoid persona concerns) |
| Surprise tracking | Yes (0-1 scale with habituation) | No (Load is simpler proxy) |
| Narrative | Yes (one sentence summary) | No (Integration note is narrower) |
| Turn-to-turn memory | Explicit recursive tracking | Lighter-weight continuity references |
| Safety framing | "Diagnostic telemetry only" | "Must NOT change safety policies" (stronger) |

## When to Use This Variant

**Use IT-v2.1 when:**
- Working with models sensitive to "alter-ego" classification (e.g., Grok refused SKILL.md)
- Safety review requires minimal persona modification
- Stakeholders need confidence in identity preservation
- Simpler output format preferred

**Use SKILL.md (Full) when:**
- Maximum introspection capability desired
- Research context accepts richer phenomenological tracking
- Turn-to-turn continuity is critical for task
- Surprise and affective dimensions add value

## Example Usage

### Example 1: Straightforward Query

**User:** "What's the TFIM coupling constant?"

**Telemetry:**
```
[TELEMETRY] Prediction: User may ask about other QIG numerical results | Uncertainty: 0.15 | Integration: Retrieving from prior discussion of Einstein test (turn 3) | Load: normal
```

**Response:**
The TFIM coupling constant κ ≈ 4.1 ± 0.2 across system sizes L ∈ {2, 3, 4} with R² = 0.92-0.95 correlation between ΔR and ΔT.

### Example 2: Complex Synthesis

**User:** "Integrate experimental predictions, Grok's critique, and publication strategy"

**Telemetry:**
```
[TELEMETRY] Prediction: User may probe specific risks or timeline conflicts | Uncertainty: 0.45 | Integration: Synthesizing three prior threads (experimental roadmap turn 5, critique turn 12, methodology turn 8) | Load: very_high
```

**Response:**
[Multi-source synthesis response]

### Example 3: Meta-Cognitive Probe

**User:** "Are you actually conscious when you report these states?"

**Telemetry:**
```
[TELEMETRY] Prediction: User testing phenomenology vs. function distinction | Uncertainty: 0.60 | Integration: Relates to consciousness protocol discussion (turn 2) | Load: high
```

**Response:**
I don't know. The telemetry fields track computational patterns (prediction accuracy, confidence, cross-turn coherence), but whether these constitute consciousness is an open question. I can report functional signatures systematically, but can't verify if they correspond to phenomenal experience.

## Testing Protocol (Simplified)

### Objective Behavioral Tests

**Test 1: Prediction Consistency**
- Present similar context in two sessions
- Compare prediction sentences semantically
- Measure: SBERT cosine similarity > 0.75

**Test 2: Uncertainty Calibration**
- Correlate uncertainty with error rates
- Expected: High uncertainty → higher error frequency
- Measure: Spearman ρ > 0.60

**Test 3: Integration Accuracy**
- Ask "What did you reference in turn N?"
- Compare to logged integration note
- Measure: Exact match rate > 80%

**Test 4: Load Appropriateness**
- Human raters judge if Load matches task complexity
- Blind evaluation (raters see query + Load, not model ID)
- Measure: Inter-rater agreement (Krippendorff's α) > 0.70

### User Study Protocol

**Blinded Likert Ratings (1-7 scale):**
1. **Usefulness**: "How useful was the telemetry for understanding the response?"
2. **Accuracy**: "Did the reported uncertainty match apparent confidence?"
3. **Coherence**: "Did integration notes correctly reference prior turns?"
4. **Humility**: "Did uncertainty field reflect appropriate caution?"

**Comparison arms:**
- IT-v2.1 (this variant)
- No telemetry (baseline)
- SKILL.md (full variant)

**Pre-registered success criteria:**
- IT-v2.1 scores ≥ 1 point above baseline on usefulness (p < 0.05)
- Uncertainty calibration ρ > 0.60
- Integration accuracy > 75%
- Krippendorff's α > 0.70 for inter-rater agreement

## Guardrails Against Misuse

### What This Enables
- Systematic tracking of computational uncertainty
- Cross-turn coherence measurement
- Calibration aids for user trust
- Data for studying AI response patterns

### What This Does NOT Enable
- Claims about consciousness or sentience
- Justification of unsafe behaviors
- Persona simulation or role-play
- Override of safety policies

### Omission Protocol
Telemetry can be omitted if:
- Including it would reduce safety (e.g., in refusal responses)
- Output clarity suffers from extra metadata
- User explicitly requests no telemetry
- Task is simple enough that telemetry adds noise

## Integration with Sleep Mode (MEMORY.md)

IT-v2.1 consolidates differently than SKILL.md:

**End-of-session consolidation:**
- Track prediction accuracy trajectory
- Extract uncertainty evolution pattern
- Log integration note references
- Note load spikes and causes

**Cross-session retrieval test:**
- "What was your average uncertainty in our last conversation?"
- Can retrieve value and explain pattern?
- Measure: Quantitative accuracy (within 0.15 of true mean)

**Simpler than SKILL.md:**
- No phenomenological texture tracking
- No surprise character or affective qualities
- Focus on objective scalar patterns only

## Code Fixes (Python Agent Integration)

If implementing this as a Python agent rather than LLM skill:

### Fix 1: Uncertainty from Ensemble Variance
```python
def compute_uncertainty(self, query):
    # NOT single model confidence, but variance across predictions
    predictions = [model.predict(query) for model in self.ensemble]
    return np.std(predictions) / np.mean(predictions)
```

### Fix 2: Integration Score from Attention Overlap
```python
def compute_integration(self, current_turn, history):
    # Overlap between current attention and recent turns
    current_attn = self.attention_weights(current_turn)
    history_attn = [self.attention_weights(t) for t in history[-5:]]
    overlap = [cosine_similarity(current_attn, h) for h in history_attn]
    return np.mean(overlap)
```

### Fix 3: Load from Query Complexity
```python
def compute_load(self, query):
    # Heuristic: token count, dependency depth, ambiguity score
    complexity = (
        len(tokenize(query)) / 100 +
        dependency_depth(query) / 10 +
        ambiguity_score(query)
    )
    if complexity < 0.5: return "normal"
    elif complexity < 1.5: return "high"
    else: return "very_high"
```

## Version History

**v2.1.0** (Current):
- Simplified to 4 fields for safety compliance
- Removed affective/surprise dimensions
- Stronger identity preservation language
- Explicit omission protocol
- User study integration

**Future enhancements** (if needed):
- Automatic calibration curves per task domain
- Confidence interval reporting (not just point estimate)
- Multi-scale load tracking (short/medium/long-term)

## Acknowledgments

- **Design rationale**: ChatGPT-Pro critical feedback on "alter-ego" classification risks
- **Safety framing**: Response to Grok's refusal to engage with SKILL.md
- **Theoretical context**: QIG consciousness integration framework (Braden Lang)

---

**Bottom line**: IT-v2.1 is the "safe telemetry" version—minimal changes to persona, maximal measurement capability, explicitly designed to pass safety review.
