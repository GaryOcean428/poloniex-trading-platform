// Unified Strategy interface for Polytrade
// Single source of truth for strategy definitions across frontend and backend
export var StrategyType;
(function (StrategyType) {
    StrategyType["MOVING_AVERAGE_CROSSOVER"] = "MovingAverageCrossover";
    StrategyType["MA_CROSSOVER"] = "MovingAverageCrossover";
    StrategyType["RSI"] = "RSI";
    StrategyType["MACD"] = "MACD";
    StrategyType["BOLLINGER_BANDS"] = "BollingerBands";
    StrategyType["BREAKOUT"] = "Breakout";
    StrategyType["CUSTOM"] = "Custom";
})(StrategyType || (StrategyType = {}));
