"use strict";
// Unified Strategy interface for Polytrade
// Single source of truth for strategy definitions across frontend and backend
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategyType = void 0;
var StrategyType;
(function (StrategyType) {
    StrategyType["MOVING_AVERAGE_CROSSOVER"] = "MovingAverageCrossover";
    StrategyType["MA_CROSSOVER"] = "MovingAverageCrossover";
    StrategyType["RSI"] = "RSI";
    StrategyType["MACD"] = "MACD";
    StrategyType["BOLLINGER_BANDS"] = "BollingerBands";
    StrategyType["BREAKOUT"] = "Breakout";
    StrategyType["CUSTOM"] = "Custom";
})(StrategyType || (exports.StrategyType = StrategyType = {}));
