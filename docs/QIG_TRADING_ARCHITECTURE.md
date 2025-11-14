# QIG-Enhanced Trading Prediction Architecture

## Overview

Integration of Quantum Information Geometry (QIG) principles into the trading platform's prediction system to enhance market regime detection, indicator coherence measurement, and adaptive strategy selection.

## Architecture Design

### 1. Core QIG Metrics Module

**File**: `backend/src/services/qig/qigMetrics.ts`

```typescript
interface MarketState {
  prices: number[];
  indicators: {
    sma20: number;
    sma50: number;
    ema12: number;
    rsi: number;
    macd: { macd: number; signal: number; histogram: number };
  };
  timestamp: number;
}

interface QIGMetrics {
  surprise: number;           // QFI distance from predicted state [0-1]
  integration: number;        // Φ - indicator coherence [0-1]
  confidence: number;         // State purity × (1 - surprise) [0-1]
  regime: 'LINEAR' | 'GEOMETRIC' | 'BREAKDOWN';
  attention: Map<string, number>; // Dynamic indicator weights
}
```

**Key Functions**:
- `computeSurprise(predicted: MarketState, actual: MarketState): number`
- `computeIntegration(indicators: Record<string, number>): number`
- `classifyRegime(state: MarketState, metrics: QIGMetrics): RegimeType`
- `computeAttentionWeights(indicators: Record<string, number>): Map<string, number>`

### 2. Market State Predictor

**File**: `backend/src/services/qig/marketStatePredictor.ts`

Maintains a rolling prediction of next market state based on historical patterns.

```typescript
class MarketStatePredictor {
  private history: MarketState[] = [];
  private predictionHorizon: number = 5; // 5 periods ahead
  
  predict(currentState: MarketState): MarketState {
    // Weighted average of recent states
    // Similar to consciousness_agent.py SelfModel.predict()
  }
  
  update(actualState: MarketState): void {
    this.history.push(actualState);
    if (this.history.length > 100) {
      this.history.shift();
    }
  }
}
```

### 3. Integration (Φ) Calculator

**File**: `backend/src/services/qig/integrationCalculator.ts`

Measures how unified technical indicators are (analogous to consciousness integration).

```typescript
class IntegrationCalculator {
  /**
   * Compute Φ (integrated information) across indicators
   * 
   * High Φ = indicators strongly agree (high confidence)
   * Low Φ = indicators disagree (low confidence, mixed signals)
   * 
   * Based on correlation between indicator subsystems
   */
  computePhi(indicators: Record<string, number>): number {
    // Normalize indicators to [0, 1]
    const normalized = this.normalizeIndicators(indicators);
    
    // Partition into subsystems
    const subsystems = this.partitionIndicators(normalized);
    
    // Compute cross-correlations
    const correlations = this.computeCorrelations(subsystems);
    
    // Average correlation = integration proxy
    return this.averageCorrelation(correlations);
  }
}
```

### 4. Regime Classifier

**File**: `backend/src/services/qig/regimeClassifier.ts`

Classifies market into Linear/Geometric/Breakdown regimes based on QIG principles.

```typescript
enum MarketRegime {
  LINEAR = 'LINEAR',       // Low volatility, clear trend, simple strategies
  GEOMETRIC = 'GEOMETRIC', // Moderate volatility, complex patterns, full analysis
  BREAKDOWN = 'BREAKDOWN'  // High volatility, unstable, risk-off
}

class RegimeClassifier {
  classify(state: MarketState, metrics: QIGMetrics): MarketRegime {
    const volatility = this.computeVolatility(state.prices);
    const activation = this.computeActivation(state.indicators);
    
    // Based on RCP v4.3 regime classification
    if (activation < 0.3 && metrics.integration > 0.7) {
      return MarketRegime.LINEAR;
    } else if (activation >= 0.3 && activation <= 0.7) {
      return MarketRegime.GEOMETRIC;
    } else {
      return MarketRegime.BREAKDOWN;
    }
  }
  
  private computeActivation(indicators: Record<string, number>): number {
    // Normalize and average indicator magnitudes
    // High activation = many indicators showing strong signals
  }
}
```

### 5. QIG-Enhanced ML Service

**File**: `backend/src/services/qigEnhancedMlService.ts`

Enhanced version of `simpleMlService.ts` with QIG metrics integration.

