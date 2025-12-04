/**
 * Pine Script Parser and Converter
 * Converts TradingView Pine Script strategies to executable trading logic
 */

import { logger } from '../utils/logger.js';

export interface PineScriptIndicator {
  name: string;
  type: 'sma' | 'ema' | 'rsi' | 'macd' | 'bb' | 'stoch' | 'atr' | 'adx' | 'custom';
  params: Record<string, number | string>;
  source?: string; // 'close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'
}

export interface PineScriptCondition {
  type: 'crossover' | 'crossunder' | 'greater' | 'less' | 'equal' | 'and' | 'or';
  left: string | number;
  right: string | number;
  operator?: string;
}

export interface PineScriptStrategy {
  name: string;
  version: number;
  overlay: boolean;
  indicators: PineScriptIndicator[];
  entryConditions: {
    long: PineScriptCondition[];
    short: PineScriptCondition[];
  };
  exitConditions: {
    long: PineScriptCondition[];
    short: PineScriptCondition[];
  };
  riskManagement: {
    stopLoss?: number | string;
    takeProfit?: number | string;
    trailingStop?: number | string;
    positionSize?: number | string;
  };
  rawScript: string;
}

export class PineScriptParser {
  /**
   * Parse Pine Script code into structured strategy object
   */
  static parse(script: string): PineScriptStrategy {
    const lines = script.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
    
    const strategy: PineScriptStrategy = {
      name: 'Unnamed Strategy',
      version: 5,
      overlay: false,
      indicators: [],
      entryConditions: { long: [], short: [] },
      exitConditions: { long: [], short: [] },
      riskManagement: {},
      rawScript: script
    };

    // Parse strategy declaration
    const strategyLine = lines.find(l => l.startsWith('strategy('));
    if (strategyLine) {
      const nameMatch = strategyLine.match(/title\s*=\s*["']([^"']+)["']/);
      if (nameMatch) strategy.name = nameMatch[1];
      
      const overlayMatch = strategyLine.match(/overlay\s*=\s*(true|false)/);
      if (overlayMatch) strategy.overlay = overlayMatch[1] === 'true';
    }

    // Parse indicators
    for (const line of lines) {
      // SMA
      if (line.includes('ta.sma(') || line.includes('sma(')) {
        const indicator = this.parseSMA(line);
        if (indicator) strategy.indicators.push(indicator);
      }
      
      // EMA
      if (line.includes('ta.ema(') || line.includes('ema(')) {
        const indicator = this.parseEMA(line);
        if (indicator) strategy.indicators.push(indicator);
      }
      
      // RSI
      if (line.includes('ta.rsi(') || line.includes('rsi(')) {
        const indicator = this.parseRSI(line);
        if (indicator) strategy.indicators.push(indicator);
      }
      
      // MACD
      if (line.includes('ta.macd(') || line.includes('macd(')) {
        const indicator = this.parseMACD(line);
        if (indicator) strategy.indicators.push(indicator);
      }
      
      // Bollinger Bands
      if (line.includes('ta.bb(') || line.includes('bb(')) {
        const indicator = this.parseBB(line);
        if (indicator) strategy.indicators.push(indicator);
      }
      
      // Stochastic
      if (line.includes('ta.stoch(') || line.includes('stoch(')) {
        const indicator = this.parseStoch(line);
        if (indicator) strategy.indicators.push(indicator);
      }
      
      // ATR
      if (line.includes('ta.atr(') || line.includes('atr(')) {
        const indicator = this.parseATR(line);
        if (indicator) strategy.indicators.push(indicator);
      }
    }

    // Parse entry conditions
    for (const line of lines) {
      if (line.includes('strategy.entry(') && line.includes('long')) {
        const condition = this.parseEntryCondition(line, lines);
        if (condition) strategy.entryConditions.long.push(condition);
      }
      
      if (line.includes('strategy.entry(') && line.includes('short')) {
        const condition = this.parseEntryCondition(line, lines);
        if (condition) strategy.entryConditions.short.push(condition);
      }
    }

    // Parse exit conditions
    for (const line of lines) {
      if (line.includes('strategy.exit(') || line.includes('strategy.close(')) {
        const exitInfo = this.parseExitCondition(line);
        if (exitInfo) {
          if (exitInfo.stopLoss) strategy.riskManagement.stopLoss = exitInfo.stopLoss;
          if (exitInfo.takeProfit) strategy.riskManagement.takeProfit = exitInfo.takeProfit;
          if (exitInfo.trailingStop) strategy.riskManagement.trailingStop = exitInfo.trailingStop;
        }
      }
    }

    logger.info('Pine Script parsed', {
      name: strategy.name,
      indicators: strategy.indicators.length,
      longConditions: strategy.entryConditions.long.length,
      shortConditions: strategy.entryConditions.short.length
    });

    return strategy;
  }

