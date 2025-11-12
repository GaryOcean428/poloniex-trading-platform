import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
/**
 * Poloniex Spot API Service
 * Handles Spot trading operations
 */
class PoloniexSpotService {
    constructor() {
        this.baseURL = 'https://api.poloniex.com';
        this.timeout = 30000;
    }
    /**
     * Generate signature for authenticated requests
     */
    generateSignature(timestamp, method, requestPath, body, secret) {
        const message = timestamp + method + requestPath + (body || '');
        return crypto
            .createHmac('sha256', secret)
            .update(message)
            .digest('base64');
    }
    /**
     * Make authenticated request to Poloniex Spot API
     */
    async makeRequest(credentials, method, endpoint, body = null, params = {}) {
        try {
            const timestamp = Date.now();
            const requestPath = endpoint;
            const queryString = Object.keys(params).length > 0
                ? '?' + new URLSearchParams(params).toString()
                : '';
            const fullPath = requestPath + queryString;
            const bodyString = body ? JSON.stringify(body) : '';
            const signature = this.generateSignature(timestamp, method, fullPath, bodyString, credentials.apiSecret);
            const config = {
                method: method.toLowerCase(),
                url: `${this.baseURL}${fullPath}`,
                headers: {
                    'Content-Type': 'application/json',
                    'key': credentials.apiKey,
                    'signTimestamp': timestamp.toString(),
                    'signature': signature
                },
                timeout: this.timeout
            };
            if (body) {
                config.data = bodyString;
            }
            logger.info(`Making Poloniex Spot ${method} request to ${requestPath}`);
            const response = await axios(config);
            return response.data;
        }
        catch (error) {
            logger.error('Poloniex Spot API request error:', {
                endpoint: endpoint,
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
            throw error;
        }
    }
    /**
     * Get Spot account balances
     * Endpoint: GET /accounts/balances
     */
    async getAccountBalances(credentials) {
        try {
            const balances = await this.makeRequest(credentials, 'GET', '/accounts/balances');
            return balances;
        }
        catch (error) {
            logger.error('Error fetching spot balances:', error);
            throw error;
        }
    }
    /**
     * Get account information
     * Endpoint: GET /accounts
     */
    async getAccounts(credentials) {
        try {
            const accounts = await this.makeRequest(credentials, 'GET', '/accounts');
            return accounts;
        }
        catch (error) {
            logger.error('Error fetching accounts:', error);
            throw error;
        }
    }
    /**
     * Transfer between accounts
     * Endpoint: POST /accounts/transfer
     */
    async transferBetweenAccounts(credentials, params) {
        try {
            const { currency, amount, fromAccount, toAccount } = params;
            const body = {
                currency,
                amount: amount.toString(),
                fromAccount,
                toAccount
            };
            const result = await this.makeRequest(credentials, 'POST', '/accounts/transfer', body);
            return result;
        }
        catch (error) {
            logger.error('Error transferring between accounts:', error);
            throw error;
        }
    }
    /**
     * Get transfer history
     * Endpoint: GET /accounts/transfer
     */
    async getTransferHistory(credentials, params = {}) {
        try {
            const history = await this.makeRequest(credentials, 'GET', '/accounts/transfer', null, params);
            return history;
        }
        catch (error) {
            logger.error('Error fetching transfer history:', error);
            throw error;
        }
    }
}
// Export singleton instance
const poloniexSpotService = new PoloniexSpotService();
export default poloniexSpotService;
