import pandas as pd
import numpy as np
import logging
import pickle
from typing import Tuple, Dict, List, Any, Optional
from statsmodels.tsa.arima.model import ARIMA
from sklearn.metrics import mean_absolute_error, mean_squared_error
from statsmodels.tools.sm_exceptions import ConvergenceWarning
import warnings

# Suppress convergence warnings from statsmodels
warnings.simplefilter('ignore', ConvergenceWarning)

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Define the prediction horizons in terms of data points (assuming 1-hour data)
# 1h -> 1 step
# 4h -> 4 steps
# 24h -> 24 steps
PREDICTION_HORIZONS: Dict[str, int] = {
    "1h": 1,
    "4h": 4,
    "24h": 24
}

# ARIMA Model Class
class ARIMAModel:
    """
    A production-ready ARIMA model implementation for cryptocurrency futures price prediction.

    The model is designed to be trained on a single time series (e.g., 'close' price)
    and provide multi-step-ahead forecasts with confidence intervals.
    """

    def __init__(self, order: Tuple[int, int, int] = (5, 1, 0)):
        """
        Initializes the ARIMAModel with a specified order.

        :param order: The (p, d, q) order of the ARIMA model.
        """
        self.order = order
        self.model: Optional[ARIMA] = None
        self.model_fit: Optional[Any] = None
        self.target_column: str = 'close'
        logger.info(f"ARIMAModel initialized with order: {self.order}")

    def preprocess_data(self, df: pd.DataFrame) -> pd.Series:
        """
        Preprocesses the OHLCV data to extract the target time series.

        For ARIMA, we focus on a single, stationary time series. We use the 'close' price.
        The stationarity check and differencing (d parameter in ARIMA) are handled
        by the model's training process, but this function ensures the correct series is selected.

        :param df: DataFrame containing OHLCV data.
        :return: A pandas Series of the target time series (e.g., 'close' price).
        :raises ValueError: If the target column is missing.
        """
        if self.target_column not in df.columns:
            logger.error(f"Target column '{self.target_column}' not found in input data.")
            raise ValueError(f"Input DataFrame must contain a '{self.target_column}' column.")

        # Ensure the index is a DatetimeIndex for proper time series handling
        if not isinstance(df.index, pd.DatetimeIndex):
            try:
                df.index = pd.to_datetime(df.index)
            except Exception as e:
                logger.warning(f"Could not convert index to DatetimeIndex: {e}")

        return df[self.target_column].astype(float)

    def train(self, data: pd.DataFrame, split_ratio: float = 0.8) -> Tuple[pd.Series, pd.Series]:
        """
        Trains the ARIMA model on the provided historical data.

        :param data: DataFrame containing historical OHLCV data.
        :param split_ratio: Ratio for the train/test split (e.g., 0.8 for 80% train).
        :return: A tuple of (train_series, test_series).
        """
        try:
            series = self.preprocess_data(data)
            split_index = int(len(series) * split_ratio)
            train_series = series.iloc[:split_index]
            test_series = series.iloc[split_index:]

            logger.info(f"Data split: Train size={len(train_series)}, Test size={len(test_series)}")

            # Initialize and fit the ARIMA model
            self.model = ARIMA(train_series, order=self.order)
            self.model_fit = self.model.fit()

            logger.info(f"ARIMA model trained successfully with order {self.order}.")
            logger.debug(self.model_fit.summary())

            return train_series, test_series

        except Exception as e:
            logger.error(f"Error during model training: {e}")
            raise

    def predict(self, steps: int) -> Dict[str, Any]:
        """
        Generates a multi-step-ahead forecast using the trained model.

        :param steps: The number of future steps to predict.
        :return: A dictionary containing the forecast, confidence interval, and standard error.
        """
        if self.model_fit is None:
            raise RuntimeError("Model is not trained. Call train() first.")

        try:
            # Get the forecast and confidence intervals
            forecast_results = self.model_fit.get_forecast(steps=steps)
            forecast = forecast_results.predicted_mean
            conf_int = forecast_results.conf_int()
            std_err = forecast_results.se_mean

            # Calculate a simple confidence score based on the width of the 95% CI
            # Smaller interval width implies higher confidence.
            # We normalize the width by the predicted price to get a relative measure.
            # Confidence = 1 - (CI_width / Predicted_Price)
            ci_width = conf_int.iloc[:, 1] - conf_int.iloc[:, 0]
            confidence_score = 1 - (ci_width / forecast.abs())
            # Clamp the score between 0 and 1
            confidence_score = confidence_score.clip(lower=0, upper=1)

            results = {
                "forecast": forecast.tolist(),
                "lower_ci": conf_int.iloc[:, 0].tolist(),
                "upper_ci": conf_int.iloc[:, 1].tolist(),
                "std_err": std_err.tolist(),
                "confidence_score": confidence_score.tolist()
            }
            return results

        except Exception as e:
            logger.error(f"Error during prediction: {e}")
            raise

    def predict_multi_horizon(self) -> Dict[str, Dict[str, Any]]:
        """
        Generates predictions for the predefined time horizons (1h, 4h, 24h).

        :return: A dictionary where keys are the horizon labels (e.g., '1h') and
                 values are the prediction results dictionary.
        """
        multi_horizon_predictions: Dict[str, Dict[str, Any]] = {}
        for horizon, steps in PREDICTION_HORIZONS.items():
            try:
                # We only need the first prediction for each horizon, but we predict
                # up to the max step (24) and then select the relevant one.
                # A more efficient approach for production is to predict the maximum
                # horizon (24) and extract the required steps (1, 4, 24) from that single forecast.
                max_steps = max(PREDICTION_HORIZONS.values())
                if steps == max_steps:
                    prediction_results = self.predict(steps=max_steps)
                else:
                    # Predict up to the max steps and slice the result
                    full_forecast = self.predict(steps=max_steps)
                    prediction_results = {
                        k: v[steps - 1] for k, v in full_forecast.items()
                    }
                    # Convert single values back to list for consistency with output schema
                    for k in prediction_results:
                        if not isinstance(prediction_results[k], list):
                            prediction_results[k] = [prediction_results[k]]

                multi_horizon_predictions[horizon] = prediction_results
                logger.info(f"Prediction for {horizon} (step {steps}) generated.")

            except Exception as e:
                logger.error(f"Could not generate prediction for {horizon}: {e}")
                multi_horizon_predictions[horizon] = {"error": str(e)}

        return multi_horizon_predictions

    def evaluate(self, test_series: pd.Series, train_series: pd.Series) -> Dict[str, float]:
        """
        Evaluates the model's performance on the test set.

        The evaluation is done by generating a forecast for the length of the test set
        starting from the end of the training data.

        :param test_series: The actual values from the test set.
        :param train_series: The actual values from the training set (needed for refitting).
        :return: A dictionary of evaluation metrics (MAE, RMSE, Accuracy).
        """
        if self.model_fit is None:
            raise RuntimeError("Model is not trained. Call train() first.")

        try:
            # Re-fit the model on the full training data to ensure the forecast starts
            # exactly after the last training point.
            # We use the existing model_fit object to generate the forecast.
            # The forecast starts at the next time step after the training data ends.
            start_index = len(train_series)
            end_index = len(train_series) + len(test_series) - 1

            forecast_results = self.model_fit.get_prediction(start=start_index, end=end_index)
            predictions = forecast_results.predicted_mean

            # Ensure predictions and test_series have the same length and index alignment
            predictions = predictions.reindex(test_series.index)

            # Calculate metrics
            mae = mean_absolute_error(test_series, predictions)
            rmse = np.sqrt(mean_squared_error(test_series, predictions))

            # Simple "Accuracy": Directional accuracy (up/down)
            # This is a common, though often misleading, metric in trading.
            # We compare the direction of change from the last known training point.
            last_train_price = train_series.iloc[-1]
            actual_direction = (test_series.iloc[0] > last_train_price)
            predicted_direction = (predictions.iloc[0] > last_train_price)
            directional_accuracy = (actual_direction == predicted_direction) * 1.0

            # A more robust "Accuracy" for time series is often based on the sign of the change
            # from the previous step.
            actual_changes = np.sign(test_series.diff().dropna())
            predicted_changes = np.sign(predictions.diff().dropna())
            # Align the series for comparison
            min_len = min(len(actual_changes), len(predicted_changes))
            accuracy_count = (actual_changes.iloc[:min_len] == predicted_changes.iloc[:min_len]).sum()
            accuracy = accuracy_count / min_len if min_len > 0 else 0.0

            metrics = {
                "MAE": mae,
                "RMSE": rmse,
                "Directional_Accuracy_First_Step": directional_accuracy,
                "Step_Change_Accuracy": accuracy
            }
            logger.info(f"Model evaluation complete: {metrics}")
            return metrics

        except Exception as e:
            logger.error(f"Error during model evaluation: {e}")
            return {"MAE": -1, "RMSE": -1, "Directional_Accuracy_First_Step": -1, "Step_Change_Accuracy": -1}

    def save_model(self, file_path: str) -> None:
        """
        Serializes and saves the trained model fit object to a file using pickle.

        :param file_path: The path to save the model file.
        """
        if self.model_fit is None:
            raise RuntimeError("Model is not trained. Cannot save.")

        try:
            with open(file_path, 'wb') as f:
                pickle.dump(self.model_fit, f)
            logger.info(f"Model successfully saved to {file_path}")
        except Exception as e:
            logger.error(f"Error saving model to {file_path}: {e}")
            raise

    @classmethod
    def load_model(cls, file_path: str) -> 'ARIMAModel':
        """
        Loads a trained model fit object from a file and wraps it in a new ARIMAModel instance.

        :param file_path: The path to the saved model file.
        :return: A new ARIMAModel instance with the loaded model fit.
        """
        try:
            with open(file_path, 'rb') as f:
                model_fit = pickle.load(f)

            # Create a new instance and assign the loaded fit object
            instance = cls(order=model_fit.model.order)
            instance.model_fit = model_fit
            logger.info(f"Model successfully loaded from {file_path}")
            return instance
        except Exception as e:
            logger.error(f"Error loading model from {file_path}: {e}")
            raise

