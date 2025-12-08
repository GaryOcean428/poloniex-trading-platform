"""
Data Preparation Utilities for ML Models
Fetches and prepares OHLCV data for training
"""

import pandas as pd
import numpy as np
from typing import List, Tuple, Optional
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

class DataPreparation:
    """Prepare OHLCV data for ML model training"""
    
    @staticmethod
    def prepare_features(df: pd.DataFrame) -> pd.DataFrame:
        """
        Add technical indicators and features to OHLCV data
        
        Args:
            df: DataFrame with OHLCV columns
            
        Returns:
            DataFrame with additional feature columns
        """
        df = df.copy()
        
        # Price-based features
        df['returns'] = df['close'].pct_change()
        df['log_returns'] = np.log(df['close'] / df['close'].shift(1))
        
        # Moving averages
        for period in [7, 14, 21, 50]:
            df[f'sma_{period}'] = df['close'].rolling(window=period).mean()
            df[f'ema_{period}'] = df['close'].ewm(span=period).mean()
        
        # Volatility
        df['volatility_7'] = df['returns'].rolling(window=7).std()
        df['volatility_14'] = df['returns'].rolling(window=14).std()
        
        # Volume features
        df['volume_sma_7'] = df['volume'].rolling(window=7).mean()
        df['volume_ratio'] = df['volume'] / df['volume_sma_7']
        
        # Price range
        df['high_low_ratio'] = df['high'] / df['low']
        df['close_open_ratio'] = df['close'] / df['open']
        
        # RSI (Relative Strength Index)
        delta = df['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['rsi'] = 100 - (100 / (1 + rs))
        
        # MACD
        exp1 = df['close'].ewm(span=12).mean()
        exp2 = df['close'].ewm(span=26).mean()
        df['macd'] = exp1 - exp2
        df['macd_signal'] = df['macd'].ewm(span=9).mean()
        df['macd_diff'] = df['macd'] - df['macd_signal']
        
        # Bollinger Bands
        df['bb_middle'] = df['close'].rolling(window=20).mean()
        bb_std = df['close'].rolling(window=20).std()
        df['bb_upper'] = df['bb_middle'] + (bb_std * 2)
        df['bb_lower'] = df['bb_middle'] - (bb_std * 2)
        df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['bb_middle']
        
        # Drop NaN values from indicator calculations
        df = df.dropna()
        
        return df
    
    @staticmethod
    def create_sequences(data: np.ndarray, seq_length: int, 
                        target_col_idx: int = 0) -> Tuple[np.ndarray, np.ndarray]:
        """
        Create sequences for time series prediction
        
        Args:
            data: Input data array
            seq_length: Length of input sequences
            target_col_idx: Index of target column to predict
            
        Returns:
            Tuple of (X, y) arrays for training
        """
        X, y = [], []
        
        for i in range(len(data) - seq_length):
            X.append(data[i:i+seq_length])
            y.append(data[i+seq_length, target_col_idx])
        
        return np.array(X), np.array(y)
    
    @staticmethod
    def split_train_test(df: pd.DataFrame, test_size: float = 0.2) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """
        Split data into train and test sets (time-series aware)
        
        Args:
            df: Input DataFrame
            test_size: Fraction of data to use for testing
            
        Returns:
            Tuple of (train_df, test_df)
        """
        split_idx = int(len(df) * (1 - test_size))
        train_df = df.iloc[:split_idx].copy()
        test_df = df.iloc[split_idx:].copy()
        
        return train_df, test_df
    
    @staticmethod
    def normalize_data(train_df: pd.DataFrame, test_df: pd.DataFrame, 
                      columns: Optional[List[str]] = None) -> Tuple[pd.DataFrame, pd.DataFrame, dict]:
        """
        Normalize data using training set statistics
        
        Args:
            train_df: Training DataFrame
            test_df: Test DataFrame
            columns: Columns to normalize (if None, normalizes all numeric columns)
            
        Returns:
            Tuple of (normalized_train, normalized_test, normalization_params)
        """
        if columns is None:
            columns = train_df.select_dtypes(include=[np.number]).columns.tolist()
        
        train_normalized = train_df.copy()
        test_normalized = test_df.copy()
        normalization_params = {}
        
        for col in columns:
            mean = train_df[col].mean()
            std = train_df[col].std()
            
            if std == 0:
                std = 1  # Avoid division by zero
            
            train_normalized[col] = (train_df[col] - mean) / std
            test_normalized[col] = (test_df[col] - mean) / std
            
            normalization_params[col] = {'mean': mean, 'std': std}
        
        return train_normalized, test_normalized, normalization_params
    
    @staticmethod
    def denormalize_predictions(predictions: np.ndarray, 
                               normalization_params: dict, 
                               column: str = 'close') -> np.ndarray:
        """
        Denormalize predictions back to original scale
        
        Args:
            predictions: Normalized predictions
            normalization_params: Parameters from normalize_data()
            column: Column name that was predicted
            
        Returns:
            Denormalized predictions
        """
        params = normalization_params[column]
        return predictions * params['std'] + params['mean']
    
    @staticmethod
    def add_target_columns(df: pd.DataFrame, horizons: List[str] = ['1h', '4h', '24h']) -> pd.DataFrame:
        """
        Add target columns for different prediction horizons
        
        Args:
            df: Input DataFrame with close prices
            horizons: List of prediction horizons
            
        Returns:
            DataFrame with target columns added
        """
        df = df.copy()
        
        horizon_map = {
            '1h': 1,
            '4h': 4,
            '24h': 24
        }
        
        for horizon in horizons:
            periods = horizon_map.get(horizon, 1)
            df[f'target_{horizon}'] = df['close'].shift(-periods)
        
        # Drop rows with NaN targets
        df = df.dropna()
        
        return df