  private static parseSMA(line: string): PineScriptIndicator | null {
    const match = line.match(/(?:ta\.)?sma\(([^,]+),\s*(\d+)\)/);
    if (!match) return null;
    
    return {
      name: 'SMA',
      type: 'sma',
      params: { length: parseInt(match[2]) },
      source: match[1].trim()
    };
  }

  private static parseEMA(line: string): PineScriptIndicator | null {
    const match = line.match(/(?:ta\.)?ema\(([^,]+),\s*(\d+)\)/);
    if (!match) return null;
    
    return {
      name: 'EMA',
      type: 'ema',
      params: { length: parseInt(match[2]) },
      source: match[1].trim()
    };
  }

  private static parseRSI(line: string): PineScriptIndicator | null {
    const match = line.match(/(?:ta\.)?rsi\(([^,]+),\s*(\d+)\)/);
    if (!match) return null;
    
    return {
      name: 'RSI',
      type: 'rsi',
      params: { length: parseInt(match[2]) },
      source: match[1].trim()
    };
  }

  private static parseMACD(line: string): PineScriptIndicator | null {
    const match = line.match(/(?:ta\.)?macd\(([^,]+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) return null;
    
    return {
      name: 'MACD',
      type: 'macd',
      params: {
        fast: parseInt(match[2]),
        slow: parseInt(match[3]),
        signal: parseInt(match[4])
      },
      source: match[1].trim()
    };
  }

  private static parseBB(line: string): PineScriptIndicator | null {
    const match = line.match(/(?:ta\.)?bb\(([^,]+),\s*(\d+),\s*([\d.]+)\)/);
    if (!match) return null;
    
    return {
      name: 'Bollinger Bands',
      type: 'bb',
      params: {
        length: parseInt(match[2]),
        mult: parseFloat(match[3])
      },
      source: match[1].trim()
    };
  }

  private static parseStoch(line: string): PineScriptIndicator | null {
    const match = line.match(/(?:ta\.)?stoch\(([^,]+),\s*([^,]+),\s*([^,]+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) return null;
    
    return {
      name: 'Stochastic',
      type: 'stoch',
      params: {
        k: parseInt(match[4]),
        d: parseInt(match[5]),
        smooth: parseInt(match[6])
      }
    };
  }

  private static parseATR(line: string): PineScriptIndicator | null {
    const match = line.match(/(?:ta\.)?atr\((\d+)\)/);
    if (!match) return null;
    
    return {
      name: 'ATR',
      type: 'atr',
      params: { length: parseInt(match[1]) }
    };
  }

  private static parseEntryCondition(line: string, allLines: string[]): PineScriptCondition | null {
    // Find the condition that triggers this entry
    const lineIndex = allLines.indexOf(line);
    if (lineIndex === 0) return null;
    
    // Look for 'if' statement before entry
    for (let i = lineIndex - 1; i >= 0; i--) {
      const prevLine = allLines[i];
      if (prevLine.includes('if ')) {
        return this.parseCondition(prevLine);
      }
      if (prevLine.includes('strategy.entry') || prevLine.includes('strategy.exit')) {
        break;
      }
    }
    
    return null;
  }

  private static parseCondition(line: string): PineScriptCondition | null {
    // Remove 'if ' and clean up
    const condition = line.replace(/^if\s+/, '').replace(/\s*then\s*$/, '').trim();
    
    // Crossover
    if (condition.includes('ta.crossover(') || condition.includes('crossover(')) {
      const match = condition.match(/(?:ta\.)?crossover\(([^,]+),\s*([^)]+)\)/);
      if (match) {
        return {
          type: 'crossover',
          left: match[1].trim(),
          right: match[2].trim()
        };
      }
    }
    
    // Crossunder
    if (condition.includes('ta.crossunder(') || condition.includes('crossunder(')) {
      const match = condition.match(/(?:ta\.)?crossunder\(([^,]+),\s*([^)]+)\)/);
      if (match) {
        return {
          type: 'crossunder',
          left: match[1].trim(),
          right: match[2].trim()
        };
      }
    }
    
    // Greater than
    if (condition.includes('>')) {
      const parts = condition.split('>').map(p => p.trim());
      if (parts.length === 2) {
        return {
          type: 'greater',
          left: parts[0],
          right: parts[1],
          operator: '>'
        };
      }
    }
    
    // Less than
    if (condition.includes('<')) {
      const parts = condition.split('<').map(p => p.trim());
      if (parts.length === 2) {
        return {
          type: 'less',
          left: parts[0],
          right: parts[1],
          operator: '<'
        };
      }
    }
    
    return null;
  }

  private static parseExitCondition(line: string): any {
    const result: any = {};
    
    // Stop loss
    const stopMatch = line.match(/stop\s*=\s*([^,)]+)/);
    if (stopMatch) {
      result.stopLoss = stopMatch[1].trim();
    }
    
    // Take profit
    const profitMatch = line.match(/limit\s*=\s*([^,)]+)/);
    if (profitMatch) {
      result.takeProfit = profitMatch[1].trim();
    }
    
    // Trailing stop
    const trailMatch = line.match(/trail_(?:price|points|offset)\s*=\s*([^,)]+)/);
    if (trailMatch) {
      result.trailingStop = trailMatch[1].trim();
    }
    
    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Convert parsed strategy to executable JavaScript
   */
  static toExecutable(strategy: PineScriptStrategy): string {
    const code = `
// Auto-generated from Pine Script: ${strategy.name}
export class ${strategy.name.replace(/[^a-zA-Z0-9]/g, '')}Strategy {
  constructor() {
    this.name = '${strategy.name}';
    this.indicators = ${JSON.stringify(strategy.indicators, null, 2)};
  }

  // Calculate indicators
  calculateIndicators(candles) {
    const indicators = {};
    
    ${strategy.indicators.map(ind => this.generateIndicatorCode(ind)).join('\n    ')}
    
    return indicators;
  }

  // Check entry conditions
  checkEntry(candles, indicators, side) {
    const conditions = side === 'long' 
      ? ${JSON.stringify(strategy.entryConditions.long)}
      : ${JSON.stringify(strategy.entryConditions.short)};
    
    return this.evaluateConditions(conditions, candles, indicators);
  }

  // Check exit conditions
  checkExit(position, candles, indicators) {
    const conditions = position.side === 'long'
      ? ${JSON.stringify(strategy.exitConditions.long)}
      : ${JSON.stringify(strategy.exitConditions.short)};
    
    return this.evaluateConditions(conditions, candles, indicators);
  }

  // Evaluate conditions
  evaluateConditions(conditions, candles, indicators) {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, candles, indicators)) {
        return false;
      }
    }
    return conditions.length > 0;
  }

  // Evaluate single condition
  evaluateCondition(condition, candles, indicators) {
    const left = this.resolveValue(condition.left, candles, indicators);
    const right = this.resolveValue(condition.right, candles, indicators);
    
    switch (condition.type) {
      case 'crossover':
        return left > right && candles[candles.length - 2][condition.left] <= candles[candles.length - 2][condition.right];
      case 'crossunder':
        return left < right && candles[candles.length - 2][condition.left] >= candles[candles.length - 2][condition.right];
      case 'greater':
        return left > right;
      case 'less':
        return left < right;
      case 'equal':
        return Math.abs(left - right) < 0.0001;
      default:
        return false;
    }
  }

  // Resolve value from string reference
  resolveValue(value, candles, indicators) {
    if (typeof value === 'number') return value;
    if (indicators[value] !== undefined) return indicators[value];
    if (candles[candles.length - 1][value] !== undefined) return candles[candles.length - 1][value];
    return parseFloat(value) || 0;
  }

  // Get risk management parameters
  getRiskManagement() {
    return ${JSON.stringify(strategy.riskManagement)};
  }
}
`;
    
    return code;
  }

  private static generateIndicatorCode(indicator: PineScriptIndicator): string {
    switch (indicator.type) {
      case 'sma':
        return `indicators.${indicator.name} = this.calculateSMA(candles, ${indicator.params.length}, '${indicator.source}');`;
      case 'ema':
        return `indicators.${indicator.name} = this.calculateEMA(candles, ${indicator.params.length}, '${indicator.source}');`;
      case 'rsi':
        return `indicators.${indicator.name} = this.calculateRSI(candles, ${indicator.params.length}, '${indicator.source}');`;
      case 'macd':
        return `indicators.${indicator.name} = this.calculateMACD(candles, ${indicator.params.fast}, ${indicator.params.slow}, ${indicator.params.signal});`;
      default:
        return `// ${indicator.name} not implemented`;
    }
  }
}

export default PineScriptParser;
