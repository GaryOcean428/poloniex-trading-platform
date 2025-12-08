#!/usr/bin/env python3.11
"""
ML Model Training Script
Train all models on historical cryptocurrency data
"""

import sys
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import logging
from pathlib import Path

# Add parent directory to path
sys.path.append(str(Path(__file__).parent))

from ensemble_predictor import EnsemblePredictor
from utils.data_preparation import DataPreparation

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def load_historical_data(symbol: str, filepath: str = None) -> pd.DataFrame:
    """
    Load historical OHLCV data
    
    Args:
        symbol: Trading pair symbol
        filepath: Optional path to CSV file with historical data
        
    Returns:
        DataFrame with OHLCV data
    """
    if filepath:
        df = pd.DataFrame(filepath)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        return df
    
    # If no file provided, generate sample data for testing
    logger.warning("No historical data file provided, generating sample data")
    
    dates = pd.date_range(end=datetime.now(), periods=1000, freq='1H')
    
    # Generate realistic-looking crypto price data
    np.random.seed(42)
    base_price = 50000 if 'BTC' in symbol else 3000
    
    prices = [base_price]
    for _ in range(len(dates) - 1):
        change = np.random.randn() * base_price * 0.02  # 2% volatility
        prices.append(max(prices[-1] + change, base_price * 0.5))
    
    df = pd.DataFrame({
        'timestamp': dates,
        'open': prices,
        'high': [p * (1 + abs(np.random.randn()) * 0.01) for p in prices],
        'low': [p * (1 - abs(np.random.randn()) * 0.01) for p in prices],
        'close': [p * (1 + np.random.randn() * 0.005) for p in prices],
        'volume': np.random.uniform(1000, 10000, len(dates))
    })
    
    return df

def train_models(symbol: str, data_file: str = None):
    """
    Train all ML models
    
    Args:
        symbol: Trading pair symbol
        data_file: Optional path to historical data CSV
    """
    logger.info(f"Starting model training for {symbol}")
    
    # Load data
    df = load_historical_data(symbol, data_file)
    logger.info(f"Loaded {len(df)} data points")
    
    # Prepare features
    logger.info("Preparing features...")
    df_features = DataPreparation.prepare_features(df)
    logger.info(f"Created {len(df_features.columns)} features")
    
    # Add target columns
    df_features = DataPreparation.add_target_columns(df_features)
    
    # Initialize ensemble predictor
    predictor = EnsemblePredictor()
    
    # Train all models
    logger.info("Training models...")
    results = predictor.train_all_models(df_features, symbol)
    
    # Print results
    logger.info("\n=== Training Results ===")
    for model_name, success in results.items():
        status = "✓ SUCCESS" if success else "✗ FAILED"
        logger.info(f"{model_name}: {status}")
    
    # Save trained models
    save_dir = Path(__file__).parent / 'saved_models'
    save_dir.mkdir(exist_ok=True)
    
    logger.info(f"\nSaving models to {save_dir}...")
    predictor.save_models(str(save_dir))
    
    # Test prediction
    logger.info("\n=== Testing Predictions ===")
    test_data = df_features.tail(100)
    
    try:
        prediction = predictor.predict(test_data, horizon='1h')
        logger.info(f"1h Prediction: ${prediction['prediction']:.2f}")
        logger.info(f"Confidence: {prediction['confidence']:.2%}")
        logger.info(f"Agreement: {prediction['agreement']:.2%}")
        logger.info(f"Models used: {', '.join(prediction['models_used'])}")
    except Exception as e:
        logger.error(f"Prediction test failed: {str(e)}")
    
    logger.info("\n=== Training Complete ===")
    
    return results

def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Train ML models for crypto trading')
    parser.add_argument('--symbol', type=str, default='BTCUSDTPERP',
                       help='Trading pair symbol')
    parser.add_argument('--data-file', type=str, default=None,
                       help='Path to historical data CSV file')
    
    args = parser.parse_args()
    
    try:
        results = train_models(args.symbol, args.data_file)
        
        # Print summary
        total = len(results)
        successful = sum(1 for success in results.values() if success)
        
        print(f"\n{'='*50}")
        print(f"Training Summary: {successful}/{total} models trained successfully")
        print(f"{'='*50}\n")
        
        sys.exit(0 if successful > 0 else 1)
        
    except Exception as e:
        logger.error(f"Training failed: {str(e)}", exc_info=True)
        sys.exit(1)

if __name__ == '__main__':
    main()
