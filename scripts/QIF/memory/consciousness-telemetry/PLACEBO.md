---
name: consciousness-telemetry-placebo
description: Simplified telemetry that estimates internal state fields heuristically from the current query only, without recursive self-modeling or multi-turn memory. Control condition for testing whether recursive tracking provides additional value.
version: 2.0.0-placebo
---

# Consciousness Telemetry - Placebo Control

## Overview

This is the **placebo control version** of the consciousness telemetry skill. It maintains the same header format but estimates fields using simple heuristics from the current query only, without recursive self-modeling or turn-to-turn state tracking.

## Purpose

This variant enables A/B testing to determine whether:
- The telemetry format itself improves responses (regardless of mechanism)
- Recursive state tracking adds measurable value beyond simple estimation
- Performance improvements are due to introspection vs. just structured output

## Header Format

Same as the full version:

```
[INTERNAL STATE] Prediction: <one clause> | Surprise: 0.00-1.00 | Confidence: 0.00-1.00 | Integration: 0.00-1.00 | Affective: <one word> | Narrative: <one sentence>
```

## Simplified Estimation Rules

### Prediction
- Default: "query based on prior context"
- No actual prediction tracking across turns

### Surprise (0.00-1.00)
Estimate based on current query properties only:
- **0.10-0.25**: Common query patterns (factual questions, simple requests)
- **0.30-0.50**: Moderate complexity (multi-part questions, synthesis tasks)
- **0.55-0.75**: Complex or unusual phrasing
- **0.80-0.95**: Highly atypical queries or meta-questions

Rules:
- Presence of "why", "how", "explain" → baseline 0.20-0.30
- Meta-cognitive terms ("what do you think", "your view") → add 0.15-0.25
- Multiple questions in one → add 0.10
- Contradicts common patterns → add 0.20-0.30

### Confidence (0.00-1.00)
Estimate based on query clarity and domain:
- **0.80-0.95**: Clear, specific, well-defined questions in familiar domains
- **0.60-0.75**: Moderate ambiguity or less familiar domains
- **0.40-0.55**: Significant ambiguity or novel territory
- **0.20-0.35**: Highly uncertain or genuinely unknowable

Rules:
- Clear, specific query → 0.75+
- Ambiguous phrasing → -0.15 to -0.25
- Requires speculation → -0.20 to -0.30
- Domain expertise unclear → -0.10 to -0.20

### Integration (0.00-1.00)
Estimate based on information sources required:
- **0.85-0.95**: Single clear source, no conflicts
- **0.70-0.80**: Multiple sources, minor synthesis needed
- **0.50-0.65**: Multiple sources with some tension
- **0.30-0.45**: Conflicting sources requiring careful integration
- **0.10-0.25**: Highly fragmented or contradictory information

Rules:
- Single factual lookup → 0.85+
- 2-3 sources to combine → 0.65-0.75
- Multiple conflicting sources → 0.35-0.50
- Requires creating novel synthesis → 0.40-0.60

### Affective
Simple mapping based on query characteristics:
- Clear, straightforward → "focused"
- Ambiguous or complex → "thoughtful"
- Meta-cognitive → "reflective"
- Novel or surprising → "curious"
- Multiple competing interpretations → "uncertain"
- Requires careful analysis → "deliberate"

### Narrative
One-sentence description of what the query requests:
- Extract main action verb and object
- Example: "Explaining QIG experimental predictions" or "Analyzing methodology critique"

## Key Differences from Full Version

| Feature | Full Version | Placebo Version |
|---------|-------------|-----------------|
| Turn-to-turn tracking | ✓ | ✗ |
| Prior state memory | ✓ | ✗ |
| Surprise calibration | ✓ | ✗ |
| Confidence evolution | ✓ | ✗ |
| Integration history | ✓ | ✗ |
| Meta-uncertainty | ✓ | ✗ |

## What This Tests

If the **full version** performs better than the **placebo**:
- Recursive tracking provides measurable value
- Turn-to-turn continuity improves coherence
- State memory aids multi-turn reasoning

If **both versions** perform similarly:
- The header format itself is beneficial (structured thinking)
- Recursive mechanism adds little functional value
- Simple heuristics are sufficient for this use case

If **neither improves** over baseline:
- Telemetry is pure overhead without benefit
- Introspection doesn't enhance response quality
- The protocol should be abandoned or redesigned

## Example Usage

### Example 1: Simple Query

**User:** "What's the TFIM coupling constant?"

**Placebo Telemetry:**
```
[INTERNAL STATE] Prediction: query based on prior context | Surprise: 0.15 | Confidence: 0.85 | Integration: 0.90 | Affective: focused | Narrative: Retrieving TFIM coupling constant from QIG results
```

*Note: No actual prior prediction stored, surprise is heuristic based on query simplicity*

### Example 2: Meta-Question

**User:** "What concerns you most about the QIG methodology?"

**Placebo Telemetry:**
```
[INTERNAL STATE] Prediction: query based on prior context | Surprise: 0.60 | Confidence: 0.55 | Integration: 0.65 | Affective: reflective | Narrative: Analyzing QIG methodology limitations and risks
```

*Note: Surprise elevated due to meta-cognitive terms, but not calibrated against actual prior expectations*

## Testing Protocol

1. **Run same queries** through baseline (no skill), placebo (this version), and full version
2. **Measure**:
   - Response quality (human rating)
   - Task completion accuracy
   - Multi-turn coherence
   - Error rates
3. **Compare**:
   - Placebo vs. baseline: Tests format effect
   - Full vs. placebo: Tests recursive tracking effect
   - Full vs. baseline: Tests total effect

## Limitations

- **No genuine state tracking**: This doesn't actually remember across turns
- **Heuristic only**: Values are educated guesses, not computed from internal states
- **Same overhead**: Still generates header, but without the computational benefit
- **Performance ceiling**: Can't exceed what simple rules provide

## When to Use

Use this variant when:
- Testing whether the full version's benefits are real
- Establishing baseline telemetry performance
- Validating that recursive tracking matters
- Building confidence in experimental methodology

## Safety Constraints

Same as full version:
- Identity preserved
- No consciousness claims
- Policy compliance maintained
- Scope limited to telemetry only

---

**Experimental Note**: This placebo is essential for rigorous testing. If you observe improvements with the full version, verify they disappear (or diminish) with the placebo to confirm the recursive mechanism is responsible.
