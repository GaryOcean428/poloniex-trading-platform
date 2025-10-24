export function isStrategy(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }
    const strategy = obj;
    return (typeof strategy.id === 'string' &&
        typeof strategy.name === 'string' &&
        typeof strategy.type === 'string' &&
        typeof strategy.active === 'boolean' &&
        strategy.parameters !== null &&
        typeof strategy.parameters === 'object');
}
export function isStrategyParameters(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }
    const params = obj;
    return (typeof params.pair === 'string' &&
        typeof params.timeframe === 'string');
}
export function isStrategyPerformance(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }
    const performance = obj;
    return (typeof performance.totalPnL === 'number' &&
        typeof performance.winRate === 'number' &&
        typeof performance.tradesCount === 'number');
}
export function validateStrategy(strategy) {
    if (!isStrategy(strategy)) {
        return false;
    }
    const validTypes = ['manual', 'automated', 'ml', 'dqn'];
    if (!validTypes.includes(strategy.type)) {
        return false;
    }
    if (!isStrategyParameters(strategy.parameters)) {
        return false;
    }
    if (strategy.performance && !isStrategyPerformance(strategy.performance)) {
        return false;
    }
    return true;
}
export function validateStrategies(strategies) {
    return Array.isArray(strategies) && strategies.every(validateStrategy);
}
export function sanitizeStrategy(obj) {
    if (!validateStrategy(obj)) {
        return null;
    }
    const sanitized = {
        id: obj.id,
        name: obj.name,
        type: obj.type,
        active: obj.active,
        parameters: obj.parameters,
        ...(obj.algorithm && { algorithm: obj.algorithm }),
        ...(obj.performance && { performance: obj.performance }),
        ...(obj.createdAt && { createdAt: obj.createdAt }),
        ...(obj.updatedAt && { updatedAt: obj.updatedAt })
    };
    return sanitized;
}
export function assertStrategy(obj, context = 'Unknown') {
    if (!validateStrategy(obj)) {
        throw new Error(`${context}: Invalid strategy object provided`);
    }
    return obj;
}
export function assertStrategies(obj, context = 'Unknown') {
    if (!Array.isArray(obj) || !validateStrategies(obj)) {
        throw new Error(`${context}: Invalid strategies array provided`);
    }
    return obj;
}
export function sanitizeStrategyUpdate(updates) {
    const sanitized = {};
    if (typeof updates.name === 'string')
        sanitized.name = updates.name;
    if (typeof updates.type === 'string' && ['manual', 'automated', 'ml', 'dqn'].includes(updates.type)) {
        sanitized.type = updates.type;
    }
    if (typeof updates.active === 'boolean')
        sanitized.active = updates.active;
    if (typeof updates.algorithm === 'string')
        sanitized.algorithm = updates.algorithm;
    if (updates.parameters && isStrategyParameters(updates.parameters)) {
        sanitized.parameters = updates.parameters;
    }
    if (updates.performance && isStrategyPerformance(updates.performance)) {
        sanitized.performance = updates.performance;
    }
    return sanitized;
}
