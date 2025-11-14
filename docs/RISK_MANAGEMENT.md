# Risk Management Documentation

## Max Risk Per Trade Explained

### What is "Max Risk Per Trade"?

**Max Risk Per Trade** is a percentage of your **total trading capital** (not available funds) that you're willing to risk on a single trade.

### Example Calculation

If you have:
- **Initial Capital**: $10,000
- **Max Risk Per Trade**: 2%

Then:
- **Risk Amount per Trade**: $10,000 × 2% = **$200**

This means you're willing to lose a maximum of $200 on any single trade.

### How Position Size is Calculated

The system uses the risk amount to calculate position size based on your stop loss:

```typescript
// From fullyAutonomousTrader.ts line 485-487
const riskAmount = (config.initialCapital * config.maxRiskPerTrade) / 100;
const stopLossDistance = currentPrice * 0.02; // 2% stop loss
const positionSize = riskAmount / stopLossDistance;
```

**Example**:
- Risk Amount: $200
- Current BTC Price: $50,000
- Stop Loss Distance: 2% = $1,000
- **Position Size**: $200 / $1,000 = 0.004 BTC

This means:
- You buy 0.004 BTC at $50,000 = **$200 position**
- Stop loss at $49,000 (2% below)
- If stopped out, you lose exactly **$200** (your max risk)

### Key Points

1. **Risk is based on TOTAL CAPITAL, not available funds**
   - If you have $10,000 capital and 2% risk, you risk $200 per trade
   - Even if you only have $5,000 available (rest in open positions)

2. **Stop Loss is Fixed at 2%**
   - Long positions: Stop loss 2% below entry
   - Short positions: Stop loss 2% above entry

3. **Take Profit is 4% (2:1 Risk/Reward)**
   - Long positions: Take profit 4% above entry
   - Short positions: Take profit 4% below entry

4. **Position Size Adjusts Automatically**
   - Higher price assets = smaller quantity
   - Lower price assets = larger quantity
   - Always risking the same dollar amount

### Configuration Options

You can configure these settings in the autonomous trading dashboard:

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Max Risk Per Trade | 2% | 0.5% - 5% | Percentage of capital risked per trade |
| Max Drawdown | 10% | 5% - 20% | Maximum total loss before stopping |
| Target Daily Return | 1% | 0.5% - 5% | Daily profit target |

### Risk Management Rules

The system enforces these safety rules:

1. **Maximum Risk Check**
   ```typescript
   // No new trades if current drawdown exceeds max
   if (currentDrawdown > config.maxDrawdown) {
     return { canTrade: false, reason: 'Max drawdown exceeded' };
   }
   ```

2. **Position Limits**
   - Maximum 3 concurrent positions per user
   - Only high-confidence signals (≥70%) are executed

3. **Stop Loss Enforcement**
   - Automatic stop loss on every position
   - Trailing stop activates after 2% profit

### Example Scenarios

#### Scenario 1: Conservative Trader
- Capital: $5,000
- Max Risk Per Trade: 1%
- Risk per trade: $50
- With 2% stop loss on $50,000 BTC:
  - Position size: $50 / $1,000 = 0.001 BTC = $50
  - Max loss if stopped: $50

#### Scenario 2: Moderate Trader
- Capital: $10,000
- Max Risk Per Trade: 2%
- Risk per trade: $200
- With 2% stop loss on $50,000 BTC:
  - Position size: $200 / $1,000 = 0.004 BTC = $200
  - Max loss if stopped: $200

#### Scenario 3: Aggressive Trader
- Capital: $20,000
- Max Risk Per Trade: 5%
- Risk per trade: $1,000
- With 2% stop loss on $50,000 BTC:
  - Position size: $1,000 / $1,000 = 0.02 BTC = $1,000
  - Max loss if stopped: $1,000

### Best Practices

1. **Start Conservative**
   - Begin with 1-2% risk per trade
   - Increase only after consistent profitability

2. **Monitor Drawdown**
   - If you hit max drawdown, system stops trading
   - Review strategy before re-enabling

3. **Diversify Symbols**
   - Trade multiple pairs to spread risk
   - Don't put all capital in one market

4. **Paper Trading First**
   - Test strategies with paper trading
   - Switch to live only after proven results

### Code References

**Position Sizing Logic**:
- File: `backend/src/services/fullyAutonomousTrader.ts`
- Lines: 485-487 (risk calculation)
- Lines: 490-497 (stop loss and take profit)

**Risk Checks**:
- File: `backend/src/services/fullyAutonomousTrader.ts`
- Lines: 270-305 (canTrade validation)

**Configuration**:
- File: `backend/src/services/fullyAutonomousTrader.ts`
- Lines: 19-27 (TradingConfig interface)

### FAQ

**Q: Is 2% risk per trade too much?**
A: 2% is a standard risk level used by many professional traders. It allows for 50 consecutive losses before losing all capital (though max drawdown would stop you much earlier).

**Q: Can I change the stop loss percentage?**
A: Currently fixed at 2%. This can be made configurable in future updates.

**Q: What if I have multiple open positions?**
A: Each position risks the configured percentage. With 3 positions at 2% risk each, you're risking 6% total.

**Q: Does leverage affect risk calculation?**
A: The system uses leverage (default 5x) but position sizing ensures you still only risk the configured percentage of your capital.

**Q: What happens if price gaps through my stop loss?**
A: In volatile markets, you may lose more than the intended 2% if price gaps. This is why max drawdown protection exists.

### Summary

**Max Risk Per Trade = Percentage of Total Capital You're Willing to Lose on One Trade**

- 2% of $10,000 = $200 risk per trade
- Position size calculated to ensure stop loss = risk amount
- System enforces max drawdown and position limits
- Start conservative, increase risk only with proven results
