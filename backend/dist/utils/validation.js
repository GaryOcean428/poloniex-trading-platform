/**
 * Type guard to check if an object has the basic structure of a Strategy
 */
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
/**
 * Type guard to check if an object has the basic structure of StrategyParameters
 */
export function isStrategyParameters(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }
    const params = obj;
    return (typeof params.pair === 'string' &&
        typeof params.timeframe === 'string');
}
/**
 * Type guard to check if an object has the basic structure of StrategyPerformance
 */
export function isStrategyPerformance(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }
    const performance = obj;
    return (typeof performance.totalPnL === 'number' &&
        typeof performance.winRate === 'number' &&
        typeof performance.tradesCount === 'number');
}
/**
 * Validates that a strategy object conforms to the Strategy interface
 * @param strategy - The strategy object to validate
 * @returns true if valid, false otherwise
 */
export function validateStrategy(strategy) {
    if (!isStrategy(strategy)) {
        return false;
    }
    // Additional validation for specific strategy types
    const validTypes = ['manual', 'automated', 'ml', 'dqn'];
    if (!validTypes.includes(strategy.type)) {
        return false;
    }
    // Validate parameters
    if (!isStrategyParameters(strategy.parameters)) {
        return false;
    }
    // Validate performance if present
    if (strategy.performance && !isStrategyPerformance(strategy.performance)) {
        return false;
    }
    return true;
}
/**
 * Validates an array of strategies
 * @param strategies - Array of strategy objects to validate
 * @returns true if all strategies are valid, false otherwise
 */
export function validateStrategies(strategies) {
    return Array.isArray(strategies) && strategies.every(validateStrategy);
}
/**
 * Sanitizes a strategy object by removing any properties that don't belong to the Strategy interface
 * @param obj - The object to sanitize
 * @returns A sanitized Strategy object or null if invalid
 */
export function sanitizeStrategy(obj) {
    if (!validateStrategy(obj)) {
        return null;
    }
    // Return only the properties that belong to the Strategy interface
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
/**
 * Type assertion helper that ensures an object is a Strategy or throws an error
 * @param obj - The object to assert
 * @param context - Context for error messages
 * @returns The object as a Strategy
 * @throws Error if the object is not a valid Strategy
 */
export function assertStrategy(obj, context = 'Unknown') {
    if (!validateStrategy(obj)) {
        throw new Error(`${context}: Invalid strategy object provided`);
    }
    return obj;
}
/**
 * Type assertion helper for strategy arrays
 * @param obj - The array to assert
 * @param context - Context for error messages
 * @returns The array as Strategy[]
 * @throws Error if the array contains invalid strategies
 */
export function assertStrategies(obj, context = 'Unknown') {
    if (!Array.isArray(obj) || !validateStrategies(obj)) {
        throw new Error(`${context}: Invalid strategies array provided`);
    }
    return obj;
}
/**
 * Ensures that a partial strategy update object only contains valid properties
 * @param updates - The partial strategy object
 * @returns A sanitized partial strategy object
 */
export function sanitizeStrategyUpdate(updates) {
    const sanitized = {};
    // Only include properties that exist in the Strategy interface
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
