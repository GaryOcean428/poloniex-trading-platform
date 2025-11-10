/**
 * WebSocket Server Event Types
 * Aligned with @types/ws and Poloniex V3 API specifications
 */
// Core WebSocket Events (matching @types/ws)
export var WebSocketEvents;
(function (WebSocketEvents) {
    // Connection lifecycle events
    WebSocketEvents["OPEN"] = "open";
    WebSocketEvents["CLOSE"] = "close";
    WebSocketEvents["ERROR"] = "error";
    WebSocketEvents["MESSAGE"] = "message";
    WebSocketEvents["PING"] = "ping";
    WebSocketEvents["PONG"] = "pong";
    // Custom application events
    WebSocketEvents["CONNECTED"] = "connected";
    WebSocketEvents["DISCONNECTED"] = "disconnected";
    WebSocketEvents["RECONNECTING"] = "reconnecting";
    WebSocketEvents["RECONNECTED"] = "reconnected";
    WebSocketEvents["WELCOME"] = "welcome";
    WebSocketEvents["ACK"] = "ack";
})(WebSocketEvents || (WebSocketEvents = {}));
// Poloniex V3 API Events
export var PoloniexEvents;
(function (PoloniexEvents) {
    // Market data events
    PoloniexEvents["TICKER"] = "ticker";
    PoloniexEvents["ORDER_BOOK"] = "orderbook";
    PoloniexEvents["TRADE"] = "trade";
    PoloniexEvents["KLINE"] = "kline";
    PoloniexEvents["FUNDING"] = "funding";
    // Account events (private channels)
    PoloniexEvents["ACCOUNT"] = "account";
    PoloniexEvents["POSITION"] = "position";
    PoloniexEvents["ORDER"] = "order";
    PoloniexEvents["TRADE_EXECUTION"] = "tradeExecution";
    // System events
    PoloniexEvents["SUBSCRIBE"] = "subscribe";
    PoloniexEvents["UNSUBSCRIBE"] = "unsubscribe";
    PoloniexEvents["SUBSCRIPTION_SUCCESS"] = "subscriptionSuccess";
    PoloniexEvents["SUBSCRIPTION_ERROR"] = "subscriptionError";
})(PoloniexEvents || (PoloniexEvents = {}));
// Combined event enum for frontend use
export var ClientWebSocketEvents;
(function (ClientWebSocketEvents) {
    // Connection state
    ClientWebSocketEvents["CONNECTION_STATE_CHANGED"] = "connectionStateChanged";
    ClientWebSocketEvents["CONNECTION_ESTABLISHED"] = "connectionEstablished";
    ClientWebSocketEvents["CONNECTION_LOST"] = "connectionLost";
    // Market data
    ClientWebSocketEvents["MARKET_DATA"] = "marketData";
    ClientWebSocketEvents["TICKER_UPDATE"] = "tickerUpdate";
    ClientWebSocketEvents["ORDER_BOOK_UPDATE"] = "orderBookUpdate";
    ClientWebSocketEvents["TRADE_EXECUTED"] = "tradeExecuted";
    ClientWebSocketEvents["KLINE_UPDATE"] = "klineUpdate";
    // Account updates
    ClientWebSocketEvents["ACCOUNT_UPDATE"] = "accountUpdate";
    ClientWebSocketEvents["POSITION_UPDATE"] = "positionUpdate";
    ClientWebSocketEvents["ORDER_UPDATE"] = "orderUpdate";
    ClientWebSocketEvents["BALANCE_UPDATE"] = "balanceUpdate";
    // Subscription management
    ClientWebSocketEvents["MARKET_SUBSCRIBED"] = "marketSubscribed";
    ClientWebSocketEvents["MARKET_UNSUBSCRIBED"] = "marketUnsubscribed";
    // Error handling
    ClientWebSocketEvents["WEBSOCKET_ERROR"] = "websocketError";
    ClientWebSocketEvents["SUBSCRIPTION_ERROR"] = "subscriptionError";
    ClientWebSocketEvents["RECONNECTION_ERROR"] = "reconnectionError";
})(ClientWebSocketEvents || (ClientWebSocketEvents = {}));
// Poloniex V3 Topics (exact API paths)
export var PoloniexTopics;
(function (PoloniexTopics) {
    // Public market data
    PoloniexTopics["TICKER"] = "/contractMarket/ticker";
    PoloniexTopics["TICKER_V2"] = "/contractMarket/tickerV2";
    PoloniexTopics["LEVEL2"] = "/contractMarket/level2";
    PoloniexTopics["LEVEL3"] = "/contractMarket/level3";
    PoloniexTopics["EXECUTION"] = "/contractMarket/execution";
    PoloniexTopics["KLINE"] = "/contractMarket/candles";
    // Private account data
    PoloniexTopics["WALLET"] = "/contractAccount/wallet";
    PoloniexTopics["POSITION"] = "/contractAccount/position";
    PoloniexTopics["ORDERS"] = "/contractAccount/orders";
    PoloniexTopics["TRADES"] = "/contractAccount/trades";
    // System topics
    PoloniexTopics["FUNDING"] = "/contract/funding";
    PoloniexTopics["SYSTEM"] = "/contract/system";
})(PoloniexTopics || (PoloniexTopics = {}));
// Message types for WebSocket communication
export var MessageTypes;
(function (MessageTypes) {
    MessageTypes["WELCOME"] = "welcome";
    MessageTypes["PING"] = "ping";
    MessageTypes["PONG"] = "pong";
    MessageTypes["SUBSCRIBE"] = "subscribe";
    MessageTypes["UNSUBSCRIBE"] = "unsubscribe";
    MessageTypes["MESSAGE"] = "message";
    MessageTypes["ACK"] = "ack";
    MessageTypes["ERROR"] = "error";
})(MessageTypes || (MessageTypes = {}));
