import {
    LiveTradingConfig,
    LiveTradingSession,
    RiskLimits,
    liveTradingService
} from '@/services/liveTradingService';
import { ConfidenceMetrics, mockTradingService } from '@/services/mockTradingService';
import { Strategy } from '@/types';
import {
    Activity,
    AlertTriangle,
    CheckCircle,
    Settings,
    Shield,
    Square,
    StopCircle,
    Target,
    XCircle,
    Zap
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import './TradingDashboard.css';

interface LiveTradingDashboardProps {
    strategies: Strategy[];
}

const LiveTradingDashboard: React.FC<LiveTradingDashboardProps> = ({ strategies }) => {
    const [activeSessions, setActiveSessions] = useState<LiveTradingSession[]>([]);
    const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
    const [confidenceMetrics, setConfidenceMetrics] = useState<ConfidenceMetrics | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [showRiskSettings, setShowRiskSettings] = useState(false);
    const [riskLimits, setRiskLimits] = useState<RiskLimits>({
        maxDrawdownPercent: 0.15, // 15% max drawdown
        maxDailyLossPercent: 0.05, // 5% max daily loss
        maxPositionSize: 1000, // $1000 max position
        maxOpenPositions: 3, // Max 3 open positions
        stopTradingOnLoss: 500, // Stop after $500 loss
        requireConfidenceScore: 75, // 75% minimum confidence
        emergencyStopEnabled: true,
    });

    // Initialize with first strategy
    useEffect(() => {
        if (strategies.length > 0 && !selectedStrategy)
        {
            setSelectedStrategy(strategies[0]);
        }
    }, [strategies, selectedStrategy]);

    // Update confidence metrics when strategy changes
    useEffect(() => {
        if (selectedStrategy)
        {
            const confidence = mockTradingService.getStrategyConfidenceAggregate(selectedStrategy.id);
            setConfidenceMetrics(confidence);
        }
    }, [selectedStrategy]);

    // Update active sessions periodically
    useEffect(() => {
        const updateInterval = setInterval(() => {
            const sessions = liveTradingService.getActiveLiveTradingSessions();
            setActiveSessions(sessions);
        }, 2000);

        return () => clearInterval(updateInterval);
    }, []);

    const handleStartLiveTrading = async () => {
        if (!selectedStrategy || !confidenceMetrics) return;

        if (confidenceMetrics.recommendation !== 'READY_FOR_LIVE')
        {
            alert('Strategy must complete mock trading with "READY FOR LIVE" status before live trading can begin.');
            return;
        }

        setIsStarting(true);
        try
        {
            const config: LiveTradingConfig = {
                strategy: selectedStrategy,
                initialBalance: 5000, // $5k initial
                riskLimits,
                autoStopOnFailure: true,
                notificationSettings: {
                    tradeAlerts: true,
                    riskAlerts: true,
                    emergencyAlerts: true,
                },
            };

            await liveTradingService.startLiveTrading(config);

            // Update sessions
            const sessions = liveTradingService.getActiveLiveTradingSessions();
            setActiveSessions(sessions);
        } catch (error)
        {
            alert(`Failed to start live trading: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally
        {
            setIsStarting(false);
        }
    };

    const handleStopLiveTrading = async (sessionId: string) => {
        try
        {
            await liveTradingService.stopLiveTrading(sessionId, 'Manual stop');

            // Update sessions
            const sessions = liveTradingService.getActiveLiveTradingSessions();
            setActiveSessions(sessions);
        } catch (error)
        {
            alert(`Failed to stop live trading: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    const handleEmergencyStop = async () => {
        if (confirm('This will immediately stop ALL live trading sessions. Are you sure?'))
        {
            try
            {
                await liveTradingService.emergencyStopAll('User emergency stop');

                // Update sessions
                const sessions = liveTradingService.getActiveLiveTradingSessions();
                setActiveSessions(sessions);
            } catch
            {
                // Handle error
            }
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    };


    const isLiveEnabled = confidenceMetrics?.recommendation === 'READY_FOR_LIVE' &&
        confidenceMetrics?.overall >= riskLimits.requireConfidenceScore;

    return (
        <div className="container-responsive">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-neutral-800">Live Trading Control Center</h1>
                    <p className="text-neutral-600 mt-1">
                        Execute real trades with capital - requires proven confidence from mock trading
                    </p>
                </div>

                <div className="flex items-center space-x-4">
                    {/* Emergency Stop */}
                    {activeSessions.length > 0 && (
                        <button
                            onClick={handleEmergencyStop}
                            className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                            <StopCircle size={16} />
                            <span>Emergency Stop All</span>
                        </button>
                    )}

                    {/* Risk Settings */}
                    <button
                        onClick={() => setShowRiskSettings(!showRiskSettings)}
                        className="flex items-center space-x-2 px-4 py-2 bg-neutral-600 text-white rounded-md hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500"
                    >
                        <Settings size={16} />
                        <span>Risk Settings</span>
                    </button>
                </div>
            </div>

            {/* Risk Settings Panel */}
            {showRiskSettings && (
                <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-6 mb-6">
                    <h3 className="text-lg font-medium text-neutral-800 mb-4">Risk Management Settings</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">
                                Max Drawdown (%)
                            </label>
                            <input
                                type="number"
                                min="5"
                                max="30"
                                step="1"
                                value={riskLimits.maxDrawdownPercent * 100}
                                onChange={(e) => setRiskLimits({
                                    ...riskLimits,
                                    maxDrawdownPercent: parseFloat(e.target.value) / 100
                                })}
                                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                aria-label="Maximum Drawdown Percentage"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">
                                Max Daily Loss (%)
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                step="0.5"
                                value={riskLimits.maxDailyLossPercent * 100}
                                onChange={(e) => setRiskLimits({
                                    ...riskLimits,
                                    maxDailyLossPercent: parseFloat(e.target.value) / 100
                                })}
                                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                aria-label="Maximum Daily Loss Percentage"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">
                                Max Position Size ($)
                            </label>
                            <input
                                type="number"
                                min="100"
                                max="10000"
                                step="100"
                                value={riskLimits.maxPositionSize}
                                onChange={(e) => setRiskLimits({
                                    ...riskLimits,
                                    maxPositionSize: parseFloat(e.target.value)
                                })}
                                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                aria-label="Maximum Position Size in USD"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">
                                Max Open Positions
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                step="1"
                                value={riskLimits.maxOpenPositions}
                                onChange={(e) => setRiskLimits({
                                    ...riskLimits,
                                    maxOpenPositions: parseInt(e.target.value)
                                })}
                                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                aria-label="Maximum Open Positions"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">
                                Min Confidence Score (%)
                            </label>
                            <input
                                type="number"
                                min="60"
                                max="95"
                                step="5"
                                value={riskLimits.requireConfidenceScore}
                                onChange={(e) => setRiskLimits({
                                    ...riskLimits,
                                    requireConfidenceScore: parseInt(e.target.value)
                                })}
                                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                aria-label="Minimum Confidence Score Percentage"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Strategy Selection & Start Panel */}
            <div className="trading-card mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-neutral-800">Strategy Selection</h3>

                    {confidenceMetrics && (
                        <div className={`flex items-center space-x-2 px-3 py-1 rounded-full border ${isLiveEnabled
                            ? 'bg-green-50 border-green-200 text-green-800'
                            : 'bg-red-50 border-red-200 text-red-800'
                            }`}>
                            {isLiveEnabled ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                            )}
                            <span className="text-sm font-medium">
                                {isLiveEnabled ? 'Ready for Live' : 'Not Ready'}
                            </span>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-2">
                            Select Strategy for Live Trading
                        </label>
                        <select
                            aria-label="Select Strategy for Live Trading"
                            value={selectedStrategy?.id || ''}
                            onChange={(e) => {
                                const strategy = strategies.find(s => s.id === e.target.value);
                                setSelectedStrategy(strategy || null);
                            }}
                            className="block w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="">Select Strategy</option>
                            {strategies.map(strategy => (
                                <option key={strategy.id} value={strategy.id}>
                                    {strategy.name}
                                </option>
                            ))}
                        </select>

                        {selectedStrategy && confidenceMetrics && (
                            <div className="mt-4 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-neutral-600">Overall Confidence:</span>
                                    <span className={`font-semibold ${confidenceMetrics.overall >= 75 ? 'text-green-600' : 'text-red-600'
                                        }`}>
                                        {confidenceMetrics.overall}%
                                    </span>
                                </div>

                                <div className="flex justify-between text-sm">
                                    <span className="text-neutral-600">Recommendation:</span>
                                    <span className={`font-semibold ${confidenceMetrics.recommendation === 'READY_FOR_LIVE' ? 'text-green-600' : 'text-red-600'
                                        }`}>
                                        {confidenceMetrics.recommendation.replace('_', ' ')}
                                    </span>
                                </div>

                                <div className="progress-bar-container mt-3">
                                    <div
                                        className={`progress-bar-fill ${confidenceMetrics.overall >= 75 ? 'green' : 'red'}`}
                                        style={{ '--progress-width': `${confidenceMetrics.overall}%` } as React.CSSProperties}
                                    ></div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col justify-center">
                        {selectedStrategy && isLiveEnabled ? (
                            <button
                                onClick={handleStartLiveTrading}
                                disabled={isStarting || activeSessions.some(s => s.strategyId === selectedStrategy.id)}
                                className="flex items-center justify-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Zap size={20} />
                                <span className="text-lg font-medium">
                                    {isStarting ? 'Starting Live Trading...' : 'Start Live Trading'}
                                </span>
                            </button>
                        ) : (
                            <div className="text-center p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                                <AlertTriangle className="h-8 w-8 text-yellow-600 mx-auto mb-2" />
                                <p className="text-sm text-yellow-700 font-medium">
                                    {!selectedStrategy
                                        ? 'Select a strategy to continue'
                                        : 'Strategy must achieve 75%+ confidence through mock trading first'
                                    }
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Active Live Trading Sessions */}
            <div className="space-y-6">
                <h3 className="text-lg font-medium text-neutral-800">Active Live Trading Sessions</h3>

                {activeSessions.length === 0 ? (
                    <div className="text-center py-12">
                        <Target className="h-16 w-16 text-neutral-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-neutral-800 mb-2">No Active Live Trading Sessions</h3>
                        <p className="text-neutral-600">
                            Start a live trading session with a proven strategy to begin real trading
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {activeSessions.map(session => {
                            const strategy = strategies.find(s => s.id === session.strategyId);
                            const pnl = session.currentBalance - session.initialBalance;
                            const pnlPercent = (pnl / session.initialBalance) * 100;
                            const runtime = (Date.now() - session.startTime) / (1000 * 60 * 60); // hours

                            return (
                                <div key={session.id} className="trading-card">
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <h4 className="text-lg font-medium text-neutral-800">
                                                {strategy?.name || 'Unknown Strategy'}
                                            </h4>
                                            <div className="flex items-center space-x-2 mt-1">
                                                <Activity className="h-4 w-4 text-green-500" />
                                                <span className="text-sm text-green-600">Live Trading</span>
                                                <span className="text-sm text-neutral-500">•</span>
                                                <span className="text-sm text-neutral-500">
                                                    {runtime.toFixed(1)}h runtime
                                                </span>
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => handleStopLiveTrading(session.id)}
                                            className="flex items-center space-x-2 px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                                        >
                                            <Square size={14} />
                                            <span>Stop</span>
                                        </button>
                                    </div>

                                    {/* Performance Metrics */}
                                    <div className="grid grid-cols-2 gap-4 mb-4">
                                        <div className="text-center">
                                            <div className="text-2xl font-bold text-neutral-800">
                                                {formatCurrency(session.currentBalance)}
                                            </div>
                                            <div className="text-sm text-neutral-500">Current Balance</div>
                                        </div>

                                        <div className="text-center">
                                            <div className={`text-2xl font-bold ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                                            </div>
                                            <div className="text-sm text-neutral-500">
                                                P&L ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                                            </div>
                                        </div>
                                    </div>

                                    {/* Trading Stats */}
                                    <div className="grid grid-cols-3 gap-3 mb-4 pt-4 border-t border-neutral-200">
                                        <div className="text-center">
                                            <div className="text-lg font-semibold text-neutral-800">{session.totalTrades}</div>
                                            <div className="text-xs text-neutral-500">Total</div>
                                        </div>

                                        <div className="text-center">
                                            <div className="text-lg font-semibold text-green-600">{session.winningTrades}</div>
                                            <div className="text-xs text-neutral-500">Wins</div>
                                        </div>

                                        <div className="text-center">
                                            <div className="text-lg font-semibold text-red-600">{session.losingTrades}</div>
                                            <div className="text-xs text-neutral-500">Losses</div>
                                        </div>
                                    </div>

                                    {/* Safety Status */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-neutral-600">Drawdown Protection:</span>
                                            <div className="flex items-center space-x-1">
                                                {session.safetyChecks.drawdownWithinLimits ? (
                                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                                ) : (
                                                    <XCircle className="h-4 w-4 text-red-500" />
                                                )}
                                                <span className={session.safetyChecks.drawdownWithinLimits ? 'text-green-600' : 'text-red-600'}>
                                                    {session.safetyChecks.drawdownWithinLimits ? 'Active' : 'Breached'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-neutral-600">Daily Loss Protection:</span>
                                            <div className="flex items-center space-x-1">
                                                {session.safetyChecks.dailyLossWithinLimits ? (
                                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                                ) : (
                                                    <XCircle className="h-4 w-4 text-red-500" />
                                                )}
                                                <span className={session.safetyChecks.dailyLossWithinLimits ? 'text-green-600' : 'text-red-600'}>
                                                    {session.safetyChecks.dailyLossWithinLimits ? 'Active' : 'Breached'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Safety Information */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-8">
                <div className="flex items-start space-x-3">
                    <Shield className="h-6 w-6 text-blue-600 mt-1" />
                    <div>
                        <h4 className="text-lg font-medium text-blue-800 mb-2">Live Trading Safety Features</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-700">
                            <div>
                                <strong>Real-time Risk Monitoring:</strong> Continuous drawdown and loss limit monitoring with automatic session termination
                            </div>
                            <div>
                                <strong>Confidence-Based Activation:</strong> Only strategies with 75%+ mock trading confidence can go live
                            </div>
                            <div>
                                <strong>Position Size Management:</strong> Conservative 1% risk per trade with configurable limits
                            </div>
                            <div>
                                <strong>Emergency Stop:</strong> Instant shutdown of all live trading across all strategies
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LiveTradingDashboard;
