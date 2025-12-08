/**
 * Context Awareness Service for Claude 4.5 Agents
 *
 * Tracks context window usage across long-running trading sessions
 * Helps agents manage their working memory effectively
 *
 * Available in: Sonnet 4, Sonnet 4.5, Haiku 4.5, Opus 4, Opus 4.1
 */
// Model context window sizes (from Claude 4.5 API docs)
const MODEL_CONTEXT_WINDOWS = {
    'claude-sonnet-4-5-20250929': 200000,
    'claude-haiku-4-5-20251001': 200000,
    'claude-sonnet-4-5': 200000,
    'claude-haiku-4-5': 200000,
    // Legacy 3.x models for backward compatibility
    'claude-3-5-sonnet-20241022': 200000,
    'claude-3-5-haiku-20241022': 200000,
    'claude-3-opus-20240229': 200000,
    'claude-3-sonnet-20240229': 200000
};
export class ContextAwarenessService {
    constructor() {
        this.sessions = new Map();
    }
    /**
     * Initialize context tracking for a new session
     */
    initializeSession(sessionId, model) {
        const contextWindow = MODEL_CONTEXT_WINDOWS[model] || 200000;
        const metrics = {
            sessionId,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            contextWindowSize: contextWindow,
            currentUsage: 0,
            remainingCapacity: contextWindow,
            utilizationPercent: 0,
            lastUpdate: new Date()
        };
        this.sessions.set(sessionId, metrics);
        return metrics;
    }
    /**
     * Update context metrics after each API call
     * Claude 4.5 provides token usage in response.usage
     */
    updateFromAPIResponse(sessionId, inputTokens, outputTokens) {
        const metrics = this.sessions.get(sessionId);
        if (!metrics) {
            throw new Error(`Session ${sessionId} not initialized`);
        }
        // Accumulate tokens
        metrics.totalInputTokens += inputTokens;
        metrics.totalOutputTokens += outputTokens;
        // Estimate current context usage (conversation history grows)
        // In practice, context = sum of all messages in conversation
        metrics.currentUsage = metrics.totalInputTokens + metrics.totalOutputTokens;
        metrics.remainingCapacity = metrics.contextWindowSize - metrics.currentUsage;
        metrics.utilizationPercent = (metrics.currentUsage / metrics.contextWindowSize) * 100;
        metrics.lastUpdate = new Date();
        return metrics;
    }
    /**
     * Get intelligent decision about context management
     */
    getContextDecision(sessionId) {
        const metrics = this.sessions.get(sessionId);
        if (!metrics) {
            throw new Error(`Session ${sessionId} not initialized`);
        }
        const utilizationPercent = metrics.utilizationPercent;
        // CRITICAL: 90%+ used - emergency action needed
        if (utilizationPercent >= 90) {
            return {
                action: 'emergency_flush',
                reason: 'Context window 90%+ full - risk of hitting hard limit',
                recommendedClearance: Math.floor(metrics.contextWindowSize * 0.5), // Clear 50%
                priority: 'critical'
            };
        }
        // HIGH: 75-90% used - proactive cleanup
        if (utilizationPercent >= 75) {
            return {
                action: 'clear_old_data',
                reason: 'Context window 75%+ full - clear old tool calls and results',
                recommendedClearance: Math.floor(metrics.contextWindowSize * 0.3), // Clear 30%
                priority: 'high'
            };
        }
        // MEDIUM: 50-75% used - save state for recovery
        if (utilizationPercent >= 50) {
            return {
                action: 'save_state',
                reason: 'Context window 50%+ full - save state to external storage',
                recommendedClearance: 0,
                priority: 'medium'
            };
        }
        // LOW: <50% used - continue normally
        return {
            action: 'continue',
            reason: `Context window ${utilizationPercent.toFixed(1)}% full - plenty of space remaining`,
            recommendedClearance: 0,
            priority: 'low'
        };
    }
    /**
     * Get metrics for a session
     */
    getMetrics(sessionId) {
        return this.sessions.get(sessionId) || null;
    }
    /**
     * Simulate context clearing (after external state save)
     */
    clearContext(sessionId, tokensToClear) {
        const metrics = this.sessions.get(sessionId);
        if (!metrics) {
            throw new Error(`Session ${sessionId} not initialized`);
        }
        // Reduce current usage (simulating clearing old messages)
        metrics.currentUsage = Math.max(0, metrics.currentUsage - tokensToClear);
        metrics.remainingCapacity = metrics.contextWindowSize - metrics.currentUsage;
        metrics.utilizationPercent = (metrics.currentUsage / metrics.contextWindowSize) * 100;
        metrics.lastUpdate = new Date();
        return metrics;
    }
    /**
     * Get all active sessions
     */
    getAllSessions() {
        return Array.from(this.sessions.values());
    }
    /**
     * Remove session (cleanup)
     */
    removeSession(sessionId) {
        return this.sessions.delete(sessionId);
    }
    /**
     * Get recommendations for multi-context-window workflows
     * (when agent needs to work across multiple "windows" of conversation)
     */
    getMultiWindowRecommendation(sessionId) {
        const decision = this.getContextDecision(sessionId);
        if (decision.priority === 'critical' || decision.priority === 'high') {
            return {
                shouldCreateNewWindow: true,
                reason: decision.reason,
                strategy: 'Save current state to memory tool, start fresh conversation window with state summary'
            };
        }
        return {
            shouldCreateNewWindow: false,
            reason: 'Current context window has sufficient capacity',
            strategy: 'Continue in current conversation window'
        };
    }
    /**
     * Estimate tokens for planned operation
     * Helps agent decide if operation fits in remaining context
     */
    canFitOperation(sessionId, estimatedTokens) {
        const metrics = this.sessions.get(sessionId);
        if (!metrics) {
            throw new Error(`Session ${sessionId} not initialized`);
        }
        const canFit = metrics.remainingCapacity >= estimatedTokens;
        const utilizationAfter = ((metrics.currentUsage + estimatedTokens) / metrics.contextWindowSize) * 100;
        let recommendation;
        if (!canFit) {
            recommendation = 'Operation exceeds remaining capacity - clear context first';
        }
        else if (utilizationAfter > 85) {
            recommendation = 'Operation fits but will push context usage above 85% - consider state save';
        }
        else {
            recommendation = 'Operation fits comfortably - proceed';
        }
        return {
            canFit,
            utilizationAfter,
            recommendation
        };
    }
}
// Singleton instance
let contextAwarenessInstance = null;
/**
 * Get or create the context awareness service singleton
 */
export function getContextAwarenessService() {
    if (!contextAwarenessInstance) {
        contextAwarenessInstance = new ContextAwarenessService();
    }
    return contextAwarenessInstance;
}
