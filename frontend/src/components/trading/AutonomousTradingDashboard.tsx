import {
    AutonomousSettings
} from '@/services/autonomousTradingEngine';
import { liveAutonomousTradingEngine, LiveAutonomousSession } from '@/services/liveAutonomousTradingEngine';
import {
    Brain,
    CheckCircle,
    Info,
    Play,
    Settings,
    Shield,
    Target,
    TrendingUp,
    X,
    Activity,
    Zap,
    PiggyBank,
    RefreshCw
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

const AutonomousTradingDashboard: React.FC = () => {
    const [session, setSession] = useState<LiveAutonomousSession | null>(null);
    const [connectionStatus, setConnectionStatus] = useState(liveAutonomousTradingEngine.getConnectionStatus());
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

    // Poll for session updates and set up event listeners
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (session?.isActive)
        {
            interval = setInterval(() => {
                const updatedSession = liveAutonomousTradingEngine.getAutonomousSession(session.id);
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

    // Set up event listeners for live updates
    useEffect(() => {
        const handleConnectionChange = () => {
            setConnectionStatus(liveAutonomousTradingEngine.getConnectionStatus());
        };

        type NotificationPayload = { notification?: { type?: string; message?: string } };
        type PerformancePayload = { sessionId?: string; performance?: LiveAutonomousSession['performance'] };

        const handleNotification = (payload: unknown) => {
            const data = payload as NotificationPayload;
            if (data.notification?.type === 'CRITICAL') {
                setError(data.notification.message ?? 'Critical error');
            }
        };

        const handlePerformanceUpdate = (payload: unknown) => {
            const data = payload as PerformancePayload;
            if (session && data.sessionId === session.id && data.performance) {
                setSession(prev => (prev ? { ...prev, performance: data.performance! } : null));
            }
        };

        liveAutonomousTradingEngine.on('connectionStateChanged', handleConnectionChange);
        liveAutonomousTradingEngine.on('notificationAdded', handleNotification);
        liveAutonomousTradingEngine.on('performanceUpdate', handlePerformanceUpdate);

        return () => {
            liveAutonomousTradingEngine.off('connectionStateChanged', handleConnectionChange);
            liveAutonomousTradingEngine.off('notificationAdded', handleNotification);
            liveAutonomousTradingEngine.off('performanceUpdate', handlePerformanceUpdate);
        };
    }, [session]);

    const handleStartAutonomous = async () => {
        setLoading(true);
        setError(null);

        try
        {
            const sessionId = await liveAutonomousTradingEngine.startAutonomousTrading(
                'user_123',
                settings
            );

            const newSession = liveAutonomousTradingEngine.getAutonomousSession(sessionId);
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
            await liveAutonomousTradingEngine.stopAutonomousTrading(session.id);
            const updatedSession = liveAutonomousTradingEngine.getAutonomousSession(session.id);
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
            case 'LIVE_TRADING': return <Zap className="h-5 w-5 text-green-500" />;
            case 'LEARNING_ADAPTATION': return <RefreshCw className="h-5 w-5" />;
            case 'PROFIT_MAXIMIZATION': return <PiggyBank className="h-5 w-5 text-green-500" />;
            default: return <Info className="h-5 w-5" />;
        }
    };

    // Removed unused getNotificationIcon function

    const formatPhase = (phase: string) => {
        return phase.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    return (
        <div className="space-y-6">
            <div className="gradient-primary rounded-lg p-8 text-text-inverse shadow-elev-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center">
                            <Brain className="h-10 w-10 mr-4" />
                            Live Autonomous Trading System
                        </h1>
                        <p className="mt-2 opacity-90 text-lg">
                            AI-powered trading that learns, adapts, and maximizes profits autonomously
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className={`px-4 py-2 rounded-full text-sm font-semibold ${
                            connectionStatus.useBackend ?
                                (connectionStatus.isConnected ? 'bg-success/20 text-text-inverse border border-success/30' : 'bg-error/20 text-text-inverse border border-error/30') :
                                'bg-warning/20 text-text-inverse border border-warning/30'
                        }`}>
                            {connectionStatus.useBackend ?
                                (connectionStatus.isConnected ? 'Live Connected' : 'Disconnected') :
                                'Mock Mode'
                            }
                        </div>
                    </div>
                    <div className="flex space-x-3">
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="bg-bg-elevated/20 hover:bg-bg-elevated/30 px-5 py-2.5 rounded-lg flex items-center font-semibold backdrop-blur-sm transition-all duration-200"
                        >
                            <Settings className="h-4 w-4 mr-2" />
                            Settings
                        </button>
                        {!session?.isActive ? (
                            <button
                                onClick={handleStartAutonomous}
                                disabled={loading}
                                className="bg-success hover:bg-success/90 px-6 py-2.5 rounded-lg font-semibold shadow-elev-2 transition-all duration-200"
                            >
                                {loading ? 'Starting...' : 'Start Autonomous Trading'}
                            </button>
                        ) : (
                            <button
                                onClick={handleStopAutonomous}
                                disabled={loading}
                                className="bg-error hover:bg-error/90 px-6 py-2.5 rounded-lg font-semibold shadow-elev-2 transition-all duration-200"
                            >
                                {loading ? 'Stopping...' : 'Stop Trading'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="bg-error/10 border-l-4 border-error p-4 rounded-lg shadow-elev-1" role="alert">
                    <div className="flex">
                        <X className="h-5 w-5 text-error mr-3" />
                        <div>
                            <p className="text-error font-semibold">Error</p>
                            <p className="text-error/80 text-sm">{error}</p>
                        </div>
                    </div>
                </div>
            )}

            {showSettings && (
                <div className="bg-bg-elevated rounded-lg border border-border-subtle p-6 shadow-elev-2">
                    <h3 className="text-xl font-semibold mb-6 text-text-primary">Autonomous Trading Settings</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                            <label htmlFor="initialBalance" className="block text-sm font-semibold mb-2 text-text-secondary">Initial Balance ($)</label>
                            <input
                                id="initialBalance"
                                type="number"
                                value={settings.initialBalance}
                                onChange={(e) => setSettings({ ...settings, initialBalance: parseFloat(e.target.value) })}
                                className="w-full border border-border-moderate rounded-lg px-4 py-2.5 bg-bg-primary text-text-primary focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20"
                                title="Initial trading balance in USD"
                                placeholder="10000"
                            />
                        </div>
                        <div>
                            <label htmlFor="maxRiskPerTrade" className="block text-sm font-semibold mb-2 text-text-secondary">Max Risk Per Trade (%)</label>
                            <input
                                id="maxRiskPerTrade"
                                type="number"
                                value={settings.maxRiskPerTrade * 100}
                                onChange={(e) => setSettings({ ...settings, maxRiskPerTrade: parseFloat(e.target.value) / 100 })}
                                className="w-full border border-border-moderate rounded-lg px-4 py-2.5 bg-bg-primary text-text-primary focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20"
                                title="Maximum risk per trade as percentage"
                                placeholder="2"
                            />
                        </div>
                        <div>
                            <label htmlFor="maxDrawdown" className="block text-sm font-semibold mb-2 text-text-secondary">Max Drawdown (%)</label>
                            <input
                                id="maxDrawdown"
                                type="number"
                                value={settings.maxDrawdown * 100}
                                onChange={(e) => setSettings({ ...settings, maxDrawdown: parseFloat(e.target.value) / 100 })}
                                className="w-full border border-border-moderate rounded-lg px-4 py-2.5 bg-bg-primary text-text-primary focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20"
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
                    <div className="lg:col-span-2 bg-bg-elevated rounded-lg border border-border-subtle p-6 shadow-elev-2">
                        <h3 className="text-xl font-semibold mb-6 text-text-primary">Current Phase</h3>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                {getPhaseIcon(session.currentPhase)}
                                <div className="ml-3">
                                    <h4 className="font-semibold text-text-primary">{formatPhase(session.currentPhase)}</h4>
                                    <p className="text-sm text-text-muted">{session.isActive ? 'Active' : 'Stopped'}</p>
                                    {session.realTimeUpdates && (
                                        <p className="text-xs text-success flex items-center font-medium">
                                            <Activity className="h-3 w-3 mr-1" />
                                            Live Updates
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-3xl font-bold text-success">{session.performance.confidenceScore.toFixed(1)}%</p>
                                <p className="text-sm text-text-muted">Confidence Score</p>
                            </div>
                        </div>

                        {/* Backend System Status */}
                        {session.backendSystemStatus && (
                            <div className="mt-4 pt-4 border-t">
                                <div className="grid grid-cols-3 gap-4 text-center">
                                    <div>
                                        <p className="text-2xl font-bold text-text-primary">{session.backendSystemStatus.generationCount}</p>
                                        <p className="text-sm text-text-muted">Generations</p>
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-text-primary">{session.backendSystemStatus.totalStrategies}</p>
                                        <p className="text-sm text-text-muted">Total Strategies</p>
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-success">{session.backendSystemStatus.activeStrategies}</p>
                                        <p className="text-sm text-text-muted">Active Strategies</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-bg-elevated rounded-lg border border-border-subtle p-6 shadow-elev-2">
                        <h3 className="text-xl font-semibold mb-6 text-text-primary">Activity Feed</h3>
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {session.notifications.length === 0 ? (
                                <p className="text-sm text-text-muted text-center">No notifications yet</p>
                            ) : (
                                session.notifications.slice(-5).map((notification) => (
                                    <div key={notification.id} className={`text-sm p-3 rounded-lg border-l-4 ${
                                        notification.type === 'CRITICAL' ? 'border-error bg-error/10' :
                                        notification.type === 'WARNING' ? 'border-warning bg-warning/10' :
                                        notification.type === 'SUCCESS' ? 'border-success bg-success/10' :
                                        'border-info bg-info/10'
                                    }`}>
                                        <div className="font-semibold text-text-primary">{notification.title}</div>
                                        <div className="text-xs text-text-secondary mt-1">{notification.message}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Performance Metrics */}
            {session && (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <div className="bg-bg-elevated p-5 rounded-lg border border-border-subtle shadow-elev-1 text-center">
                        <p className="text-3xl font-bold text-text-primary">{session.liveStrategies.length}</p>
                        <p className="text-sm text-text-muted mt-1">Live Strategies</p>
                    </div>
                    <div className="bg-bg-elevated p-5 rounded-lg border border-border-subtle shadow-elev-1 text-center">
                        <p className="text-3xl font-bold text-success">${session.performance.totalPnL.toFixed(2)}</p>
                        <p className="text-sm text-text-muted mt-1">Total P&L</p>
                    </div>
                    <div className="bg-bg-elevated p-5 rounded-lg border border-border-subtle shadow-elev-1 text-center">
                        <p className="text-3xl font-bold text-brand-cyan">{(session.performance.winRate * 100).toFixed(1)}%</p>
                        <p className="text-sm text-text-muted mt-1">Win Rate</p>
                    </div>
                    <div className="bg-bg-elevated p-5 rounded-lg border border-border-subtle shadow-elev-1 text-center">
                        <p className="text-3xl font-bold text-brand-purple">{session.performance.sharpeRatio.toFixed(2)}</p>
                        <p className="text-sm text-text-muted mt-1">Sharpe Ratio</p>
                    </div>
                    <div className="bg-bg-elevated p-5 rounded-lg border border-border-subtle shadow-elev-1 text-center">
                        <p className="text-3xl font-bold text-warning">{(session.performance.maxDrawdown * 100).toFixed(1)}%</p>
                        <p className="text-sm text-text-muted mt-1">Max Drawdown</p>
                    </div>
                </div>
            )}

            {/* Banking Status */}
            {session?.bankingStatus && (
                <div className="bg-bg-elevated rounded-lg border border-border-subtle p-6 shadow-elev-2 mt-6">
                    <h3 className="text-xl font-semibold mb-6 flex items-center text-text-primary">
                        <PiggyBank className="h-6 w-6 mr-2 text-success" />
                        Profit Banking Status
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-bg-tertiary p-5 rounded-lg border border-border-subtle text-center">
                            <p className="text-3xl font-bold text-success">${session.bankingStatus.totalBanked.toFixed(2)}</p>
                            <p className="text-sm text-text-muted mt-1">Total Banked</p>
                        </div>
                        <div className="bg-bg-tertiary p-5 rounded-lg border border-border-subtle text-center">
                            <p className="text-3xl font-bold text-brand-cyan">{session.bankingStatus.totalTransfers}</p>
                            <p className="text-sm text-text-muted mt-1">Total Transfers</p>
                        </div>
                        <div className="bg-bg-tertiary p-5 rounded-lg border border-border-subtle text-center">
                            <p className="text-sm text-text-primary font-semibold">
                                {session.bankingStatus.lastBankingTime ?
                                    new Date(session.bankingStatus.lastBankingTime).toLocaleString() :
                                    'Never'
                                }
                            </p>
                            <p className="text-sm text-text-muted mt-1">Last Banking</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Getting Started */}
            {!session && (
                <div className="bg-bg-elevated rounded-lg border border-border-subtle p-8 text-center shadow-elev-2">
                    <Brain className="h-20 w-20 mx-auto text-brand-purple mb-6" />
                    <h3 className="text-2xl font-bold mb-3 text-text-primary">Ready to Start Autonomous Trading?</h3>
                    <p className="text-text-secondary mb-8 text-lg">
                        Our AI system will analyze markets and maximize your profits.
                    </p>
                    <button
                        onClick={() => setShowSettings(true)}
                        className="text-brand-cyan hover:text-brand-cyan/80 font-semibold text-lg"
                    >
                        Configure Settings →
                    </button>
                </div>
            )}
        </div>
    );
};

export default AutonomousTradingDashboard;
