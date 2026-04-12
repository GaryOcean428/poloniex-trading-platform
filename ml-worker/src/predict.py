#!/usr/bin/env python3.11
"""
ML Prediction Bridge Script
Receives JSON input from Node.js and returns ML predictions
"""

import sys
import json
import pandas as pd
import numpy as np
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ensemble_predictor import EnsemblePredictor
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        action = input_data.get('action')
        
        if action == 'health':
            # Health check
            result = {
                'status': 'healthy',
                'models': ['LSTM', 'Transformer', 'GBM', 'ARIMA', 'Prophet']
            }
            print(json.dumps(result))
            return
        
        # Get data and convert to DataFrame
        symbol = input_data.get('symbol')
        data = pd.DataFrame(input_data.get('data', []))
        
        if data.empty:
            raise ValueError("No data provided")
        
        # Ensure required columns exist
        required_cols = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
        for col in required_cols:
            if col not in data.columns:
                raise ValueError(f"Missing required column: {col}")
        
        # Convert timestamp to datetime
        data['timestamp'] = pd.to_datetime(data['timestamp'], unit='ms')
        data = data.sort_values('timestamp')
        
        # Initialize ensemble predictor
        predictor = EnsemblePredictor()
        
        if action == 'train':
            # Train all models
            results = predictor.train_all_models(data, symbol)
            
            # Save trained models
            predictor.save_models('./saved_models')
            
            result = {
                'status': 'success',
                'symbol': symbol,
                'training_results': results,
                'data_points': len(data)
            }
            
        elif action == 'predict':
            # Load trained models
            predictor.load_models('./saved_models')
            
            horizon = input_data.get('horizon', '1h')
            prediction = predictor.predict(data, horizon=horizon)
            
            result = {
                'status': 'success',
                'symbol': symbol,
                **prediction
            }
            
        elif action == 'multi_horizon':
            # Load trained models
            predictor.load_models('./saved_models')
            
            predictions = predictor.predict_multi_horizon(data)
            
            result = {
                'status': 'success',
                'symbol': symbol,
                'predictions': predictions
            }
            
        elif action == 'signal':
            # Load trained models
            predictor.load_models('./saved_models')
            
            current_price = float(input_data.get('current_price'))
            signal = predictor.get_trading_signal(data, current_price)
            
            result = {
                'status': 'success',
                'symbol': symbol,
                **signal
            }
            
        else:
            raise ValueError(f"Unknown action: {action}")
        
        # Output result as JSON
        print(json.dumps(result, default=str))
        
    except Exception as e:
        logger.error(f"ML prediction error: {str(e)}", exc_info=True)
        error_result = {
            'status': 'error',
            'error': str(e),
            'type': type(e).__name__
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == '__main__':
    main()
