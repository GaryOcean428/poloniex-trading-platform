import {
    AutonomousSession,
    AutonomousSettings,
    autonomousTradingEngine
} from '@/services/autonomousTradingEngine';
import {
    AlertTriangle,
    Bell,
    Brain,
    CheckCircle,
    Info,
    Play,
    Settings,
    Shield,
    Square,
    Target,
    TrendingUp,
    X
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

const AutonomousTradingDashboard: React.FC = () => {
    const [session, setSession] = useState<AutonomousSession | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [settings, setSettings] = useState<AutonomousSettings>({
        initialBalance: 10000,
        maxRiskPerTrade: 0.02, // 2%
        maxDrawdown: 0.15, // 15%
        confidenceThreshold: 75, // 75%
        profitTarget: 0.20, // 20% monthly
        timeHorizon: 30, // 30 days
        aggressiveness: 'moderate',
        autoProgressToLive: false,
        stopLossGlobal: 0.05, // 5%
        takeProfitGlobal: 0.10 // 10%
    });
    const [showSettings, setShowSettings] = useState(false);

    // Poll for session updates
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (session?.isActive)
        {
            interval = setInterval(() => {
                const updatedSession = autonomousTradingEngine.getAutonomousSession(session.id);
                if (updatedSession)
                {
                    setSession(updatedSession);
                }
            }, 2000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [session?.id, session?.isActive]);

    const handleStartAutonomous = async () => {
        setLoading(true);
        setError(null);

        try
        {
            const sessionId = await autonomousTradingEngine.startAutonomousTrading(
                'user_123', // In real app, get from auth context
                settings
            );

            const newSession = autonomousTradingEngine.getAutonomousSession(sessionId);
            setSession(newSession);
        } catch (err)
        {
            setError(err instanceof Error ? err.message : 'Failed to start autonomous trading');
        } finally
        {
            setLoading(false);
        }
    };

    const handleStopAutonomous = async () => {
        if (!session) return;

        setLoading(true);
        try
        {
            await autonomousTradingEngine.stopAutonomousTrading(session.id);
            const updatedSession = autonomousTradingEngine.getAutonomousSession(session.id);
            setSession(updatedSession);
        } catch (err)
        {
            setError(err instanceof Error ? err.message : 'Failed to stop autonomous trading');
        } finally
        {
            setLoading(false);
        }
    };

    const getPhaseIcon = (phase: string) => {
        switch (phase)
        {
            case 'INITIALIZATION': return <Settings className="h-5 w-5" />;
            case 'STRATEGY_GENERATION': return <Brain className="h-5 w-5" />;
            case 'BACKTESTING': return <TrendingUp className="h-5 w-5" />;
            case 'STRATEGY_OPTIMIZATION': return <Target className="h-5 w-5" />;
            case 'MOCK_TRADING': return <Play className="h-5 w-5" />;
            case 'CONFIDENCE_EVALUATION': return <CheckCircle className="h-5 w-5" />;
            case 'READY_FOR_LIVE': return <Shield className="h-5 w-5" />;
            case 'LIVE_TRADING': return <TrendingUp className="h-5 w-5 text-green-500" />;
            case 'LEARNING_ADAPTATION': return <Brain className="h-5 w-5" />;
            case 'PROFIT_MAXIMIZATION': return <Target className="h-5 w-5 text-green-500" />;
            default: return <Info className="h-5 w-5" />;
        }
    };

    const getNotificationIcon = (type: string) => {
        switch (type)
        {
            case 'SUCCESS': return <CheckCircle className="h-5 w-5 text-green-500" />;
            case 'WARNING': return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
            case 'CRITICAL': return <X className="h-5 w-5 text-red-500" />;
            default: return <Info className="h-5 w-5 text-blue-500" />;
        }
    };

    const formatPhase = (phase: string) => {
        return phase.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-6 text-white">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center">
                            <Brain className="h-8 w-8 mr-3" />
                            Autonomous Trading System
                        </h1>
                        <p className="mt-2 opacity-90">
                            AI-powered trading that learns, adapts, and maximizes profits autonomously
                        </p>
                    </div>
                    <div className="flex space-x-3">
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg flex items-center focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-600"
                            aria-expanded={showSettings}
                            aria-controls="settings-panel"
                            aria-label={`${showSettings ? 'Hide' : 'Show'} settings panel`}
                        >
                            <Settings className="h-4 w-4 mr-2" aria-hidden="true" />
                            Settings
                        </button>
                        {!session?.isActive ? (
                            <button
                                onClick={handleStartAutonomous}
                                disabled={loading}
                                className="bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg font-medium flex items-center disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-blue-600"
                                aria-busy={loading}
                                aria-live="polite"
                            >
                                {loading ? (
                                    <>
                                        <span className="mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                                        <span>Starting...</span>
                                    </>
                                ) : (
                                    <>
                                        <Play className="h-4 w-4 mr-2" aria-hidden="true" />
                                        <span>Start Autonomous Trading</span>
                                    </>
                                )}
                                <span className="sr-only">Start autonomous trading with current settings</span>
                            </button>
                        ) : (
                            <button
                                onClick={handleStopAutonomous}
                                disabled={loading}
                                className="bg-red-600 hover:bg-red-700 px-6 py-2 rounded-lg font-medium flex items-center disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-blue-600"
                                aria-busy={loading}
                                aria-live="polite"
                            >
                                {loading ? (
                                    <>
                                        <span className="mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                                        <span>Stopping...</span>
                                    </>
                                ) : (
                                    <>
                                        <Square className="h-4 w-4 mr-2" aria-hidden="true" />
                                        <span>Stop Trading</span>
                                    </>
                                )}
                                <span className="sr-only">Stop the current autonomous trading session</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg" role="alert">
                    <div className="flex">
                        <X className="h-5 w-5 text-red-500 mr-3 flex-shrink-0" />
                        <div>
                            <p className="text-red-700 font-medium">Error</p>
                            <p className="text-red-600 text-sm mt-1">{error}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Settings Panel */}
            <div id="settings-panel" role="region" aria-labelledby="settings-heading">
                {showSettings && (
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h3 id="settings-heading" className="text-lg font-medium mb-4">Autonomous Trading Settings</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="initial-balance">
                                    Initial Balance ($)
                                </label>
                                <input
                                    id="initial-balance"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={settings.initialBalance}
                                    onChange={(e) => setSettings({ ...settings, initialBalance: parseFloat(e.target.value) })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    aria-describedby="initial-balance-help"
                                />
                                <p id="initial-balance-help" className="mt-1 text-xs text-gray-500">
                                    The initial amount of money to start with
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="max-risk">
                                    Max Risk Per Trade (%)
                                </label>
                                <input
                                    id="max-risk"
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    max="10"
                                    value={settings.maxRiskPerTrade * 100}
                                    onChange={(e) => setSettings({ ...settings, maxRiskPerTrade: parseFloat(e.target.value) / 100 })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    aria-describedby="max-risk-help"
                                />
                                <p id="max-risk-help" className="mt-1 text-xs text-gray-500">
                                    Maximum risk per trade as a percentage of the total balance
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="max-drawdown">
                                    Max Drawdown (%)
                                </label>
                                <input
                                    id="max-drawdown"
                                    type="number"
                                    step="0.1"
                                    min="1"
                                    max="50"
                                    value={settings.maxDrawdown * 100}
                                    onChange={(e) => setSettings({ ...settings, maxDrawdown: parseFloat(e.target.value) / 100 })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    aria-describedby="max-drawdown-help"
                                />
                                <p id="max-drawdown-help" className="mt-1 text-xs text-gray-500">
                                    Maximum allowed drawdown before taking protective action
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="confidence-threshold">
                                    Confidence Threshold (%)
                                </label>
                                <input
                                    id="confidence-threshold"
                                    type="number"
                                    min="50"
                                    max="100"
                                    value={settings.confidenceThreshold}
                                    onChange={(e) => setSettings({ ...settings, confidenceThreshold: parseFloat(e.target.value) })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    aria-describedby="confidence-threshold-help"
                                />
                                <p id="confidence-threshold-help" className="mt-1 text-xs text-gray-500">
                                    Minimum confidence level required for trade execution (50-100%)
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="profit-target">
                                    Profit Target (%)
                                </label>
                                <input
                                    id="profit-target"
                                    type="number"
                                    step="0.1"
                                    min="1"
                                    max="100"
                                    value={settings.profitTarget * 100}
                                    onChange={(e) => setSettings({ ...settings, profitTarget: parseFloat(e.target.value) / 100 })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    aria-describedby="profit-target-help"
                                />
                                <p id="profit-target-help" className="mt-1 text-xs text-gray-500">
                                    Monthly profit target as a percentage of the total balance
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="aggressiveness">
                                    Aggressiveness
                                </label>
                                <select
                                    id="aggressiveness"
                                    value={settings.aggressiveness}
                                    onChange={(e) => setSettings({ ...settings, aggressiveness: e.target.value as any })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    aria-describedby="aggressiveness-help"
                                >
                                    <option value="conservative">Conservative</option>
                                    <option value="moderate">Moderate</option>
                                    <option value="aggressive">Aggressive</option>
                                </select>
                                <p id="aggressiveness-help" className="mt-1 text-xs text-gray-500">
                                    Controls the risk level of the trading strategy
                                </p>
                            </div>
                            <div className="md:col-span-2 lg:col-span-3">
                                <div className="flex items-start">
                                    <div className="flex items-center h-5">
                                        <input
                                            id="auto-progress"
                                            type="checkbox"
                                            checked={settings.autoProgressToLive}
                                            onChange={(e) => setSettings({ ...settings, autoProgressToLive: e.target.checked })}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                            aria-describedby="auto-progress-help"
                                        />
                                    </div>
                                    <div className="ml-3 text-sm">
                                        <label htmlFor="auto-progress" className="font-medium text-gray-700">
                                            Auto-progress to live trading
                                        </label>
                                        <p id="auto-progress-help" className="text-gray-500">
                                            Automatically progress to live trading when confidence threshold is met
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Session Status */}
                {session && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Current Phase */}
                        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
                            <h3 className="text-lg font-medium mb-4">Current Phase</h3>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                    {getPhaseIcon(session.currentPhase)}
                                    <div className="ml-3">
                                        <h4 className="font-medium">{formatPhase(session.currentPhase)}</h4>
                                        <p className="text-sm text-gray-500">
                                            {session.isActive ? 'Active' : 'Stopped'}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-2xl font-bold text-green-600">
                                        {session.performance.confidenceScore.toFixed(1)}%
                                    </p>
                                    <p className="text-sm text-gray-500">Confidence Score</p>
                                </div>
                            </div>

                            {/* Progress Bar */}
                            <div className="mt-4">
                                <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>Progress to Live Trading</span>
                                    <span>{session.performance.confidenceScore.toFixed(1)}% / {settings.confidenceThreshold}%</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div
                                        className={`h-2 rounded-full transition-all duration-500 ${
                                            session.performance.confidenceScore >= settings.confidenceThreshold
                                                ? 'bg-green-500'
                                                : 'bg-blue-500'
                                        }`}
                                        style={{ 
                                            width: `${Math.min(100, (session.performance.confidenceScore / settings.confidenceThreshold) * 100)}%` 
                                        }}
                                        role="progressbar"
                                        aria-valuenow={session.performance.confidenceScore}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-label="Progress to live trading"
                                    />
                                </div>
                                <div className="mt-3">
                                    <div className="flex items-start">
                                        <div className="flex items-center h-5">
                                            <input
                                                id="auto-progress"
                                                type="checkbox"
                                                checked={settings.autoProgressToLive}
                                                onChange={(e) => setSettings({ ...settings, autoProgressToLive: e.target.checked })}
                                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                                aria-describedby="auto-progress-help"
                                            />
                                        </div>
                                        <div className="ml-3 text-sm">
                                            <label htmlFor="auto-progress" className="font-medium text-gray-700">
                                                Auto-progress to live trading
                                            </label>
                                            <p id="auto-progress-help" className="text-gray-500">
                                                Automatically progress to live trading when confidence threshold is met
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Performance Metrics */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                            <div className="text-center">
                                <p className="text-2xl font-bold">{session.strategies.length}</p>
                                <p className="text-sm text-gray-500">Strategies</p>
                            </div>
                            <div className="text-center">
                                <p className="text-2xl font-bold">${session.performance.totalPnL.toFixed(2)}</p>
                                <p className="text-sm text-gray-500">Total P&L</p>
                            </div>
                            <div className="text-center">
                                <p className="text-2xl font-bold">{(session.performance.winRate * 100).toFixed(1)}%</p>
                                <p className="text-sm text-gray-500">Win Rate</p>
                            </div>
                            <div className="text-center">
                                <p className="text-2xl font-bold">{(session.performance.maxDrawdown * 100).toFixed(1)}%</p>
                                <p className="text-sm text-gray-500">Max Drawdown</p>
                            </div>
                        </div>
                    </div>

                    {/* Notifications */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-medium">Activity Feed</h3>
                            <Bell className="h-5 w-5 text-gray-400" />
                        </div>
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {session.notifications.slice(-10).reverse().map((notification) => (
                                <div key={notification.id} className="flex items-start space-x-3 p-3 rounded-lg bg-gray-50">
                                    {getNotificationIcon(notification.type)}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900">{notification.title}</p>
                                        <p className="text-xs text-gray-500 mt-1">{notification.message}</p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            {new Date(notification.timestamp).toLocaleTimeString()}
                                        </p>
                                        {notification.action && (
                                            <button
                                                onClick={notification.action.callback}
                                                className="text-xs text-blue-600 hover:text-blue-800 mt-1"
                                            >
                                                {notification.action.label}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {session.notifications.length === 0 && (
                                <p className="text-sm text-gray-500 text-center py-4">No notifications yet</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Strategy Overview */}
            {session && session.strategies.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-medium mb-4">Strategy Performance</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead>
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Strategy
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Confidence
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Profit Potential
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Risk Score
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Status
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {session.strategies.map((strategy, index) => (
                                    <tr key={strategy.id} className={index === 0 ? 'bg-green-50' : ''}>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div>
                                                <div className="text-sm font-medium text-gray-900">{strategy.name}</div>
                                                <div className="text-sm text-gray-500">{strategy.description}</div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{(strategy.confidence * 100).toFixed(1)}%</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{(strategy.profitPotential * 100).toFixed(2)}%</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{(strategy.riskScore * 100).toFixed(2)}%</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${index === 0
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                {index === 0 ? 'Active' : 'Standby'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Getting Started */}
            {!session && (
                <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
                    <Brain className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Ready to Start Autonomous Trading?</h3>
                    <p className="text-gray-500 mb-6 max-w-2xl mx-auto">
                        Our AI system will analyze markets, generate optimized strategies, backtest them,
                        run mock trading to build confidence, and when ready, trade with real funds to maximize your profits.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto mb-6">
                        <div className="p-4 border border-gray-200 rounded-lg">
                            <TrendingUp className="h-8 w-8 mx-auto text-blue-500 mb-2" />
                            <h4 className="font-medium">Smart Analysis</h4>
                            <p className="text-sm text-gray-500">AI analyzes market conditions and generates optimal strategies</p>
                        </div>
                        <div className="p-4 border border-gray-200 rounded-lg">
                            <Shield className="h-8 w-8 mx-auto text-green-500 mb-2" />
                            <h4 className="font-medium">Risk-Controlled</h4>
                            <p className="text-sm text-gray-500">Comprehensive safety checks and risk management systems</p>
                        </div>
                        <div className="p-4 border border-gray-200 rounded-lg">
                            <Target className="h-8 w-8 mx-auto text-purple-500 mb-2" />
                            <h4 className="font-medium">Profit Focused</h4>
                            <p className="text-sm text-gray-500">Continuously learns and adapts to maximize returns</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowSettings(true)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                        Configure Settings First →
                    </button>
                </div>
            )}
        </div>
    );
};

export default AutonomousTradingDashboard;
