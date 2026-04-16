"""
Ensemble ML Predictor for Cryptocurrency Futures Trading
Combines predictions from LSTM, Transformer, GBM, ARIMA, and Prophet models.
Enhanced with QIG (Quantum Information Geometry) for physics-based intelligence.
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional
import logging
from datetime import datetime, timedelta

# Import all ML models
from models.LSTM_model import LSTMPredictor
from models.Transformer_model import TransformerModel  
from models.GBM_model import GBMModel
from models.ARIMA_model import ARIMAModel
from models.Prophet_model import ProphetModel

# QIG physics engine
try:
    from qig_engine import (
        classify_market_regime,
        geometric_confidence,
        geometric_agreement,
        check_ensemble_convergence,
        get_regime_weights,
        full_qig_analysis,
        market_state_distance,
        MarketRegime,
    )
    _HAS_QIG = True
except ImportError:
    _HAS_QIG = False

logger = logging.getLogger(__name__)

class EnsemblePredictor:
    """
    Ensemble predictor that combines multiple ML models for robust predictions
    """
    
    def __init__(self, model_weights: Optional[Dict[str, float]] = None):
        """
        Initialize ensemble with all models
        
        Args:
            model_weights: Optional weights for each model. If None, uses equal weights.
        """
        self.models = {
            'lstm': LSTMPredictor(),
            'transformer': TransformerModel(),
            'gbm': GBMModel(),
            'arima': ARIMAModel(),
            'prophet': ProphetModel()
        }
        
        # Default equal weights if not specified
        self.weights = model_weights or {
            'lstm': 0.25,
            'transformer': 0.25,
            'gbm': 0.20,
            'arima': 0.15,
            'prophet': 0.15
        }
        
        self.trained_models = set()
        logger.info(f"Initialized ensemble predictor with {len(self.models)} models")
    
    def train_all_models(self, data: pd.DataFrame, symbol: str) -> Dict[str, bool]:
        """
        Train all models on historical data
        
        Args:
            data: DataFrame with OHLCV data
            symbol: Trading pair symbol
            
        Returns:
            Dict mapping model name to training success status
        """
        results = {}
        
        for name, model in self.models.items():
            try:
                logger.info(f"Training {name} model for {symbol}...")
                model.train(data)
                self.trained_models.add(name)
                results[name] = True
                logger.info(f"✓ {name} model trained successfully")
            except Exception as e:
                logger.error(f"✗ Failed to train {name} model: {str(e)}")
                results[name] = False
        
        return results
    
    def predict(self, data: pd.DataFrame, horizon: str = '1h') -> Dict:
        """
        Generate ensemble prediction, enhanced with QIG physics.
        
        Uses regime-aware model weighting and geometric confidence
        when QIG engine is available.
        """
        if not self.trained_models:
            raise ValueError("No models have been trained yet. Call train_all_models() first.")
        
        predictions = {}
        confidences = {}
        
        # Determine active weights — regime-aware if QIG available
        active_weights = dict(self.weights)
        regime_info = None
        if _HAS_QIG and 'close' in data.columns and len(data) >= 50:
            try:
                closes = data['close'].tolist()
                highs = data['high'].tolist() if 'high' in data.columns else None
                lows = data['low'].tolist() if 'low' in data.columns else None
                regime_info = classify_market_regime(closes, highs, lows)
                active_weights = get_regime_weights(regime_info.regime)
                logger.info(f"QIG regime: {regime_info.regime.value} "
                           f"(vol_ratio={regime_info.volatility_ratio}, "
                           f"trend={regime_info.trend_strength})")
            except Exception as e:
                logger.warning(f"QIG regime classification failed: {e}")

        # Get predictions from each trained model with convergence checking
        running_preds = []
        for name in self.trained_models:
            try:
                model = self.models[name]
                pred = model.predict(data, horizon=horizon)
                predictions[name] = pred['prediction']
                confidences[name] = pred.get('confidence', 0.5)
                running_preds.append(pred['prediction'])
                
                # Early stop if ensemble has converged (saves compute)
                if _HAS_QIG and len(running_preds) >= 3:
                    conv = check_ensemble_convergence(running_preds)
                    if conv.converged:
                        logger.info(f"Ensemble converged after {conv.n_models_needed} models "
                                   f"(marginal gain: {conv.marginal_gain})")
                        break
            except Exception as e:
                logger.warning(f"Failed to get prediction from {name}: {str(e)}")
                continue
        
        if not predictions:
            raise ValueError("No models could generate predictions")
        
        # Calculate weighted ensemble prediction with regime-aware weights
        weighted_sum = 0
        weight_sum = 0
        
        for name, pred in predictions.items():
            weight = active_weights.get(name, 0.2) * confidences[name]
            weighted_sum += pred * weight
            weight_sum += weight
        
        ensemble_prediction = weighted_sum / weight_sum if weight_sum > 0 else np.mean(list(predictions.values()))
        
        # Calculate ensemble confidence
        ensemble_confidence = sum(
            confidences[name] * active_weights.get(name, 0.2) 
            for name in predictions.keys()
        ) / sum(active_weights.get(name, 0.2) for name in predictions.keys())
        
        # Use QIG geometric metrics if available, else fall back to naive
        current_price = float(data['close'].iloc[-1]) if 'close' in data.columns else 0
        if _HAS_QIG and current_price > 0:
            geo_conf = geometric_confidence(predictions, current_price)
            geo_agree = geometric_agreement(predictions, current_price)
            agreement_score = geo_agree
            # Blend geometric confidence with model confidence
            ensemble_confidence = 0.6 * ensemble_confidence + 0.4 * geo_conf
        else:
            pred_values = list(predictions.values())
            prediction_std = np.std(pred_values)
            prediction_mean = np.mean(pred_values)
            agreement_score = 1 - min(prediction_std / prediction_mean, 1.0) if prediction_mean != 0 else 0
            geo_conf = None
            geo_agree = None
        
        result = {
            'prediction': ensemble_prediction,
            'confidence': ensemble_confidence,
            'agreement': agreement_score,
            'horizon': horizon,
            'timestamp': datetime.now().isoformat(),
            'individual_predictions': predictions,
            'individual_confidences': confidences,
            'models_used': list(predictions.keys()),
            'weights': {k: active_weights.get(k, 0.2) for k in predictions.keys()},
        }
        
        # Add QIG metadata when available
        if _HAS_QIG:
            result['qig'] = {
                'geometric_confidence': geo_conf,
                'geometric_agreement': geo_agree,
                'regime': regime_info.regime.value if regime_info else None,
                'regime_confidence': regime_info.confidence if regime_info else None,
                'volatility_ratio': regime_info.volatility_ratio if regime_info else None,
                'trend_strength': regime_info.trend_strength if regime_info else None,
                'recommended_strategy': regime_info.recommended_strategy if regime_info else None,
            }
        
        return result
    
    def predict_multi_horizon(self, data: pd.DataFrame) -> Dict[str, Dict]:
        """
        Generate predictions for multiple time horizons
        
        Args:
            data: Recent OHLCV data
            
        Returns:
            Dict mapping horizon to prediction results
        """
        horizons = ['1h', '4h', '24h']
        results = {}
        
        for horizon in horizons:
            try:
                results[horizon] = self.predict(data, horizon=horizon)
            except Exception as e:
                logger.error(f"Failed to predict for {horizon}: {str(e)}")
                results[horizon] = {
                    'error': str(e),
                    'horizon': horizon
                }
        
        return results
    
    def get_trading_signal(self, data: pd.DataFrame, current_price: float) -> Dict:
        """
        Generate trading signal based on ensemble predictions
        
        Args:
            data: Recent OHLCV data
            current_price: Current market price
            
        Returns:
            Dict with signal, strength, and reasoning
        """
        # Get multi-horizon predictions
        predictions = self.predict_multi_horizon(data)
        
        # Analyze predictions
        signals = []
        confidences = []
        
        for horizon, pred in predictions.items():
            if 'error' in pred:
                continue
                
            predicted_price = pred['prediction']
            confidence = pred['confidence']
            agreement = pred['agreement']
            
            # Calculate expected price change
            price_change_pct = ((predicted_price - current_price) / current_price) * 100
            
            # Generate signal based on price change and confidence
            if price_change_pct > 1.0 and confidence > 0.6 and agreement > 0.7:
                signals.append('BUY')
                confidences.append(confidence * agreement)
            elif price_change_pct < -1.0 and confidence > 0.6 and agreement > 0.7:
                signals.append('SELL')
                confidences.append(confidence * agreement)
            else:
                signals.append('HOLD')
                confidences.append(confidence * 0.5)
        
        if not signals:
            return {
                'signal': 'HOLD',
                'strength': 0,
                'reason': 'Insufficient prediction data',
                'predictions': predictions
            }
        
        # Determine overall signal
        buy_count = signals.count('BUY')
        sell_count = signals.count('SELL')
        
        if buy_count > sell_count:
            signal = 'BUY'
            strength = np.mean([c for s, c in zip(signals, confidences) if s == 'BUY'])
        elif sell_count > buy_count:
            signal = 'SELL'
            strength = np.mean([c for s, c in zip(signals, confidences) if s == 'SELL'])
        else:
            signal = 'HOLD'
            strength = np.mean(confidences)
        
        return {
            'signal': signal,
            'strength': float(strength),
            'reason': f"{signal} signal from {max(buy_count, sell_count)}/{len(signals)} horizons",
            'predictions': predictions,
            'current_price': current_price,
            'timestamp': datetime.now().isoformat()
        }
    
    def save_models(self, path: str):
        """Save all trained models"""
        for name, model in self.models.items():
            if name in self.trained_models:
                try:
                    model.save(f"{path}/{name}_model")
                    logger.info(f"Saved {name} model")
                except Exception as e:
                    logger.error(f"Failed to save {name} model: {str(e)}")
    
    def load_models(self, path: str):
        """Load all trained models"""
        for name, model in self.models.items():
            try:
                model.load(f"{path}/{name}_model")
                self.trained_models.add(name)
                logger.info(f"Loaded {name} model")
            except Exception as e:
                logger.warning(f"Failed to load {name} model: {str(e)}")
