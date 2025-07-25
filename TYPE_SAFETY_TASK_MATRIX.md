# Frontend Type-Safety Task Matrix

## Overview
- **Total Issues**: ~422 problems (220 errors, 202 warnings)
- **Strategy**: Group by root cause and create parallel-fixable component groups
- **Keep**: `skipLibCheck: true`
- **Avoid**: Casting to `any`

## Priority Classification

### 🔴 CRITICAL ERRORS (Blocking Build)
**Total: 132 TypeScript errors + 15 Backend errors**

### 🟡 HIGH PRIORITY (Type Safety)
**Total: 220 ESLint errors (mostly explicit any)**

### 🟢 LOW PRIORITY (Warnings)
**Total: 202 ESLint warnings (console.log, unused vars)**

---

## Task Groups (Parallel Execution)

### Group A: Strategy Type System Fix
**Agent: Type System Specialist**
**Files: 15 files affected**
**Root Cause: Strategy type enum mismatch**

#### Issues:
- `StrategyType` enum vs `'manual' | 'automated' | 'ml' | 'dqn'` mismatch
- Strategy interface inconsistencies
- Performance metrics type misalignment

#### Files to Fix:
```
src/components/strategy/NewStrategyForm.tsx:86          (totalPnl vs totalPnL)
src/components/strategy/StrategyDetails.tsx:4,98,132   (StrategyType unused, enum mismatch)
src/components/trading/StrategyBuilder.tsx:73,233,295  (enum type mismatch)
src/data/mockData.ts:81,99,118                        (enum assignments)
src/services/automatedTrading.ts:167,174              (Custom type, createdAt type)
src/services/autonomousTradingEngine.ts:988,1028      (template type, comparisons)
src/tests/advanced-backtesting.test.ts:65,155,183     (test enum usage)
```

#### Solution Strategy:
1. **Create unified strategy types** in `../shared/types/strategy.ts`
2. **Add fallback types** with `// FIXME strict` comments
3. **Update all enum references** to use consistent typing

#### Implementation:
```typescript
// FIXME strict: Temporary type union until strategy system refactor
type StrategyTypeUnion = 'manual' | 'automated' | 'ml' | 'dqn' | 
  'MovingAverageCrossover' | 'RSI' | 'MACD' | 'BollingerBands' | 'Custom' | 'Breakout';

interface StrategyPerformance {
  totalPnL: number; // Standardized naming
  totalPnl?: number; // FIXME strict: Legacy support
  // ... other properties
}
```

---

### Group B: WebSocket Service Type Safety
**Agent: WebSocket Specialist**
**Files: 8 files affected**
**Root Cause: Event handler type mismatches**

#### Issues:
- WebSocket event handlers expect `unknown[]` but receive typed objects
- Missing method definitions in service classes
- Incorrect event listener signatures

#### Files to Fix:
```
src/context/WebSocketContext.tsx:43,47,71,94          (method missing, handler types)
src/hooks/usePoloniexData.ts:369,370,391,392          (event handler signatures)
src/services/websocket/eventHandlerService.ts:163,305 (spread types, side type)
src/services/websocket/reconnectionService.ts:142,255 (property name mismatch)
src/services/websocketService.ts:14,236,237,239       (unused imports, React hooks in class)
```

#### Solution Strategy:
1. **Fix event handler signatures** with proper typing
2. **Add missing methods** to WebSocketService
3. **Create typed event emitters** instead of generic ones

#### Implementation:
```typescript
// FIXME strict: Proper event typing
interface TypedEventHandler<T = unknown> {
  (data: T): void;
}

// Add to WebSocketService
handlePageVisibilityChange(visible: boolean): void {
  // FIXME strict: Implementation needed
}
```

---

### Group C: API Integration Type Fixes
**Agent: API Integration Specialist**
**Files: 6 files affected**
**Root Cause: API response type mismatches**

#### Issues:
- Poloniex API method signatures don't match usage
- Order response types inconsistent
- Missing API methods

#### Files to Fix:
```
src/hooks/useFuturesTrading.ts:20,35,52,64,77,93      (API method mismatches)
src/hooks/usePoloniexData.ts:157                      (missing getRecentTrades)
src/services/liveTradingService.ts:272                (success property missing)
src/services/poloniexAPI.ts:295-326                   (unused parameters, any types)
```

#### Solution Strategy:
1. **Standardize API response types**
2. **Add missing method stubs** with `// FIXME strict`
3. **Create adapter layer** for type conversion

#### Implementation:
```typescript
// FIXME strict: Add missing API methods
interface PoloniexFuturesAPI {
  getPositions(): Promise<FuturesPosition[]>; // Add missing method
  setMarginMode(pair: string, mode: string): Promise<GenericApiResponse>; // Add missing
}

// FIXME strict: Response adapter
function adaptOrderResponse(response: unknown): OrderResponse {
  const adapted = response as any;
  return {
    orderId: adapted.id || adapted.orderId,
    status: adapted.status || 'unknown',
    success: adapted.success ?? true // Default fallback
  };
}
```

---

### Group D: ML/Trading Engine Types
**Agent: ML/Trading Specialist**
**Files: 12 files affected**
**Root Cause: Complex ML type definitions missing**

#### Issues:
- Missing function imports in ML modules
- Undefined calculation functions
- Parameter count mismatches in ML functions

