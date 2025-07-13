import { ConfidenceMetrics, MockTradingSession, mockTradingService } from '@/services/mockTradingService';
import { Strategy } from '@/types';
import {
    Activity,
    AlertTriangle,
    BarChart3,
    CheckCircle,
    Clock,
    Play,
    Square,
    Target,
    TrendingUp,
    XCircle
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

interface MockTradingDashboardProps {
    strategies: Strategy[];
}

const MockTradingDashboard: React.FC<MockTradingDashboardProps> = ({ strategies }) => {
    const [activeSessions, setActiveSessions] = useState<Map<string, MockTradingSession>>(new Map());
    const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [confidenceMetrics, setConfidenceMetrics] = useState<Map<string, ConfidenceMetrics>>(new Map());

    // Initialize with first strategy if available
    useEffect(() => {
        if (strategies.length > 0 && !selectedStrategy)
        {
            setSelectedStrategy(strategies[0]);
        }
    }, [strategies, selectedStrategy]);

    const updateSessionsAndMetrics = () => {
        const updatedSessions = new Map<string, MockTradingSession>();
        const updatedConfidence = new Map<string, ConfidenceMetrics>();

        strategies.forEach(strategy => {
            const sessions = mockTradingService.getStrategyMockSessions(strategy.id);
            const activeSession = sessions.find(s => s.isActive);

            if (activeSession)
            {
                updatedSessions.set(strategy.id, activeSession);
                const confidence = mockTradingService.calculateConfidenceScore(activeSession);
                updatedConfidence.set(strategy.id, confidence);
            }
        });

        setActiveSessions(updatedSessions);
        setConfidenceMetrics(updatedConfidence);
    };

    // Update sessions and confidence metrics periodically
    useEffect(() => {
        const updateInterval = setInterval(() => {
            updateSessionsAndMetrics();
        }, 5000);

        return () => clearInterval(updateInterval);
    }, [updateSessionsAndMetrics]);

    const handleStartMockTrading = async () => {
        if (!selectedStrategy) return;

        setIsStarting(true);
        try
        {
            await mockTradingService.startMockSession(
                selectedStrategy,
                10000, // $10k initial balance
                {
                    maxDrawdownLimit: 0.20, // 20% max drawdown
                    stopLossPercent: 0.05,  // 5% stop loss
                    takeProfitPercent: 0.10, // 10% take profit
                    maxPositions: 5
                }
            );

            updateSessionsAndMetrics();
        } catch
        {
            // Handle error
        } finally
        {
            setIsStarting(false);
        }
    };

    const handleStopMockTrading = (strategyId: string) => {
        const session = activeSessions.get(strategyId);
        if (session)
        {
            mockTradingService.stopMockSession(session.id);
            updateSessionsAndMetrics();
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


    const getConfidenceColor = (score: number) => {
        if (score >= 75) return 'text-green-600';
        if (score >= 50) return 'text-yellow-600';
        return 'text-red-600';
    };

    const getRecommendationIcon = (recommendation: ConfidenceMetrics['recommendation']) => {
        switch (recommendation)
        {
            case 'READY_FOR_LIVE':
                return <CheckCircle className="h-5 w-5 text-green-500" />;
            case 'NEEDS_IMPROVEMENT':
                return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
            case 'HIGH_RISK':
                return <XCircle className="h-5 w-5 text-red-500" />;
            default:
                return <Clock className="h-5 w-5 text-gray-500" />;
        }
    };

    const getRecommendationColor = (recommendation: ConfidenceMetrics['recommendation']) => {
        switch (recommendation)
        {
            case 'READY_FOR_LIVE':
                return 'bg-green-50 border-green-200 text-green-800';
            case 'NEEDS_IMPROVEMENT':
                return 'bg-yellow-50 border-yellow-200 text-yellow-800';
            case 'HIGH_RISK':
                return 'bg-red-50 border-red-200 text-red-800';
            default:
                return 'bg-gray-50 border-gray-200 text-gray-800';
        }
    };

    return (
        <div className="container-responsive">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-neutral-800">Mock Trading Dashboard</h1>
                    <p className="text-neutral-600 mt-1">
                        Test strategies with live data to build confidence before live trading
                    </p>
                </div>

                <div className="flex items-center space-x-4">
                    {/* Strategy Selector */}
                    <select
                        aria-label="Select a strategy"
                        value={selectedStrategy?.id || ''}
                        onChange={(e) => {
                            const strategy = strategies.find(s => s.id === e.target.value);
                            setSelectedStrategy(strategy || null);
                        }}
                        className="block w-48 px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    >
                        <option value="">Select Strategy</option>
                        {strategies.map(strategy => (
                            <option key={strategy.id} value={strategy.id}>
                                {strategy.name}
                            </option>
                        ))}
                    </select>

                    {/* Start/Stop Button */}
                    {selectedStrategy && !activeSessions.has(selectedStrategy.id) ? (
                        <button
                            onClick={handleStartMockTrading}
                            disabled={isStarting}
                            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Play size={16} />
                            <span>{isStarting ? 'Starting...' : 'Start Mock Trading'}</span>
                        </button>
                    ) : selectedStrategy && activeSessions.has(selectedStrategy.id) ? (
                        <button
                            onClick={() => handleStopMockTrading(selectedStrategy.id)}
                            className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                            <Square size={16} />
                            <span>Stop Mock Trading</span>
                        </button>
                    ) : null}
                </div>
            </div>

            {/* Active Sessions Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {Array.from(activeSessions.entries()).map(([strategyId, session]) => {
                    const strategy = strategies.find(s => s.id === strategyId);
                    const confidence = confidenceMetrics.get(strategyId);

                    if (!strategy || !confidence) return null;

                    const pnl = session.currentBalance - session.initialBalance;
                    const pnlPercent = (pnl / session.initialBalance) * 100;
                    const runtime = (Date.now() - session.startTime) / (1000 * 60 * 60 * 24); // days

                    return (
                        <div key={strategyId} className="trading-card">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="text-lg font-medium text-neutral-800">{strategy.name}</h3>
                                    <div className="flex items-center space-x-2 mt-1">
                                        <Activity className="h-4 w-4 text-green-500" />
                                        <span className="text-sm text-green-600">Active</span>
                                        <span className="text-sm text-neutral-500">•</span>
                                        <span className="text-sm text-neutral-500">
                                            {runtime.toFixed(1)} days
                                        </span>
                                    </div>
                                </div>

                                <div className={`flex items-center space-x-2 px-3 py-1 rounded-full border ${getRecommendationColor(confidence.recommendation)}`}>
                                    {getRecommendationIcon(confidence.recommendation)}
                                    <span className="text-sm font-medium">
                                        {confidence.recommendation.replace('_', ' ')}
                                    </span>
                                </div>
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
                                    <div className="text-xs text-neutral-500">Total Trades</div>
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

                            {/* Confidence Score */}
                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-neutral-700">Confidence Score</span>
                                    <span className={`text-sm font-bold ${getConfidenceColor(confidence.overall)}`}>
                                        {confidence.overall}%
                                    </span>
                                </div>

                                <div className="w-full bg-neutral-200 rounded-full h-2">
                                    <div
                                        className={`h-2 rounded-full transition-all duration-300 ${confidence.overall >= 75 ? 'bg-green-500' :
                                            confidence.overall >= 50 ? 'bg-yellow-500' :
                                                'bg-red-500'
                                            }`}
                                        style={{ width: `${confidence.overall}%` }}
                                    ></div>
                                </div>
                            </div>

                            {/* Confidence Breakdown */}
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-neutral-600">Profitability:</span>
                                    <span className={getConfidenceColor(confidence.profitability)}>
                                        {confidence.profitability}%
                                    </span>
                                </div>

                                <div className="flex justify-between">
                                    <span className="text-neutral-600">Risk Mgmt:</span>
                                    <span className={getConfidenceColor(confidence.riskManagement)}>
                                        {confidence.riskManagement}%
                                    </span>
                                </div>

                                <div className="flex justify-between">
                                    <span className="text-neutral-600">Consistency:</span>
                                    <span className={getConfidenceColor(confidence.consistency)}>
                                        {confidence.consistency}%
                                    </span>
                                </div>

                                <div className="flex justify-between">
                                    <span className="text-neutral-600">Execution:</span>
                                    <span className={getConfidenceColor(confidence.executionQuality)}>
                                        {confidence.executionQuality}%
                                    </span>
                                </div>
                            </div>

                            {/* Readiness Checklist */}
                            <div className="mt-4 pt-3 border-t border-neutral-200">
                                <div className="text-xs font-medium text-neutral-700 mb-2">Readiness Checklist</div>
                                <div className="grid grid-cols-2 gap-1 text-xs">
                                    {Object.entries(confidence.readinessChecklist).map(([key, passed]) => (
                                        <div key={key} className="flex items-center space-x-1">
                                            {passed ? (
                                                <CheckCircle className="h-3 w-3 text-green-500" />
                                            ) : (
                                                <XCircle className="h-3 w-3 text-red-500" />
                                            )}
                                            <span className={passed ? 'text-green-600' : 'text-red-600'}>
                                                {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).replace('Test', '')}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Empty State */}
            {activeSessions.size === 0 && (
                <div className="text-center py-12">
                    <Target className="h-16 w-16 text-neutral-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-neutral-800 mb-2">No Active Mock Trading Sessions</h3>
                    <p className="text-neutral-600 mb-6">
                        Select a strategy and start mock trading to build confidence before going live
                    </p>

                    <div className="flex items-center justify-center space-x-6 text-sm text-neutral-500">
                        <div className="flex items-center space-x-2">
                            <BarChart3 className="h-4 w-4" />
                            <span>Real-time data</span>
                        </div>
                        <div className="flex items-center space-x-2">
                            <TrendingUp className="h-4 w-4" />
                            <span>Live market conditions</span>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Target className="h-4 w-4" />
                            <span>Confidence scoring</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Information Panel */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-8">
                <h4 className="text-lg font-medium text-blue-800 mb-3">Mock Trading Benefits</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-blue-700">
                    <div>
                        <strong>Risk-Free Testing:</strong> Test strategies with live market data without risking real capital
                    </div>
                    <div>
                        <strong>Confidence Building:</strong> Develop trust in strategies through proven performance metrics
                    </div>
                    <div>
                        <strong>Live Readiness:</strong> Automated assessment determines when strategies are ready for live trading
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MockTradingDashboard;
