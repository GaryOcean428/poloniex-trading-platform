import {
    AutonomousSession,
    AutonomousSettings,
    autonomousTradingEngine
} from '@/services/autonomousTradingEngine';
import {
    Brain,
    CheckCircle,
    Info,
    Play,
    Settings,
    Shield,
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
        maxRiskPerTrade: 0.02,
        maxDrawdown: 0.15,
        confidenceThreshold: 75,
        profitTarget: 0.20,
        timeHorizon: 30,
        aggressiveness: 'moderate',
        autoProgressToLive: false,
        stopLossGlobal: 0.05,
        takeProfitGlobal: 0.10
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
                'user_123',
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

    // Removed unused getNotificationIcon function

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
                            className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg flex items-center"
                        >
                            <Settings className="h-4 w-4 mr-2" />
                            Settings
                        </button>
                        {!session?.isActive ? (
                            <button
                                onClick={handleStartAutonomous}
                                disabled={loading}
                                className="bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg font-medium"
                            >
                                {loading ? 'Starting...' : 'Start Autonomous Trading'}
                            </button>
                        ) : (
                            <button
                                onClick={handleStopAutonomous}
                                disabled={loading}
                                className="bg-red-600 hover:bg-red-700 px-6 py-2 rounded-lg font-medium"
                            >
                                {loading ? 'Stopping...' : 'Stop Trading'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg" role="alert">
                    <div className="flex">
                        <X className="h-5 w-5 text-red-500 mr-3" />
                        <div>
                            <p className="text-red-700 font-medium">Error</p>
                            <p className="text-red-600 text-sm">{error}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Settings Panel */}
            {showSettings && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-medium mb-4">Autonomous Trading Settings</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                            <label htmlFor="initialBalance" className="block text-sm font-medium mb-1">Initial Balance ($)</label>
                            <input
                                id="initialBalance"
                                type="number"
                                value={settings.initialBalance}
                                onChange={(e) => setSettings({ ...settings, initialBalance: parseFloat(e.target.value) })}
                                className="w-full border rounded-md px-3 py-2"
                                title="Initial trading balance in USD"
                                placeholder="10000"
                            />
                        </div>
                        <div>
                            <label htmlFor="maxRiskPerTrade" className="block text-sm font-medium mb-1">Max Risk Per Trade (%)</label>
                            <input
                                id="maxRiskPerTrade"
                                type="number"
                                value={settings.maxRiskPerTrade * 100}
                                onChange={(e) => setSettings({ ...settings, maxRiskPerTrade: parseFloat(e.target.value) / 100 })}
                                className="w-full border rounded-md px-3 py-2"
                                title="Maximum risk per trade as percentage"
                                placeholder="2"
                            />
                        </div>
                        <div>
                            <label htmlFor="maxDrawdown" className="block text-sm font-medium mb-1">Max Drawdown (%)</label>
                            <input
                                id="maxDrawdown"
                                type="number"
                                value={settings.maxDrawdown * 100}
                                onChange={(e) => setSettings({ ...settings, maxDrawdown: parseFloat(e.target.value) / 100 })}
                                className="w-full border rounded-md px-3 py-2"
                                title="Maximum acceptable drawdown percentage"
                                placeholder="15"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Session Status */}
            {session && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white rounded-lg border p-6">
                        <h3 className="text-lg font-medium mb-4">Current Phase</h3>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                {getPhaseIcon(session.currentPhase)}
                                <div className="ml-3">
                                    <h4 className="font-medium">{formatPhase(session.currentPhase)}</h4>
                                    <p className="text-sm text-gray-500">{session.isActive ? 'Active' : 'Stopped'}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-2xl font-bold text-green-600">{session.performance.confidenceScore.toFixed(1)}%</p>
                                <p className="text-sm text-gray-500">Confidence Score</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg border p-6">
                        <h3 className="text-lg font-medium mb-4">Activity Feed</h3>
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {session.notifications.length === 0 ? (
                                <p className="text-sm text-gray-500 text-center">No notifications yet</p>
                            ) : (
                                session.notifications.slice(-5).map((notification) => (
                                    <div key={notification.id} className="text-sm">
                                        {notification.title}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Performance Metrics */}
            {session && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
            )}

            {/* Getting Started */}
            {!session && (
                <div className="bg-white rounded-lg border p-6 text-center">
                    <Brain className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium mb-2">Ready to Start Autonomous Trading?</h3>
                    <p className="text-gray-500 mb-6">
                        Our AI system will analyze markets and maximize your profits.
                    </p>
                    <button
                        onClick={() => setShowSettings(true)}
                        className="text-blue-600 hover:text-blue-800"
                    >
                        Configure Settings →
                    </button>
                </div>
            )}
        </div>
    );
};

export default AutonomousTradingDashboard;