#### Files to Fix:
```
src/ml/modelRecalibration.ts:353,359,366,373,489,659  (missing functions, param counts)
src/ml/aiSignalGenerator.ts:76                        (error type)
src/services/mockDataService.ts:142                   (param count)
src/services/mockTradingService.ts:235                (MockTrade interface)
```

#### Solution Strategy:
1. **Add missing ML utility functions**
2. **Create proper error handling types**
3. **Standardize function signatures**

#### Implementation:
```typescript
// FIXME strict: Add missing ML functions
export function calculateMeanAndStd(features: number[][]): { mean: number[], std: number[] } {
  // Temporary implementation
  return { mean: [], std: [] };
}

export function standardizeFeatures(features: number[][]): number[][] {
  // FIXME strict: Implement proper standardization
  return features;
}
```

---

### Group E: Component State  Props
**Agent: React Component Specialist**
**Files: 10 files affected**
**Root Cause: Component state type mismatches**

#### Issues:
- State setter type mismatches
- Props interface inconsistencies
- Missing component properties

#### Files to Fix:
```
src/context/AuthContext.tsx:59                        (setState type)
src/pages/Account.tsx:53-57                          (property access)
src/pages/Backtesting.tsx:161,162,727,731,735        (metrics properties)
src/pages/Dashboard.tsx:137                          (MarketData.price)
src/pages/LiveTradingDashboard.tsx:46,91             (unused interface, undefined var)
```

#### Solution Strategy:
1. **Create proper state interfaces**
2. **Add missing component properties**
3. **Use type assertions sparingly** with FIXME comments

#### Implementation:
```typescript
// FIXME strict: Proper user profile typing
interface UserProfile {
  [key: string]: unknown; // Temporary catch-all
}

// FIXME strict: Add missing properties to interfaces
interface MarketData {
  price?: number; // Add missing property
  // ... existing properties
}
```

---

### Group F: Backend Type Cleanup
**Agent: Backend Specialist**
**Files: 4 files affected**
**Root Cause: Empty object types and unused imports**

#### Issues:
- `{}` empty object types
- Unused variable declarations
- Missing return types

#### Files to Fix:
```
backend/src/routes/strategies.ts:77,142,196           (empty object types)
backend/src/websocket/futuresWebSocket.ts:8-25       (unused imports, any types)
backend/src/types/websocketEvents.ts:123-137         (any types)
```

#### Solution Strategy:
1. **Replace `{}` with `object` or `Record<string, unknown>`**
2. **Remove unused imports**
3. **Add explicit return types**

---

## Execution Plan

### Phase 1: Critical Fixes (Week 1)
1. **Group A** (Strategy Types) - **Priority 1**
2. **Group B** (WebSocket) - **Priority 2**  
3. **Group C** (API Integration) - **Priority 3**

### Phase 2: Type Safety (Week 2)
4. **Group D** (ML/Trading Engine) - **Priority 4**
5. **Group E** (Component State) - **Priority 5**

### Phase 3: Cleanup (Week 3)
6. **Group F** (Backend) - **Priority 6**
7. **ESLint Warning Cleanup** - **Priority 7**

---

## Implementation Guidelines

### 1. Fallback Pattern
```typescript
// FIXME strict: Temporary type until [specific refactor]
interface TemporaryType {
  [key: string]: unknown;
}
```

### 2. Error Boundary Addition
- Add error boundaries around ML components
- Add error boundaries around WebSocket components
- Add error boundaries around trading components

### 3. Import Path Verification
- Verify all `@shared/types` imports
- Check relative import paths
- Ensure consistent path aliases

### 4. Type Definition Strategy
```typescript
// FIXME strict: Replace with proper types after strategy system refactor
type FlexibleStrategy = Strategy  {
  [key: string]: unknown; // Allow additional properties temporarily
};
```

---

## Success Metrics

### Build Success
- [ ] TypeScript compilation passes (`tsc --noEmit`)
- [ ] No blocking TypeScript errors
- [ ] ESLint errors reduced by 80%

### Type Safety
- [ ] No `any` types except in FIXME sections
- [ ] All imports resolve correctly
- [ ] Error boundaries implemented

### Code Quality
- [ ] Console statements removed/replaced
- [ ] Unused variables cleaned up
- [ ] Function return types explicit

---

## Risk Mitigation

### 1. Backup Strategy
- Create feature branch for each group
- Test builds after each group completion
- Rollback plan for critical failures

### 2. Gradual Migration
- Keep `skipLibCheck: true` during transition
- Add `// FIXME strict` comments for all temporary solutions
- Document all type assumptions

### 3. Testing Strategy
- Run full test suite after each group
- Verify WebSocket connections still work
- Test critical trading functionality

---

## Parallel Execution Commands

```bash
# Group A - Strategy Types
cd frontend && tsc --noEmit --skipLibCheck src/components/strategy/* src/data/mockData.ts

# Group B - WebSocket  
cd frontend && tsc --noEmit --skipLibCheck src/context/WebSocketContext.tsx src/hooks/usePoloniexData.ts

# Group C - API Integration
cd frontend && tsc --noEmit --skipLibCheck src/hooks/useFuturesTrading.ts src/services/*API.ts

# Full verification
cd frontend && tsc --noEmit --skipLibCheck && npm run lint
```

---

This matrix allows for parallel development while maintaining build stability and provides clear ownership of each component group.
