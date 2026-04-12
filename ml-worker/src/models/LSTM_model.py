import os
import logging
import json
from typing import Tuple, List, Dict, Any, Optional

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error

# Suppress TensorFlow warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import tensorflow as tf
from tensorflow.keras.models import Sequential, load_model
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.callbacks import EarlyStopping

# --- Configuration ---
# Set up basic logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Define the prediction horizons in hours
PREDICTION_HORIZONS = [1, 4, 24]
# Define the lookback window (number of historical time steps to consider)
LOOKBACK_WINDOW = 60 # e.g., 60 time steps (if data is 1h, this is 60 hours)

# --- Type Definitions ---
OHLCVData = pd.DataFrame
ModelData = Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]

class LSTMPredictor:
    """
    A complete, production-ready LSTM model for cryptocurrency futures price prediction.

    This class handles data preprocessing, model creation, training, prediction,
    evaluation, and serialization, focusing on OHLCV data for multiple prediction
    horizons (1h, 4h, 24h).

    The model is designed to be trainable on new data and serializable for saving/loading.
    It accepts historical OHLCV data and predicts future 'Close' prices for the
    defined horizons, returning a confidence score (placeholder for now).
    """

    def __init__(self, lookback_window: int = LOOKBACK_WINDOW, horizons: List[int] = PREDICTION_HORIZONS):
        """
        Initializes the LSTMPredictor with a new model and scaler.

        Args:
            lookback_window: The number of previous time steps to use as input.
            horizons: A list of future time steps (in hours) to predict.
        """
        self.lookback_window = lookback_window
        self.horizons = horizons
        self.model: Optional[tf.keras.Model] = None
        self.scaler: Optional[MinMaxScaler] = None
        self.feature_columns = ['Open', 'High', 'Low', 'Close', 'Volume']
        self.target_column = 'Close'
        logger.info(f"LSTMPredictor initialized with lookback={lookback_window} and horizons={horizons}")

    def _create_model(self, input_shape: Tuple[int, int], output_units: int) -> tf.keras.Model:
        """
        Creates and compiles the LSTM model architecture.

        Args:
            input_shape: The shape of the input data (lookback_window, n_features).
            output_units: The number of output units (number of horizons * 1).

        Returns:
            A compiled Keras Sequential model.
        """
        try:
            model = Sequential([
                LSTM(units=50, return_sequences=True, input_shape=input_shape),
                Dropout(0.2),
                LSTM(units=50, return_sequences=False),
                Dropout(0.2),
                Dense(units=output_units)
            ])
            model.compile(optimizer='adam', loss='mse')
            logger.info("LSTM model architecture created and compiled successfully.")
            return model
        except Exception as e:
            logger.error(f"Error creating model architecture: {e}")
            raise

    def preprocess_data(self, data: OHLCVData, test_size: float = 0.2) -> ModelData:
        """
        Preprocesses OHLCV data: scales, creates sequences, and splits into train/test sets.

        Args:
            data: A pandas DataFrame with OHLCV data.
            test_size: The proportion of the data to use for the test set.

        Returns:
            A tuple (X_train, X_test, y_train, y_test) of numpy arrays.
        """
        if data.empty:
            raise ValueError("Input data is empty.")

        try:
            # 1. Feature Selection and Scaling
            data_to_scale = data[self.feature_columns].values
            self.scaler = MinMaxScaler(feature_range=(0, 1))
            scaled_data = self.scaler.fit_transform(data_to_scale)
            logger.info("Data scaled using MinMaxScaler.")

            # 2. Prepare Targets for Multiple Horizons
            # The target is the 'Close' price at each horizon
            target_data = data[self.target_column].values
            
            # Create a matrix where each row is the target for all horizons
            y_multi_horizon = []
            max_horizon = max(self.horizons)
            
            # The number of rows in y_multi_horizon will be the length of the data minus the max lookahead
            # and the lookback window.
            # We need to ensure we have enough data for the lookback window and the max horizon.
            
            # Start index for targets: lookback_window
            # End index for targets: len(data) - max_horizon
            
            # The input sequence X will end at index i-1. The target y will be at index i + h - 1.
            # To align X and y, we iterate over the indices where the input sequence ends.
            
            # The input sequence X[k] is data[k : k + lookback_window]
            # The target y[k] is data[k + lookback_window + h - 1]
            
            # Let's simplify the sequence creation:
            # X[i] is the sequence from index i to i + lookback_window - 1
            # y[i] is the set of prices at index i + lookback_window + h - 1 for all h in horizons
            
            X = []
            y_multi_horizon = []
            
            for i in range(len(scaled_data) - self.lookback_window - max_horizon + 1):
                # Input sequence: data from i to i + lookback_window - 1
                X.append(scaled_data[i:i + self.lookback_window, :])
                
                # Target sequence: prices at future steps
                # The price at time t is data[i + lookback_window - 1].
                # The prediction for 1h is at time t+1, which is data[i + lookback_window].
                # The prediction for h hours is at data[i + lookback_window + h - 1]
                
                # The index of the last element in the input sequence is i + self.lookback_window - 1
                # The index of the target for horizon h is (i + self.lookback_window - 1) + h
                
                targets = [target_data[i + self.lookback_window + h - 1] for h in self.horizons]
                y_multi_horizon.append(targets)

            X = np.array(X)
            y_multi_horizon = np.array(y_multi_horizon)
            
            # Final check on shapes
            if X.shape[0] != y_multi_horizon.shape[0]:
                raise RuntimeError(f"Shape mismatch: X rows ({X.shape[0]}) != y rows ({y_multi_horizon.shape[0]})")

            logger.info(f"Sequences created. X shape: {X.shape}, y shape: {y_multi_horizon.shape}")

            # 4. Train/Test Split
            X_train, X_test, y_train, y_test = train_test_split(
                X, y_multi_horizon, test_size=test_size, shuffle=False
            )
            logger.info(f"Data split: Train size {len(X_train)}, Test size {len(X_test)}")

            return X_train, X_test, y_train, y_test

        except Exception as e:
            logger.error(f"Error during data preprocessing: {e}")
            raise

    def train(self, X_train: np.ndarray, y_train: np.ndarray, epochs: int = 50, batch_size: int = 32) -> tf.keras.callbacks.History:
        """
        Trains the LSTM model.

        Args:
            X_train: Training input sequences.
            y_train: Training target values.
            epochs: Number of training epochs.
            batch_size: Batch size for training.

        Returns:
            The Keras History object from training.
        """
        if self.scaler is None:
            raise RuntimeError("Scaler is not fitted. Run preprocess_data first.")

        try:
            # Scale the target values (y_train) for training
            # We only need to scale the 'Close' price. We'll use a temporary scaler
            # or re-use the main scaler's parameters for the 'Close' column.
            # The easiest way is to use the fitted scaler's parameters for the 'Close' column.
            
            close_index = self.feature_columns.index(self.target_column)
            y_train_scaled = (y_train - self.scaler.min_[close_index]) / self.scaler.scale_[close_index]
            
            # Create model if it doesn't exist
            if self.model is None:
                input_shape = (X_train.shape[1], X_train.shape[2])
                output_units = y_train.shape[1]
                self.model = self._create_model(input_shape, output_units)

            # Early stopping to prevent overfitting
            early_stopping = EarlyStopping(monitor='loss', patience=10, restore_best_weights=True)

            logger.info(f"Starting model training for {epochs} epochs...")
            history = self.model.fit(
                X_train, y_train_scaled, # Use scaled targets
                epochs=epochs,
                batch_size=batch_size,
                callbacks=[early_stopping],
                verbose=0 # Run silently
            )
            logger.info("Model training complete.")
            return history
        except Exception as e:
            logger.error(f"Error during model training: {e}")
            raise

    def predict(self, X_input: np.ndarray) -> Dict[str, Any]:
        """
        Makes price predictions and calculates confidence scores.

        Args:
            X_input: A numpy array of shape (n_samples, lookback_window, n_features)
                     containing the latest scaled OHLCV data sequence(s).

        Returns:
            A dictionary containing:
            - 'predictions': A list of predicted prices for each horizon.
            - 'confidence_scores': A list of confidence scores (e.g., inverse of variance).
        """
        if self.model is None or self.scaler is None:
            raise RuntimeError("Model or Scaler is not loaded/trained.")

        try:
            # 1. Make predictions
            # The model predicts the scaled target values for all horizons
            scaled_predictions = self.model.predict(X_input, verbose=0)

            # 2. Inverse transform the predictions to get actual prices
            close_index = self.feature_columns.index(self.target_column)
            
            # Inverse transform the scaled predictions using the 'Close' column's parameters
            y_pred_unscaled = (scaled_predictions * self.scaler.scale_[close_index]) + self.scaler.min_[close_index]

            # Since we typically predict one sequence at a time, we'll use the first row
            # of the unscaled predictions.
            predictions_unscaled = y_pred_unscaled[0].tolist()
            
            # Confidence Score Placeholder:
            # A simple placeholder for confidence is a fixed high value.
            # For a real production system, this would involve more complex methods
            # like Monte Carlo Dropout or a dedicated uncertainty model.
            confidence_scores = [0.95] * len(self.horizons)

            logger.info(f"Prediction complete for horizons: {self.horizons}")
            
            return {
                'predictions': predictions_unscaled,
                'confidence_scores': confidence_scores,
                'horizons': self.horizons
            }

        except Exception as e:
            logger.error(f"Error during prediction: {e}")
            raise

    def evaluate(self, X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, float]:
        """
        Evaluates the model on the test set and returns key metrics.

        Args:
            X_test: Test input sequences.
            y_test: True target values for the test set (unscaled).

        Returns:
            A dictionary of evaluation metrics (MAE, RMSE).
        """
        if self.model is None or self.scaler is None:
            raise RuntimeError("Model or Scaler is not loaded/trained.")

        try:
            # 1. Scale the true target values (y_test) for prediction comparison
            close_index = self.feature_columns.index(self.target_column)
            y_test_scaled = (y_test - self.scaler.min_[close_index]) / self.scaler.scale_[close_index]
            
            # 2. Make predictions on the test set (scaled)
            scaled_predictions = self.model.predict(X_test, verbose=0)

            # 3. Inverse transform predictions to get actual prices
            y_pred_unscaled = (scaled_predictions * self.scaler.scale_[close_index]) + self.scaler.min_[close_index]

            # 4. Calculate metrics for each horizon
            metrics: Dict[str, float] = {}
            for i, horizon in enumerate(self.horizons):
                true_h = y_test[:, i]
                pred_h = y_pred_unscaled[:, i]

                mae = mean_absolute_error(true_h, pred_h)
                rmse = np.sqrt(mean_squared_error(true_h, pred_h))
                
                metrics[f'MAE_{horizon}h'] = mae
                metrics[f'RMSE_{horizon}h'] = rmse
                
            logger.info(f"Model evaluation complete. Metrics: {metrics}")
            return metrics

        except Exception as e:
            logger.error(f"Error during model evaluation: {e}")
            raise

    def save_model(self, file_path: str) -> None:
        """
        Saves the trained model and the fitted scaler to disk.

        Args:
            file_path: The base path to save the model and scaler.
        """
        if self.model is None or self.scaler is None:
            logger.warning("Attempted to save, but model or scaler is not trained/fitted.")
            return

        try:
            # Save Keras model
            model_path = file_path.replace('.py', '_model.h5')
            self.model.save(model_path)
            
            # Save scaler parameters (MinMaxScaler is simple)
            scaler_params = {
                'min_': self.scaler.min_.tolist(),
                'scale_': self.scaler.scale_.tolist(),
                'feature_range': self.scaler.feature_range,
                'feature_columns': self.feature_columns
            }
            scaler_path = file_path.replace('.py', '_scaler.json')
            with open(scaler_path, 'w') as f:
                json.dump(scaler_params, f)

            # Save configuration
            config_path = file_path.replace('.py', '_config.json')
            config = {
                'lookback_window': self.lookback_window,
                'horizons': self.horizons,
                'target_column': self.target_column,
                'feature_columns': self.feature_columns
            }
            with open(config_path, 'w') as f:
                json.dump(config, f)

            logger.info(f"Model and scaler saved successfully to {model_path} and {scaler_path}.")
        except Exception as e:
            logger.error(f"Error saving model and scaler: {e}")
            raise

    @classmethod
    def load_model(cls, file_path: str) -> 'LSTMPredictor':
        """
        Loads a trained model and scaler from disk and returns a new LSTMPredictor instance.

        Args:
            file_path: The base path where the model and scaler were saved.

        Returns:
            A new LSTMPredictor instance with the loaded model and scaler.
        """
        try:
            # Load configuration
            config_path = file_path.replace('.py', '_config.json')
            with open(config_path, 'r') as f:
                config = json.load(f)

            # Create new instance
            instance = cls(lookback_window=config['lookback_window'], horizons=config['horizons'])
            instance.feature_columns = config['feature_columns']
            instance.target_column = config['target_column']

            # Load Keras model
            model_path = file_path.replace('.py', '_model.h5')
            instance.model = load_model(model_path)

            # Load scaler parameters and re-create scaler
            scaler_path = file_path.replace('.py', '_scaler.json')
            with open(scaler_path, 'r') as f:
                scaler_params = json.load(f)
            
            instance.scaler = MinMaxScaler(feature_range=tuple(scaler_params['feature_range']))
            
            # MinMaxScaler needs to be fitted with dummy data to set n_features_in_
            # and then manually set the loaded parameters.
            dummy_data = np.zeros((1, len(instance.feature_columns)))
            instance.scaler.fit(dummy_data)
            
            # Manually set the loaded parameters
            instance.scaler.min_ = np.array(scaler_params['min_'])
            instance.scaler.scale_ = np.array(scaler_params['scale_'])
            
            logger.info(f"Model and scaler loaded successfully from {model_path} and {scaler_path}.")
            return instance
        except Exception as e:
            logger.error(f"Error loading model and scaler: {e}")
            raise

