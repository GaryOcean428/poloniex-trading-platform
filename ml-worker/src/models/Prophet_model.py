import pandas as pd
import numpy as np
import logging
from typing import Dict, Any, List, Tuple, Optional
from prophet import Prophet
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split
import joblib
import os

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
# Define a relative path for saving the model within the project structure
MODEL_SAVE_DIR = os.path.join(os.path.dirname(__file__), 'saved_models')
MODEL_FILENAME = "Prophet_model.joblib"

class ProphetModel:
    """
    A complete implementation of the Prophet model for cryptocurrency futures trading prediction.

    This model uses the Prophet library for time series forecasting, leveraging OHLCV data
    as extra regressors to enhance prediction accuracy. It is designed to be production-ready
    for integration with an autonomous trading agent.

    The model predicts the 'Close' price and uses 'Open', 'High', 'Low', and 'Volume'
    as extra regressors.
    """

    def __init__(self, confidence_interval: float = 0.95):
        """
        Initializes the ProphetModel.

        Args:
            confidence_interval: The width of the uncertainty interval (e.g., 0.95 for 95%).
                                 This is used to calculate the confidence score.
        """
        self.confidence_interval = confidence_interval
        self.model: Optional[Prophet] = None
        self.regressors: List[str] = ['Open', 'High', 'Low', 'Volume']
        self.target_column: str = 'Close'
        self.prediction_horizons: Dict[str, str] = {
            '1h': '60min',
            '4h': '240min',
            '24h': '1440min'
        }

    def _preprocess_data(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Preprocesses the OHLCV data into the format required by Prophet (ds, y)
        and ensures extra regressors are present.

        Args:
            data: A pandas DataFrame with a datetime index and OHLCV columns.

        Returns:
            A DataFrame with 'ds' (datetime) and 'y' (target) columns,
            plus the extra regressor columns.
        
        Raises:
            ValueError: If the input data does not have a DatetimeIndex or is missing
                        required OHLCV columns.
        """
        if not isinstance(data.index, pd.DatetimeIndex):
            logging.error("Input data must have a DatetimeIndex.")
            raise ValueError("Input data must have a DatetimeIndex.")

        required_cols = [self.target_column] + self.regressors
        if not all(col in data.columns for col in required_cols):
            logging.error(f"Missing required columns. Expected: {required_cols}")
            raise ValueError(f"Missing required columns. Expected: {required_cols}")

        # Prophet requires columns to be named 'ds' and 'y'
        df = data.reset_index()
        df = df.rename(columns={df.columns[0]: 'ds', self.target_column: 'y'})
        
        # Ensure 'ds' is datetime and sort
        df['ds'] = pd.to_datetime(df['ds'])
        df = df.sort_values(by='ds')

        return df[['ds', 'y'] + self.regressors]

    def train(self, historical_data: pd.DataFrame, test_size: float = 0.2) -> Dict[str, float]:
        """
        Trains the Prophet model on the historical data and evaluates it.

        Args:
            historical_data: A pandas DataFrame with a datetime index and OHLCV data.
            test_size: The proportion of the data to use for testing (evaluation).

        Returns:
            A dictionary of evaluation metrics (MAE, RMSE, Accuracy).
        
        Raises:
            Exception: Propagates any exception that occurs during training or evaluation.
        """
        try:
            processed_data = self._preprocess_data(historical_data)
            
            # Train/Test split based on time
            # The last `test_size` proportion of data is used for testing
            train_data, test_data = train_test_split(
                processed_data, test_size=test_size, shuffle=False
            )
            
            logging.info(f"Training data size: {len(train_data)}")
            logging.info(f"Testing data size: {len(test_data)}")

            # Initialize Prophet model
            self.model = Prophet(
                interval_width=self.confidence_interval,
                daily_seasonality=True,
                weekly_seasonality=True,
                yearly_seasonality=True
            )

            # Add extra regressors (OHLV)
            for regressor in self.regressors:
                self.model.add_regressor(regressor)

            # Fit the model
            self.model.fit(train_data)
            
            # --- Evaluation ---
            # Create a future DataFrame for the test period
            future_test = test_data[['ds'] + self.regressors].copy()
            
            # Predict on the test set
            forecast_test = self.model.predict(future_test)
            
            # Merge actual values with forecast
            evaluation_df = pd.merge(
                test_data[['ds', 'y']], 
                forecast_test[['ds', 'yhat', 'yhat_lower', 'yhat_upper']], 
                on='ds', 
                how='inner'
            )
            
            # Calculate metrics
            y_true = evaluation_df['y']
            y_pred = evaluation_df['yhat']
            
            mae = mean_absolute_error(y_true, y_pred)
            rmse = np.sqrt(mean_squared_error(y_true, y_pred))
            
            # Accuracy (Directional Prediction)
            # Compare the direction of change from the last training point to the prediction point
            last_train_price = train_data['y'].iloc[-1]
            
            # Calculate actual direction (1 for up, -1 for down, 0 for no change)
            actual_direction = np.sign(y_true.diff().fillna(0))
            
            # Calculate predicted direction
            predicted_direction = np.sign(y_pred.diff().fillna(0))
            
            # Directional Accuracy: percentage of times the predicted direction matches the actual direction
            accuracy = (actual_direction == predicted_direction).mean()
            
            metrics = {
                "MAE": mae,
                "RMSE": rmse,
                "Accuracy": accuracy
            }
            
            logging.info(f"Model trained successfully. Evaluation Metrics: {metrics}")
            return metrics

        except Exception as e:
            logging.error(f"An error occurred during training: {e}")
            raise

    def predict(self, future_ohlcv_data: pd.DataFrame, horizon: str) -> pd.DataFrame:
        """
        Generates price predictions for a specified horizon.

        The Prophet model requires the future values of the extra regressors
        (Open, High, Low, Volume) to make a prediction. In a real-world scenario,
        these would need to be forecasted or estimated. For this implementation,
        we assume they are provided in `future_ohlcv_data`.

        Args:
            future_ohlcv_data: A DataFrame containing the 'ds' (datetime) and
                               future values for the extra regressors (OHLV).
                               The index must be a DatetimeIndex.
            horizon: The prediction horizon ('1h', '4h', or '24h').

        Returns:
            A DataFrame with prediction results: 'ds', 'yhat' (prediction),
            'yhat_lower' (lower bound), 'yhat_upper' (upper bound), and
            'confidence_score' (derived from interval width).
        
        Raises:
            RuntimeError: If the model has not been trained.
            ValueError: If an invalid horizon is provided or required columns are missing.
        """
        if self.model is None:
            logging.error("Model is not trained. Please call the 'train' method first.")
            raise RuntimeError("Model is not trained.")
        
        if horizon not in self.prediction_horizons:
            logging.error(f"Invalid horizon: {horizon}. Must be one of {list(self.prediction_horizons.keys())}")
            raise ValueError(f"Invalid horizon: {horizon}")

        try:
            # Prepare future DataFrame for Prophet
            future_df = future_ohlcv_data.reset_index().rename(columns={future_ohlcv_data.index.name: 'ds'})
            future_df['ds'] = pd.to_datetime(future_df['ds'])
            
            required_cols = ['ds'] + self.regressors
            if not all(col in future_df.columns for col in required_cols):
                logging.error(f"Missing required columns in future data. Expected: {required_cols}")
                raise ValueError(f"Missing required columns in future data. Expected: {required_cols}")

            # Filter to only include the required columns for prediction
            future_df = future_df[required_cols]

            # Generate forecast
            forecast = self.model.predict(future_df)
            
            # Calculate confidence score (simple inverse of normalized interval width)
            # A tighter interval suggests higher confidence.
            # Normalized by the predicted value to make it relative.
            interval_width = forecast['yhat_upper'] - forecast['yhat_lower']
            normalized_width = interval_width / forecast['yhat'].abs()
            
            # Confidence score is 1 - normalized width (clamped between 0 and 1)
            confidence_score = 1.0 - normalized_width
            confidence_score = confidence_score.clip(lower=0.0, upper=1.0)
            
            # Structure the output
            results = forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].copy()
            results['confidence_score'] = confidence_score
            results['horizon'] = horizon
            
            logging.info(f"Prediction for {horizon} generated successfully.")
            return results

        except Exception as e:
            logging.error(f"An error occurred during prediction: {e}")
            raise

    def save_model(self, path: str = MODEL_SAVE_DIR, filename: str = MODEL_FILENAME) -> str:
        """
        Saves the trained Prophet model instance to a file using joblib.

        Args:
            path: The directory path to save the model.
            filename: The filename for the saved model.

        Returns:
            The absolute path to the saved model file.
        
        Raises:
            RuntimeError: If the model has not been trained.
            Exception: Propagates any exception that occurs during file saving.
        """
        if self.model is None:
            logging.error("Cannot save: Model is not trained.")
            raise RuntimeError("Model is not trained.")
        
        os.makedirs(path, exist_ok=True)
        full_path = os.path.join(path, filename)
        
        try:
            # Save the entire ProphetModel instance, which contains the fitted Prophet model
            joblib.dump(self, full_path)
            logging.info(f"Model successfully saved to {full_path}")
            return full_path
        except Exception as e:
            logging.error(f"Error saving model: {e}")
            raise

    @staticmethod
    def load_model(full_path: str) -> 'ProphetModel':
        """
        Loads a trained ProphetModel instance from a file.

        Args:
            full_path: The absolute path to the saved model file.

        Returns:
            A loaded instance of ProphetModel.
        
        Raises:
            FileNotFoundError: If the model file does not exist.
            TypeError: If the loaded object is not an instance of ProphetModel.
            Exception: Propagates any other exception that occurs during file loading.
        """
        try:
            model_instance = joblib.load(full_path)
            if not isinstance(model_instance, ProphetModel):
                raise TypeError("Loaded object is not an instance of ProphetModel.")
            logging.info(f"Model successfully loaded from {full_path}")
            return model_instance
        except FileNotFoundError:
            logging.error(f"Model file not found at {full_path}")
            raise
        except Exception as e:
            logging.error(f"Error loading model: {e}")
            raise

# --- Example Usage (for testing and demonstration) ---
def main():
    """
    Demonstrates the usage of the ProphetModel class with dummy data.
    """
    logging.info("Starting ProphetModel demonstration.")

    # 1. Create Dummy OHLCV Data
    # Prophet requires a long history, so we'll create 1 year of hourly data
    n_hours = 365 * 24
    date_range = pd.date_range(start='2024-01-01', periods=n_hours, freq='H')
    
    # Simulate a price trend with some noise
    base_price = 50000
    trend = np.linspace(0, 10000, n_hours)
    noise = np.random.normal(0, 500, n_hours)
    close_price = base_price + trend + noise + np.sin(np.arange(n_hours) / 24) * 1000 # Daily seasonality
    
    # Create OHLCV data
    data = pd.DataFrame({
        'Close': close_price,
        'Open': close_price * (1 + np.random.uniform(-0.001, 0.001, n_hours)),
        'High': close_price * (1 + np.random.uniform(0.001, 0.005, n_hours)),
        'Low': close_price * (1 - np.random.uniform(0.001, 0.005, n_hours)),
        'Volume': np.random.randint(1000, 10000, n_hours)
    }, index=date_range)
    
    # 2. Initialize and Train Model
    model_instance = ProphetModel(confidence_interval=0.90)
    
    try:
        metrics = model_instance.train(data)
        logging.info(f"Training complete. Metrics: {metrics}")
        
        # 3. Save Model
        # Note: The save path is relative to the script location for this example.
        # In a real application, the full path from the task requirements should be used.
        saved_path = model_instance.save_model(path=os.path.join(os.getcwd(), 'temp_models'))
        logging.info(f"Model saved to: {saved_path}")

        # 4. Load Model
        loaded_model = ProphetModel.load_model(saved_path)
        
        # 5. Prepare Future Data for Prediction
        # Create 24 future data points (e.g., next 24 hours)
        future_dates = pd.date_range(start=data.index[-1] + pd.Timedelta(hours=1), periods=24, freq='H')
        
        # Simple projection: assume OHLV for the next 24 hours are the same as the last point
        last_data = data.iloc[-1]
        future_ohlcv = pd.DataFrame({
            'Open': last_data['Open'],
            'High': last_data['High'],
            'Low': last_data['Low'],
            'Volume': last_data['Volume']
        }, index=future_dates)
        
        # 6. Predict for all horizons
        horizons = ['1h', '4h', '24h']
        for h in horizons:
            # Select the appropriate number of future points for the horizon
            if h == '1h':
                pred_data = future_ohlcv.iloc[:1]
            elif h == '4h':
                pred_data = future_ohlcv.iloc[:4]
            elif h == '24h':
                pred_data = future_ohlcv.iloc[:24]
            else:
                continue

            predictions = loaded_model.predict(pred_data, h)
            
            # Get the prediction for the specific horizon (last row of the prediction result)
            final_prediction = predictions.iloc[-1]
            
            logging.info(f"\n--- {h} Prediction ---")
            logging.info(f"Date: {final_prediction['ds']}")
            logging.info(f"Predicted Price (yhat): {final_prediction['yhat']:.2f}")
            logging.info(f"Confidence Interval: [{final_prediction['yhat_lower']:.2f}, {final_prediction['yhat_upper']:.2f}]")
            logging.info(f"Confidence Score: {final_prediction['confidence_score']:.4f}")
            
    except Exception as e:
        logging.error(f"Demonstration failed: {e}")

if __name__ == "__main__":
    # The main function is commented out to prevent execution during import,
    # but serves as a complete example and test case.
    # main()
    pass
