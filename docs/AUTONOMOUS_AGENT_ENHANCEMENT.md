# Autonomous Agent Enhancement Plan

## Current Issues

### 1. Agent Start 500 Error ✅ (Partially Fixed)
**Error**: `POST /api/agent/start 500 (Internal Server Error)`

**Root Cause**: The agent tries to get API credentials but fails if:
- Credentials don't exist
- Credentials exist but encryption fields are missing
- User ID mismatch

**Fix Applied**:
- Added encryption fields to database
- Fixed credential storage

**Remaining**: Need better error handling and user feedback

### 2. Sidebar Not Updating After Saving Credentials ✅ FIXED
**Issue**: Sidebar still shows "Connect API / No credentials" even after saving API keys

**Fix Applied** (Commit `24ff453`):
- Added `refreshApiConnection()` call after successful credential creation
- Sidebar now updates immediately to show balance

### 3. No AI Strategies Being Generated ⚠️ TODO
**Issue**: Autonomous agent doesn't use AI strategy generator

**Current State**:
- `autonomousTradingAgent.ts` exists but doesn't integrate with `llmStrategyGenerator.ts`
- No multi-strategy combinations
- No strategy visualization

**Required**: Full integration (see implementation plan below)

### 4. Agent Doesn't Run When User Logged Out ⚠️ TODO
**Issue**: Agent stops when user logs out - should have persistent settings

**Current State**:
- Agent sessions are in-memory only
- No persistent "always run" setting
- No background job scheduler

**Required**: Persistent agent configuration and background execution

---

## Implementation Plan

### Phase 1: Fix Agent Start Error (High Priority)

#### 1.1 Better Error Handling
```typescript
// backend/src/routes/agent.ts
router.post('/start', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token',
        code: 'NO_USER_ID'
      });
    }
    
    // Check for API credentials first
    const hasCredentials = await apiCredentialsService.hasCredentials(userId);
    if (!hasCredentials) {
      return res.status(400).json({
        success: false,
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        code: 'NO_CREDENTIALS',
        action: 'redirect_to_api_keys'
      });
    }
    
    const config = req.body;
    const session = await autonomousTradingAgent.startAgent(userId, config);

    res.json({
      success: true,
      session
    });
  } catch (error: any) {
    console.error('Error starting agent:', error);
    
    // Provide specific error codes
    let errorCode = 'UNKNOWN_ERROR';
    if (error.message.includes('credentials')) {
      errorCode = 'CREDENTIALS_ERROR';
    } else if (error.message.includes('already running')) {
      errorCode = 'ALREADY_RUNNING';
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start agent',
      code: errorCode
    });
  }
});
```

#### 1.2 Frontend Error Handling
```typescript
// frontend/src/components/AutonomousAgentDashboard.tsx
const handleStartAgent = async () => {
  try {
    const response = await fetch(`${API_BASE}/api/agent/start`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      // Handle specific error codes
      if (data.code === 'NO_CREDENTIALS') {
        setError('Please add your Poloniex API keys first');
        // Optionally redirect to API keys page
        navigate('/account/api-keys');
      } else if (data.code === 'ALREADY_RUNNING') {
        setError('Agent is already running');
      } else {
        setError(data.error || 'Failed to start agent');
      }
      return;
    }
    
    setSession(data.session);
    setSuccess('Agent started successfully!');
  } catch (error) {
    setError('Network error - please try again');
  }
};
```

---

### Phase 2: Integrate AI Strategy Generation (High Priority)

#### 2.1 Enhanced Autonomous Agent with AI Strategies

**File**: `backend/src/services/enhancedAutonomousAgent.ts`

