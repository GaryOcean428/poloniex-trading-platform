import express from 'express';
const router = express.Router();
const strategies = [
    {
        id: '1',
        name: 'MA Crossover BTC-USDT',
        type: 'automated',
        algorithm: 'MovingAverageCrossover',
        active: true,
        parameters: {
            pair: 'BTC-USDT',
            timeframe: '1h',
            fastPeriod: 10,
            slowPeriod: 50
        },
        performance: {
            totalPnL: 1250.75,
            winRate: 0.65,
            tradesCount: 47,
            sharpeRatio: 1.23
        },
        createdAt: new Date('2024-01-15').toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: '2',
        name: 'RSI ETH Strategy',
        type: 'automated',
        algorithm: 'RSI',
        active: false,
        parameters: {
            pair: 'ETH-USDT',
            timeframe: '4h',
            period: 14,
            overbought: 70,
            oversold: 30
        },
        performance: {
            totalPnL: -200.25,
            winRate: 0.42,
            tradesCount: 23,
            sharpeRatio: -0.15
        },
        createdAt: new Date('2024-01-20').toISOString(),
        updatedAt: new Date().toISOString()
    }
];
router.get('/', (req, res) => {
    try {
        const { active } = req.query;
        let filteredStrategies = strategies;
        if (active !== undefined) {
            const isActive = active === 'true';
            filteredStrategies = strategies.filter(strategy => strategy.active === isActive);
        }
        res.json({
            success: true,
            data: filteredStrategies,
            count: filteredStrategies.length
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            success: false,
            error: 'Failed to fetch strategies',
            message: errorMessage
        });
    }
});
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const strategy = strategies.find(s => s.id === id);
        if (!strategy) {
            res.status(404).json({
                success: false,
                error: 'Strategy not found'
            });
            return;
        }
        res.json({
            success: true,
            data: strategy
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            success: false,
            error: 'Failed to fetch strategy',
            message: errorMessage
        });
    }
});
router.post('/', (req, res) => {
    try {
        const { name, type, algorithm, parameters } = req.body;
        if (!name || !type || !algorithm || !parameters) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: name, type, algorithm, parameters'
            });
            return;
        }
        const newStrategy = {
            id: (strategies.length + 1).toString(),
            name,
            type,
            algorithm,
            active: true,
            parameters,
            performance: {
                totalPnL: 0,
                winRate: 0,
                tradesCount: 0,
                sharpeRatio: 0
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        strategies.push(newStrategy);
        res.status(201).json({
            success: true,
            data: newStrategy
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            success: false,
            error: 'Failed to create strategy',
            message: errorMessage
        });
    }
});
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const strategyIndex = strategies.findIndex(s => s.id === id);
        if (strategyIndex === -1) {
            res.status(404).json({
                success: false,
                error: 'Strategy not found'
            });
            return;
        }
        const updatedStrategy = {
            ...strategies[strategyIndex],
            ...req.body,
            id,
            updatedAt: new Date().toISOString()
        };
        strategies[strategyIndex] = updatedStrategy;
        res.json({
            success: true,
            data: updatedStrategy
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            success: false,
            error: 'Failed to update strategy',
            message: errorMessage
        });
    }
});
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const strategyIndex = strategies.findIndex(s => s.id === id);
        if (strategyIndex === -1) {
            res.status(404).json({
                success: false,
                error: 'Strategy not found'
            });
            return;
        }
        strategies.splice(strategyIndex, 1);
        res.json({
            success: true,
            message: 'Strategy deleted successfully'
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            success: false,
            error: 'Failed to delete strategy',
            message: errorMessage
        });
    }
});
router.patch('/:id/activate', (req, res) => {
    try {
        const { id } = req.params;
        const strategyIndex = strategies.findIndex(s => s.id === id);
        if (strategyIndex === -1) {
            res.status(404).json({
                success: false,
                error: 'Strategy not found'
            });
            return;
        }
        strategies[strategyIndex].active = true;
        strategies[strategyIndex].updatedAt = new Date().toISOString();
        res.json({
            success: true,
            data: strategies[strategyIndex]
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            success: false,
            error: 'Failed to activate strategy',
            message: errorMessage
        });
    }
});
router.patch('/:id/deactivate', (req, res) => {
    try {
        const { id } = req.params;
        const strategyIndex = strategies.findIndex(s => s.id === id);
        if (strategyIndex === -1) {
            res.status(404).json({
                success: false,
                error: 'Strategy not found'
            });
            return;
        }
        strategies[strategyIndex].active = false;
        strategies[strategyIndex].updatedAt = new Date().toISOString();
        res.json({
            success: true,
            data: strategies[strategyIndex]
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            success: false,
            error: 'Failed to deactivate strategy',
            message: errorMessage
        });
    }
});
export default router;