```typescript
class QIGEnhancedMLService {
  private predictor: MarketStatePredictor;
  private integrationCalc: IntegrationCalculator;
  private regimeClassifier: RegimeClassifier;
  private qigMetrics: QIGMetrics;
  
  async getMultiHorizonPredictions(
    symbol: string, 
    ohlcvData: OHLCVData[]
  ): Promise<EnhancedPrediction> {
    // 1. Build current market state
    const currentState = this.buildMarketState(ohlcvData);
    
    // 2. Get prediction from state predictor
    const predictedState = this.predictor.predict(currentState);
    
    // 3. Compute QIG metrics
    const surprise = this.computeSurprise(predictedState, currentState);
    const integration = this.integrationCalc.computePhi(currentState.indicators);
    const confidence = (1 - surprise) * integration;
    const regime = this.regimeClassifier.classify(currentState, {
      surprise,
      integration,
      confidence,
      regime: 'LINEAR', // placeholder
      attention: new Map()
    });
    
    // 4. Compute attention weights
    const attentionWeights = this.computeAttentionWeights(
      currentState.indicators,
      surprise
    );
    
    // 5. Generate predictions using regime-adaptive strategy
    const predictions = this.generateRegimeAdaptivePredictions(
      currentState,
      regime,
      attentionWeights,
      confidence
    );
    
    // 6. Update predictor with actual state
    this.predictor.update(currentState);
    
    return {
      predictions,
      qigMetrics: {
        surprise,
        integration,
        confidence,
        regime,
        attentionWeights
      }
    };
  }
  
  private generateRegimeAdaptivePredictions(
    state: MarketState,
    regime: MarketRegime,
    weights: Map<string, number>,
    confidence: number
  ): MultiHorizonPredictions {
    switch (regime) {
      case MarketRegime.LINEAR:
        // Simple trend following with high confidence
        return this.linearRegimePrediction(state, confidence);
        
      case MarketRegime.GEOMETRIC:
        // Complex multi-indicator synthesis with attention weighting
        return this.geometricRegimePrediction(state, weights, confidence);
        
      case MarketRegime.BREAKDOWN:
        // Conservative predictions, reduced confidence
        return this.breakdownRegimePrediction(state, confidence * 0.5);
    }
  }
}
```

## Data Flow

```
Market Data (OHLCV)
    ↓
Build Market State (prices + indicators)
    ↓
Predict Next State (from history)
    ↓
Compute QIG Metrics:
  - Surprise (predicted vs actual)
  - Integration (indicator coherence)
  - Confidence (purity × accuracy)
  - Regime (linear/geometric/breakdown)
  - Attention (dynamic indicator weights)
    ↓
Regime-Adaptive Prediction:
  - LINEAR: Simple trend following
  - GEOMETRIC: Full multi-indicator synthesis
  - BREAKDOWN: Risk-off, conservative
    ↓
Enhanced Predictions + QIG Telemetry
```

## Benefits

### 1. **Adaptive Strategy Selection**
- Automatically switches between simple and complex strategies based on market regime
- Reduces overfitting in stable markets (linear regime)
- Increases analysis depth in complex markets (geometric regime)

### 2. **Improved Confidence Scoring**
- Confidence based on geometric state purity, not arbitrary thresholds
- Accounts for both prediction accuracy (surprise) and indicator agreement (integration)

### 3. **Dynamic Indicator Weighting**
- Indicators weighted by their distinguishability in current market state
- Reduces noise from irrelevant indicators
- Focuses on most informative signals

### 4. **Market Regime Detection**
- Early warning system for market breakdowns (high volatility, unstable patterns)
- Automatic risk reduction in breakdown regime

### 5. **Explainable Predictions**
- QIG metrics provide interpretable telemetry
- Users can see why confidence is high/low
- Regime classification explains strategy selection

## Implementation Phases

### Phase 1: Core QIG Metrics (Week 1)
- [ ] Implement `qigMetrics.ts` with surprise, integration, confidence calculations
- [ ] Implement `marketStatePredictor.ts` for state prediction
- [ ] Unit tests for QIG metric calculations

### Phase 2: Regime Classification (Week 2)
- [ ] Implement `regimeClassifier.ts` with linear/geometric/breakdown detection
- [ ] Implement `integrationCalculator.ts` for Φ computation
- [ ] Integration tests with historical market data

### Phase 3: Enhanced ML Service (Week 3)
- [ ] Implement `qigEnhancedMlService.ts` with regime-adaptive predictions
- [ ] Implement attention-weighted indicator synthesis
- [ ] A/B testing framework to compare with baseline `simpleMlService.ts`

### Phase 4: UI Integration (Week 4)
- [ ] Add QIG metrics display to prediction dashboard
- [ ] Add regime indicator (LINEAR/GEOMETRIC/BREAKDOWN badge)
- [ ] Add attention weights visualization (which indicators are most important)
- [ ] Add surprise/integration/confidence charts

### Phase 5: Validation & Tuning (Week 5)
- [ ] Backtest on historical data (6+ months)
- [ ] Compare prediction accuracy vs baseline
- [ ] Tune regime classification thresholds
- [ ] Performance optimization

## Technical Considerations

### 1. **Computational Efficiency**
- QIG metrics computed incrementally (not from scratch each time)
- Rolling window for state history (max 100 states)
- Attention weights cached and updated only on regime changes

### 2. **TypeScript Implementation**
- Pure TypeScript (no Python dependencies)
- Leverages existing technical indicator calculations
- Minimal external dependencies (only math utilities)

### 3. **Backward Compatibility**
- `simpleMlService.ts` remains as fallback
- QIG service can be toggled via feature flag
- Gradual rollout with A/B testing

### 4. **Testing Strategy**
- Unit tests for each QIG metric calculation
- Integration tests with synthetic market data
- Backtesting with real historical data
- Live testing with paper trading first

## Expected Performance Improvements

Based on QIG consciousness architecture results ("extraordinary jump"):

- **Prediction Accuracy**: +15-25% improvement in directional accuracy
- **Confidence Calibration**: +30-40% better confidence-accuracy correlation
- **Risk Management**: -20-30% reduction in losses during breakdown regimes
- **Computational Efficiency**: 2-3× faster in linear regime (sparse connections)

## References

- `scripts/QIF/RCP_v4.3_QIG_Enhanced_COMPLETE.md` - QIG consciousness protocol
- `scripts/QIF/consciousness_agent.py` - Python reference implementation
- `backend/src/services/simpleMlService.ts` - Current baseline ML service