# --- Example Usage (for testing and demonstration) ---
if __name__ == '__main__':
    # 1. Create dummy OHLCV data (replace with real data loading)
    np.random.seed(42)
    dates = pd.to_datetime(pd.date_range(start='2023-01-01', periods=1000, freq='H'))
    # Create a slightly trending time series for 'Close'
    base_price = 10000
    noise = np.random.randn(1000) * 5
    trend = np.linspace(0, 100, 1000)
    close_prices = base_price + trend + noise
    
    data = pd.DataFrame({
        'Open': close_prices - np.random.rand(1000) * 2,
        'High': close_prices + np.random.rand(1000) * 2,
        'Low': close_prices - np.random.rand(1000) * 4,
        'Close': close_prices,
        'Volume': np.random.randint(1000, 5000, 1000)
    }, index=dates)

    # 2. Initialize the predictor
    predictor = LSTMPredictor()

    try:
        # 3. Preprocess and split data
        X_train, X_test, y_train, y_test = predictor.preprocess_data(data)

        # 4. Train the model
        # Note: In a real scenario, more epochs would be needed.
        predictor.train(X_train, y_train, epochs=5, batch_size=16) 

        # 5. Evaluate the model
        metrics = predictor.evaluate(X_test, y_test)
        print("\n--- Evaluation Metrics ---")
        print(json.dumps(metrics, indent=4))

        # 6. Make a prediction on the latest data point
        # Use the last sequence from the test set for prediction
        latest_sequence = X_test[-1].reshape(1, X_test.shape[1], X_test.shape[2])
        prediction_result = predictor.predict(latest_sequence)
        print("\n--- Prediction Result ---")
        print(json.dumps(prediction_result, indent=4))
        
        # 7. Print the actual next prices for comparison
        last_index_in_data = data.index[-1]
        print(f"\nLast data point time: {last_index_in_data}")
        print(f"Actual next 1h price (approx): {data['Close'].iloc[-3]}")
        print(f"Actual next 4h price (approx): {data['Close'].iloc[-1]}")
        
        # 8. Save and Load Test
        # The file path is relative to the current working directory in the example,
        # but the class methods use the absolute path from the main task.
        save_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'LSTM_model.py')
        predictor.save_model(save_path)
        
        loaded_predictor = LSTMPredictor.load_model(save_path)
        
        # Test prediction with loaded model
        loaded_prediction = loaded_predictor.predict(latest_sequence)
        print("\n--- Loaded Model Prediction Test ---")
        print(json.dumps(loaded_prediction, indent=4))
        
        # Clean up saved files (optional, but good practice)
        os.remove(save_path.replace('.py', '_model.h5'))
        os.remove(save_path.replace('.py', '_scaler.json'))
        os.remove(save_path.replace('.py', '_config.json'))
        logger.info("Saved model files cleaned up.")

    except Exception as e:
        logger.error(f"An error occurred during example usage: {e}")