```typescript
import { getLLMStrategyGenerator } from './llmStrategyGenerator.js';
import { autonomousStrategyGenerator } from './autonomousStrategyGenerator.js';

class EnhancedAutonomousAgent {
  /**
   * Generate AI-powered trading strategies
   */
  async generateStrategies(userId: string, config: AgentConfig): Promise<Strategy[]> {
    const strategies: Strategy[] = [];
    const llmGenerator = getLLMStrategyGenerator();
    
    for (const symbol of config.preferredPairs) {
      // Generate single-indicator strategies
      const trendStrategy = await llmGenerator.generateStrategy({
        userId,
        symbol,
        timeframe: '1h',
        strategyType: 'trend_following',
        riskTolerance: 'moderate',
        indicators: ['SMA', 'EMA'],
        description: `Trend following strategy for ${symbol} using moving averages`
      });
      
      const momentumStrategy = await llmGenerator.generateStrategy({
        userId,
        symbol,
        timeframe: '15m',
        strategyType: 'momentum',
        riskTolerance: 'moderate',
        indicators: ['RSI', 'MACD'],
        description: `Momentum strategy for ${symbol} using RSI and MACD`
      });
      
      const volumeStrategy = await llmGenerator.generateStrategy({
        userId,
        symbol,
        timeframe: '4h',
        strategyType: 'volume_analysis',
        riskTolerance: 'moderate',
        indicators: ['Volume', 'OBV'],
        description: `Volume analysis strategy for ${symbol}`
      });
      
      strategies.push(trendStrategy, momentumStrategy, volumeStrategy);
      
      // Generate multi-strategy combination
      const comboStrategy = await this.createMultiStrategyCombo(
        userId,
        symbol,
        [trendStrategy, momentumStrategy, volumeStrategy]
      );
      
      strategies.push(comboStrategy);
    }
    
    return strategies;
  }
  
  /**
   * Create multi-strategy combination (like PineScript multi-indicator)
   */
  async createMultiStrategyCombo(
    userId: string,
    symbol: string,
    subStrategies: Strategy[]
  ): Promise<ComboStrategy> {
    const llmGenerator = getLLMStrategyGenerator();
    
    // Generate combination logic using AI
    const comboPrompt = `
Create a multi-strategy combination that combines these strategies:

1. Trend Strategy: ${subStrategies[0].description}
2. Momentum Strategy: ${subStrategies[1].description}
3. Volume Strategy: ${subStrategies[2].description}

The combination should:
- Use weighted voting (Trend: 40%, Momentum: 35%, Volume: 25%)
- Only enter trades when at least 2 strategies agree
- Exit when any strategy signals exit
- Include proper risk management