# --- Example Usage (for testing and demonstration) ---
def main():
    """
    Demonstrates the usage of the ARIMAModel class.
    This part is for testing and should be removed or protected in a production module.
    """
    logger.info("Starting ARIMAModel demonstration.")

    # 1. Create dummy OHLCV data (100 hours of data)
    np.random.seed(42)
    dates = pd.date_range(start='2023-01-01', periods=100, freq='H')
    close_prices = 100 + np.cumsum(np.random.randn(100) * 0.5)
    data = pd.DataFrame({
        'open': close_prices - np.random.rand(100),
        'high': close_prices + np.random.rand(100),
        'low': close_prices - 2 * np.random.rand(100),
        'close': close_prices,
        'volume': np.random.randint(1000, 5000, 100)
    }, index=dates)

    # 2. Initialize and Train the model
    arima_model = ARIMAModel(order=(5, 1, 0))
    try:
        train_series, test_series = arima_model.train(data, split_ratio=0.9)
    except Exception as e:
        logger.error(f"Training failed in main: {e}")
        return

    # 3. Evaluate the model
    metrics = arima_model.evaluate(test_series, train_series)
    logger.info(f"Evaluation Metrics: {metrics}")

    # 4. Generate multi-horizon predictions
    predictions = arima_model.predict_multi_horizon()
    logger.info("Multi-Horizon Predictions:")
    for horizon, result in predictions.items():
        logger.info(f"  {horizon} Prediction: {result['forecast'][0]:.2f} (CI: {result['lower_ci'][0]:.2f} - {result['upper_ci'][0]:.2f}), Confidence: {result['confidence_score'][0]:.2f}")

    # 5. Demonstrate saving and loading
    temp_model_path = "/tmp/arima_model_fit.pkl"
    try:
        arima_model.save_model(temp_model_path)
        loaded_model = ARIMAModel.load_model(temp_model_path)

        # Verify loaded model can predict
        loaded_predictions = loaded_model.predict_multi_horizon()
        logger.info("Loaded Model Predictions (1h):")
        logger.info(f"  1h Prediction: {loaded_predictions['1h']['forecast'][0]:.2f}")

    except Exception as e:
        logger.error(f"Save/Load demonstration failed: {e}")

    logger.info("ARIMAModel demonstration finished.")

if __name__ == "__main__":
    # This block is typically for testing and should be protected or removed in a production module
    # main()
    pass
