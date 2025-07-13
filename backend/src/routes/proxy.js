import express from 'express';
import axios from 'axios';

const router = express.Router();

const POLONIEX_BASE_URL = 'https://api.poloniex.com/v3/futures';

// General proxy route
router.all('/poloniex/*', async (req, res) => {
  try {
    const endpoint = req.url.replace('/poloniex', '');
    const url = `${POLONIEX_BASE_URL}${endpoint}`;

    const response = await axios({
      method: req.method,
      url,
      data: req.body,
      params: req.query,
      headers: {
        'Content-Type': 'application/json',
        // Add authentication if needed
      }
    });

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(error.response?.status || 500).json({
      error: error.message
    });
  }
});

export default router;