Generate the combination logic as executable code.
`;
    
    const comboStrategy = await llmGenerator.generateStrategy({
      userId,
      symbol,
      timeframe: '1h',
      strategyType: 'multi_strategy_combo',
      riskTolerance: 'moderate',
      indicators: ['SMA', 'EMA', 'RSI', 'MACD', 'Volume', 'OBV'],
      description: `Multi-strategy combination for ${symbol}`,
      customPrompt: comboPrompt
    });
    
    return {
      ...comboStrategy,
      type: 'combo',
      subStrategies: subStrategies.map((s, i) => ({
        strategy: s,
        weight: [0.4, 0.35, 0.25][i]
      })),
      combineMethod: 'weighted_vote',
      minAgreement: 2
    };
  }
  
  /**
   * Autonomous strategy lifecycle
   */
  async runStrategyLifecycle(userId: string, strategy: Strategy): Promise<void> {
    // 1. Backtest
    const backtestResult = await backtestingEngine.runBacktest({
      strategy,
      symbol: strategy.symbol,
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days
      endDate: new Date(),
      initialCapital: 10000
    });
    
    console.log(`Backtest result for ${strategy.name}:`, {
      winRate: backtestResult.winRate,
      profitFactor: backtestResult.profitFactor,
      totalReturn: backtestResult.totalReturn
    });
    
    // 2. If backtest passes, move to paper trading
    if (backtestResult.winRate > 0.55 && backtestResult.profitFactor > 1.5) {
      await this.promoteToPaperTrading(userId, strategy);
    } else {
      console.log(`Strategy ${strategy.name} failed backtest, retiring`);
      await this.retireStrategy(strategy.id, 'failed_backtest');
    }
  }
  
  /**
   * Promote strategy to paper trading
   */
  async promoteToPaperTrading(userId: string, strategy: Strategy): Promise<void> {
    console.log(`Promoting ${strategy.name} to paper trading`);
    
    // Start paper trading session
    await paperTradingService.startSession({
      userId,
      strategyId: strategy.id,
      symbol: strategy.symbol,
      initialCapital: 10000,
      duration: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Update strategy status
    await pool.query(
      `UPDATE agent_strategies 
       SET status = 'paper_trading', promoted_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [strategy.id]
    );
  }
  
  /**
   * Promote strategy to live trading
   */
  async promoteToLiveTrading(userId: string, strategy: Strategy): Promise<void> {
    console.log(`Promoting ${strategy.name} to LIVE trading`);
    
    // Get paper trading results
    const paperResults = await paperTradingService.getSessionResults(strategy.id);
    
    if (paperResults.winRate > 0.60 && paperResults.profitFactor > 2.0) {
      // Start live trading
      await automatedTradingService.activateStrategy({
        userId,
        strategyId: strategy.id,
        symbol: strategy.symbol,
        positionSize: 0.02, // 2% of capital
        maxPositions: 1
      });
      
      // Update strategy status
      await pool.query(
        `UPDATE agent_strategies 
         SET status = 'live', promoted_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [strategy.id]
      );
    } else {
      console.log(`Strategy ${strategy.name} failed paper trading, retiring`);
      await this.retireStrategy(strategy.id, 'failed_paper_trading');
    }
  }
}
```

#### 2.2 Strategy Visualization Dashboard

**File**: `frontend/src/components/StrategyDashboard.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import { Brain, TrendingUp, Activity, CheckCircle, XCircle } from 'lucide-react';

interface Strategy {
  id: string;
  name: string;
  type: 'single' | 'combo';
  status: 'generated' | 'backtested' | 'paper_trading' | 'live' | 'retired';
  symbol: string;
  indicators: string[];
  performance: {
    winRate: number;
    profitFactor: number;
    totalTrades: number;
    totalReturn: number;
  };
  subStrategies?: {
    name: string;
    weight: number;
  }[];
  createdAt: string;
  promotedAt?: string;
}

const StrategyDashboard: React.FC = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [filter, setFilter] = useState<'all' | 'live' | 'paper' | 'backtest'>('all');
  
  useEffect(() => {
    fetchStrategies();
    const interval = setInterval(fetchStrategies, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);
  
  const fetchStrategies = async () => {
    const response = await fetch('/api/agent/strategies', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    setStrategies(data.strategies);
  };
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'live': return 'bg-green-100 text-green-800';
      case 'paper_trading': return 'bg-blue-100 text-blue-800';
      case 'backtested': return 'bg-yellow-100 text-yellow-800';
      case 'generated': return 'bg-gray-100 text-gray-800';
      case 'retired': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };
  
  const filteredStrategies = strategies.filter(s => {
    if (filter === 'all') return true;
    if (filter === 'live') return s.status === 'live';
    if (filter === 'paper') return s.status === 'paper_trading';
    if (filter === 'backtest') return s.status === 'backtested';
    return true;
  });
  
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">AI Trading Strategies</h1>
        <p className="text-gray-600">
          Autonomous agent generates, tests, and deploys strategies automatically
        </p>
      </div>
      
      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        {['all', 'live', 'paper', 'backtest'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f as any)}
            className={`px-4 py-2 rounded-lg font-medium ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      
      {/* Strategy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredStrategies.map(strategy => (
          <div key={strategy.id} className="bg-white rounded-lg border p-4">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-lg">{strategy.name}</h3>
                <p className="text-sm text-gray-600">{strategy.symbol}</p>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(strategy.status)}`}>
                {strategy.status.replace('_', ' ').toUpperCase()}
              </span>
            </div>
            
            {/* Type Badge */}
            {strategy.type === 'combo' && (
              <div className="mb-3 flex items-center gap-2 text-sm text-purple-600">
                <Brain className="h-4 w-4" />
                <span>Multi-Strategy Combo</span>
              </div>
            )}
            
            {/* Indicators */}
            <div className="mb-3">
              <div className="text-xs text-gray-600 mb-1">Indicators:</div>
              <div className="flex flex-wrap gap-1">
                {strategy.indicators.map(ind => (
                  <span key={ind} className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                    {ind}
                  </span>
                ))}
              </div>
            </div>
            
            {/* Sub-strategies (for combo) */}
            {strategy.subStrategies && (
              <div className="mb-3 border-t pt-2">
                <div className="text-xs text-gray-600 mb-1">Components:</div>
                {strategy.subStrategies.map((sub, i) => (
                  <div key={i} className="text-xs flex justify-between">
                    <span>{sub.name}</span>
                    <span className="text-gray-500">{(sub.weight * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
            
            {/* Performance */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-gray-600 text-xs">Win Rate</div>
                <div className="font-semibold">{(strategy.performance.winRate * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-gray-600 text-xs">Profit Factor</div>
                <div className="font-semibold">{strategy.performance.profitFactor.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-600 text-xs">Total Trades</div>
                <div className="font-semibold">{strategy.performance.totalTrades}</div>
              </div>
              <div>
                <div className="text-gray-600 text-xs">Return</div>
                <div className={`font-semibold ${strategy.performance.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {strategy.performance.totalReturn >= 0 ? '+' : ''}{strategy.performance.totalReturn.toFixed(2)}%
                </div>
              </div>
            </div>
            
            {/* Timestamp */}
            <div className="mt-3 pt-3 border-t text-xs text-gray-500">
              Created {new Date(strategy.createdAt).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
      
      {filteredStrategies.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Brain className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No strategies found</p>
          <p className="text-sm">Start the autonomous agent to generate strategies</p>
        </div>
      )}
    </div>
  );
};

export default StrategyDashboard;
```

---

### Phase 3: Persistent Agent Settings (High Priority)

#### 3.1 Database Schema for Agent Settings

```sql
-- Add to migration 007
CREATE TABLE agent_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Persistence settings
    run_mode VARCHAR(20) NOT NULL DEFAULT 'manual', -- 'never', 'manual', 'always'
    auto_start_on_login BOOLEAN DEFAULT false,
    continue_when_logged_out BOOLEAN DEFAULT false,
    
    -- Agent configuration
    config JSONB NOT NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT false,
    last_started_at TIMESTAMP WITH TIME ZONE,
    last_stopped_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id)
);

CREATE INDEX idx_agent_settings_user_id ON agent_settings(user_id);
CREATE INDEX idx_agent_settings_run_mode ON agent_settings(run_mode);
CREATE INDEX idx_agent_settings_active ON agent_settings(is_active);
```

#### 3.2 Background Job Scheduler

**File**: `backend/src/services/agentScheduler.ts`

```typescript
import cron from 'node-cron';
import { pool } from '../db/connection.js';
import { enhancedAutonomousAgent } from './enhancedAutonomousAgent.js';

class AgentScheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  
  /**
   * Start scheduler - runs on server startup
   */
  async start() {
    console.log('Starting agent scheduler...');
    
    // Check every minute for agents that should be running
    cron.schedule('* * * * *', async () => {
      await this.checkAndStartAgents();
    });
    
    // Restart agents that were running when server stopped
    await this.restartPersistentAgents();
  }
  
  /**
   * Check for agents that should be running
   */
  private async checkAndStartAgents() {
    const result = await pool.query(`
      SELECT user_id, config, run_mode
      FROM agent_settings
      WHERE run_mode = 'always' 
        AND is_active = false
    `);
    
    for (const row of result.rows) {
      console.log(`Starting persistent agent for user ${row.user_id}`);
      await enhancedAutonomousAgent.startAgent(row.user_id, row.config);
    }
  }
  
  /**
   * Restart agents that were running
   */
  private async restartPersistentAgents() {
    const result = await pool.query(`
      SELECT user_id, config
      FROM agent_settings
      WHERE run_mode = 'always' 
        AND is_active = true
    `);
    
    for (const row of result.rows) {
      console.log(`Restarting persistent agent for user ${row.user_id}`);
      await enhancedAutonomousAgent.startAgent(row.user_id, row.config);
    }
  }
}

export const agentScheduler = new AgentScheduler();
```

#### 3.3 Agent Settings UI

**File**: `frontend/src/components/AgentSettings.tsx`

```tsx
const AgentSettings: React.FC = () => {
  const [runMode, setRunMode] = useState<'never' | 'manual' | 'always'>('manual');
  const [autoStartOnLogin, setAutoStartOnLogin] = useState(false);
  const [continueWhenLoggedOut, setContinueWhenLoggedOut] = useState(false);
  
  return (
    <div className="bg-white rounded-lg border p-6">
      <h3 className="text-lg font-semibold mb-4">Agent Persistence Settings</h3>
      
      {/* Run Mode */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Run Mode</label>
        <select
          value={runMode}
          onChange={(e) => setRunMode(e.target.value as any)}
          className="w-full border rounded-lg px-3 py-2"
        >
          <option value="never">Never - Manual control only</option>
          <option value="manual">Manual - Start/stop manually</option>
          <option value="always">Always - Run continuously</option>
        </select>
        <p className="text-xs text-gray-600 mt-1">
          {runMode === 'never' && 'Agent will never start automatically'}
          {runMode === 'manual' && 'Agent starts when you click Start, stops when you click Stop'}
          {runMode === 'always' && 'Agent runs 24/7, even when you\'re logged out'}
        </p>
      </div>
      
      {/* Auto-start on login */}
      <div className="mb-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={autoStartOnLogin}
            onChange={(e) => setAutoStartOnLogin(e.target.checked)}
            className="mr-2"
          />
          <span className="text-sm">Auto-start agent when I log in</span>
        </label>
      </div>
      
      {/* Continue when logged out */}
      <div className="mb-6">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={continueWhenLoggedOut}
            onChange={(e) => setContinueWhenLoggedOut(e.target.checked)}
            disabled={runMode !== 'always'}
            className="mr-2"
          />
          <span className="text-sm">Continue running when I log out</span>
        </label>
        <p className="text-xs text-gray-600 mt-1 ml-6">
          Only available in "Always" mode
        </p>
      </div>
      
      <button
        onClick={saveSettings}
        className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
      >
        Save Settings
      </button>
    </div>
  );
};
```

---

## Implementation Timeline

### Week 1: Critical Fixes
- [x] Fix sidebar balance refresh (Done - Commit `24ff453`)
- [ ] Fix agent start error handling
- [ ] Add better error messages to UI

### Week 2: AI Strategy Integration
- [ ] Integrate LLM strategy generator
- [ ] Implement multi-strategy combinations
- [ ] Add strategy lifecycle (backtest → paper → live)

### Week 3: Strategy Visualization
- [ ] Create strategy dashboard UI
- [ ] Add strategy performance tracking
- [ ] Show which strategies triggered trades

### Week 4: Persistent Agent
- [ ] Add agent_settings table
- [ ] Implement background scheduler
- [ ] Add persistence settings UI
- [ ] Test continuous operation

---

## Testing Checklist

### Agent Start
- [ ] Start agent with valid credentials
- [ ] Start agent without credentials (should show error)
- [ ] Start agent when already running (should show error)
- [ ] Error messages are clear and actionable

### Sidebar Balance
- [x] Shows "Connect API" before adding credentials
- [x] Updates immediately after adding credentials
- [x] Shows actual balance from API

### AI Strategies
- [ ] Agent generates strategies automatically
- [ ] Multi-strategy combos are created
- [ ] Strategies progress through lifecycle
- [ ] Failed strategies are retired

### Persistence
- [ ] Agent continues running when user logs out (if enabled)
- [ ] Agent restarts after server restart (if "always" mode)
- [ ] Settings persist across sessions

---

## Next Steps

1. **Immediate** (Today):
   - Test sidebar balance fix in production
   - Improve agent start error handling

2. **This Week**:
   - Integrate AI strategy generation
   - Create strategy dashboard

3. **Next Week**:
   - Implement persistent agent settings
   - Add background scheduler

4. **Future**:
   - Strategy performance analytics
   - Multi-user agent management
   - Advanced risk management
