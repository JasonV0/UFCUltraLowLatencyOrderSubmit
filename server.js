// server.js - Backend for Polymarket US UFC Trader
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const GATEWAY_API = 'https://gateway.polymarket.us';
const TRADING_API = 'https://api.polymarket.us';
const MARKETS_WS_URL = 'wss://api.polymarket.us/v1/ws/markets';
const MARKETS_WS_PATH = '/v1/ws/markets';
const KEEP_ALIVE_AGENT = new https.Agent({
    keepAlive: true,
    maxSockets: 64,
    keepAliveMsecs: 1000
});
const UFC_LEAGUE_SLUG = 'ufc';
const MMA_SPORT_SLUG = 'mma';
const FIGHT_WINNER_MARKET_TYPE = 'ufc_fight_winner';
const EVENT_PAGE_SIZE = 100;
const QUOTE_CACHE_MS = 250;
const CLIENT_QUOTE_MAX_AGE_MS = 1500;
const DEFAULT_SLIPPAGE_TICKS = 8;
const MARKET_ORDER_SLIPPAGE_TICKS = 12;
const STREAM_RECONNECT_MS = 1000;
const STREAM_IDLE_MS = 15000;
const CLIENT_WS_HEARTBEAT_MS = 15000;
const KEEPALIVE_TRADING_PATH = '/v1/orders/open';

const gatewayClient = axios.create({
    baseURL: GATEWAY_API,
    timeout: 5000,
    httpsAgent: KEEP_ALIVE_AGENT,
    headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
    }
});

const tradingClient = axios.create({
    baseURL: TRADING_API,
    timeout: 5000,
    httpsAgent: KEEP_ALIVE_AGENT,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
});

const sessions = new Map();
const quoteCache = new Map();
const quoteStreams = new Map();

const ACTION_MAP = {
    BUY_FIGHTER1: {
        intent: 'ORDER_INTENT_BUY_LONG',
        quoteSide: 'yesAsk',
        displaySide: 'fighter1',
        yesPriceDirection: 1
    },
    BUY_FIGHTER2: {
        intent: 'ORDER_INTENT_BUY_SHORT',
        quoteSide: 'yesBid',
        displaySide: 'fighter2',
        yesPriceDirection: -1
    },
    SELL_FIGHTER2: {
        intent: 'ORDER_INTENT_SELL_SHORT',
        quoteSide: 'yesAsk',
        displaySide: 'fighter2',
        yesPriceDirection: 1
    },
    SELL_FIGHTER1: {
        intent: 'ORDER_INTENT_SELL_LONG',
        quoteSide: 'yesBid',
        displaySide: 'fighter1',
        yesPriceDirection: -1
    }
};

function base64ToSeed(secretKey) {
    const decoded = Buffer.from(secretKey, 'base64');

    if (decoded.length < 32) {
        throw new Error('Secret Key must be valid base64-encoded Ed25519 seed data');
    }

    return decoded.subarray(0, 32);
}

function buildSigningKey(secretKey) {
    const seed = base64ToSeed(secretKey);
    const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');

    return crypto.createPrivateKey({
        key: Buffer.concat([pkcs8Prefix, seed]),
        format: 'der',
        type: 'pkcs8'
    });
}

function buildAuthHeaders(session, method, path) {
    const timestamp = Date.now().toString();
    const message = `${timestamp}${method.toUpperCase()}${path}`;
    const signature = crypto.sign(null, Buffer.from(message), session.signingKey).toString('base64');

    return {
        'X-PM-Access-Key': session.keyId,
        'X-PM-Timestamp': timestamp,
        'X-PM-Signature': signature
    };
}

async function tradingRequest(session, method, path, data) {
    return tradingClient.request({
        url: path,
        method,
        data,
        headers: buildAuthHeaders(session, method, path)
    });
}

function parsePrice(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

// Gateway money fields are `Amount` objects ({ value, currency }), but a few
// legacy fields are still bare numbers or decimal strings.
function parseAmount(amount) {
    if (amount && typeof amount === 'object') {
        return parsePrice(amount.value);
    }

    return parsePrice(amount);
}

function clampPrice(value) {
    return Math.min(0.99, Math.max(0.01, value));
}

// 1 - 0.8 is 0.19999999999999996, which floors a full tick below the intended
// price. Snap the complement back to a clean decimal before it reaches the book.
function complementPrice(value) {
    return Number((1 - value).toFixed(6));
}

function formatPrice(value) {
    return clampPrice(value).toFixed(3);
}

function roundQuantity(value, minTradeQty) {
    const step = parsePrice(minTradeQty);

    if (step && step > 0) {
        const steps = Math.floor(Number((value / step).toFixed(6)));
        return Number((steps * step).toFixed(getDecimalPlaces(step)));
    }

    return Number(value.toFixed(4));
}

function getDecimalPlaces(value) {
    const text = String(value);
    if (text.includes('e-')) {
        return Number(text.split('e-')[1]);
    }

    const parts = text.split('.');
    return parts[1] ? parts[1].length : 0;
}

function roundToTick(value, tickSize, direction) {
    const normalizedTick = tickSize > 0 ? tickSize : 0.01;
    const tickCount = Number((value / normalizedTick).toFixed(6));
    const roundedTickCount = direction === 'up'
        ? Math.ceil(tickCount)
        : direction === 'down'
            ? Math.floor(tickCount)
            : Math.round(tickCount);

    return Number((roundedTickCount * normalizedTick).toFixed(getDecimalPlaces(normalizedTick)));
}

function maskKeyId(keyId) {
    if (keyId.length <= 8) return keyId;
    return `${keyId.slice(0, 4)}...${keyId.slice(-4)}`;
}

function getSideLabel(side) {
    return side?.description || side?.team?.name || side?.identifier || null;
}

function getScheduledDate(market, event) {
    return event?.startTime ||
        event?.startDate ||
        market?.gameStartTime ||
        market?.endDate ||
        null;
}

function isWithinNextWeek(scheduledDate) {
    const maxScheduledTime = Date.now() + (7 * 24 * 60 * 60 * 1000);
    const scheduledTime = scheduledDate ? new Date(scheduledDate).getTime() : Number.NaN;

    return Number.isFinite(scheduledTime) && scheduledTime <= maxScheduledTime;
}

// `sportsMarketType` is the typed contract for identifying a market. The docs
// explicitly warn against parsing slugs or question text, both of which changed.
function isFightWinnerMarket(market) {
    return market?.sportsMarketType === FIGHT_WINNER_MARKET_TYPE &&
        (market.marketSides || []).length === 2;
}

function isTradableMarket(market) {
    return market.active &&
        !market.closed &&
        market.status === 'MARKET_STATUS_OPEN' &&
        (market.marketSides || []).every(side => side.tradable !== false);
}

function normalizeMarket(market, event) {
    const longSide = (market.marketSides || []).find(side => side.long);
    const shortSide = (market.marketSides || []).find(side => side.long === false);
    const scheduledDate = getScheduledDate(market, event);

    return {
        id: market.id,
        slug: market.slug,
        eventSlug: event?.slug || null,
        // `question` is now a full sentence, so prefer the event title for display.
        title: event?.title || market.titleShort || market.title || market.question || 'Unknown fight',
        question: market.question || '',
        startDate: scheduledDate,
        endDate: market.endDate || event?.endDate || null,
        status: market.status || null,
        tickSize: parsePrice(market.orderPriceMinTickSize) || 0.01,
        minTradeQty: parsePrice(market.minimumTradeQty) || null,
        bestBid: parseAmount(market.bestBidQuote),
        bestAsk: parseAmount(market.bestAskQuote),
        longLabel: getSideLabel(longSide) || 'Fighter 1',
        shortLabel: getSideLabel(shortSide) || 'Fighter 2'
    };
}

function sortMarkets(markets) {
    return markets.sort((a, b) => {
        const aTime = a.startDate ? new Date(a.startDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.startDate ? new Date(b.startDate).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
    });
}

async function fetchEventMarkets(path) {
    const response = await gatewayClient.get(path, {
        params: {
            limit: EVENT_PAGE_SIZE,
            offset: 0
        }
    });

    const markets = new Map();
    for (const event of response.data?.events || []) {
        if (event.closed || event.active === false) continue;

        for (const market of event.markets || []) {
            if (!isFightWinnerMarket(market)) continue;
            if (!isTradableMarket(market)) continue;

            const normalized = normalizeMarket(market, event);
            if (!isWithinNextWeek(normalized.startDate)) continue;

            markets.set(normalized.slug, normalized);
        }
    }

    return Array.from(markets.values());
}

async function fetchActiveUfcMarkets() {
    // `ufc` is a league inside the `mma` sport. Hitting the sport endpoint with a
    // league slug returns an empty list with a 200, so try the league first and
    // fall back to the whole sport (which also covers DWCS cards).
    const sources = [
        `/v2/leagues/${UFC_LEAGUE_SLUG}/events`,
        `/v2/sports/${MMA_SPORT_SLUG}/events`
    ];

    let lastError = null;

    for (const path of sources) {
        try {
            const markets = await fetchEventMarkets(path);
            if (markets.length > 0) {
                return sortMarkets(markets);
            }
        } catch (error) {
            lastError = error;
            console.warn(`Event lookup failed for ${path}:`, extractErrorMessage(error));
        }
    }

    if (lastError) throw lastError;

    return [];
}

function normalizeQuote(slug, marketData) {
    const yesBid = parseAmount(marketData?.bestBid);
    const yesAsk = parseAmount(marketData?.bestAsk);
    // `lastPriceSample` is deprecated in favour of longQuote/shortQuote.
    const currentYes = parseAmount(marketData?.longQuote) ??
        parseAmount(marketData?.lastPriceSample?.longPx) ??
        parseAmount(marketData?.currentPx) ??
        parseAmount(marketData?.lastTradePx);
    const shortQuote = parseAmount(marketData?.shortQuote) ??
        parseAmount(marketData?.lastPriceSample?.shortPx);
    const currentNo = shortQuote ?? (currentYes !== null ? 1 - currentYes : null);

    return {
        slug,
        yesBid,
        yesAsk,
        noBid: yesAsk !== null ? clampPrice(complementPrice(yesAsk)) : null,
        noAsk: yesBid !== null ? clampPrice(complementPrice(yesBid)) : null,
        currentYes: currentYes !== null ? clampPrice(currentYes) : null,
        currentNo: currentNo !== null ? clampPrice(currentNo) : null
    };
}

function storeQuote(quote) {
    quoteCache.set(quote.slug, { quote, ts: Date.now() });
    return quote;
}

function quoteStreamKey(sessionId, slug) {
    return `${sessionId}:${slug}`;
}

function sendSse(res, event, payload) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// Quote streams fan out to "clients" that only need a send(event, payload)
// method, so the same bridge can feed both SSE responses and WebSockets.
function createSseClient(res) {
    return {
        send: (event, payload) => sendSse(res, event, payload)
    };
}

function createWsClient(ws) {
    return {
        send: (event, payload) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: event, ...payload }));
            }
        }
    };
}

function detachClient(stream, client) {
    stream.clients.delete(client);

    if (stream.clients.size === 0 && !stream.idleTimer) {
        stream.idleTimer = setTimeout(() => {
            closeQuoteStream(stream.key);
        }, STREAM_IDLE_MS);
    }
}

async function attachClient(sessionId, slug, client) {
    const stream = await ensureQuoteStream(sessionId, slug);
    stream.clients.add(client);

    client.send('status', {
        slug,
        level: 'info',
        message: 'Opening live bridge...',
        ts: Date.now()
    });

    const cached = quoteCache.get(slug);
    if (cached?.quote) {
        client.send('quote', {
            ...cached.quote,
            source: cached.quote.source === 'bridge' ? 'bridge' : 'seed'
        });
    } else {
        const quote = await fetchQuote(slug, true);
        client.send('quote', { ...quote, source: 'seed' });
    }

    return stream;
}

function getQuoteStream(sessionId, slug) {
    const key = quoteStreamKey(sessionId, slug);
    let stream = quoteStreams.get(key);

    if (!stream) {
        stream = {
            key,
            sessionId,
            slug,
            ws: null,
            clients: new Set(),
            reconnectTimer: null,
            idleTimer: null
        };
        quoteStreams.set(key, stream);
    }

    return stream;
}

function broadcastQuoteStreamStatus(stream, message, level = 'info') {
    for (const client of stream.clients) {
        client.send('status', {
            slug: stream.slug,
            level,
            message,
            ts: Date.now()
        });
    }
}

function connectQuoteStream(stream) {
    if (stream.ws && (
        stream.ws.readyState === WebSocket.OPEN ||
        stream.ws.readyState === WebSocket.CONNECTING
    )) {
        return;
    }

    const session = sessions.get(stream.sessionId);
    if (!session) {
        throw new Error('Session not found. Reconnect with your API keys.');
    }

    const ws = new WebSocket(MARKETS_WS_URL, {
        headers: buildAuthHeaders(session, 'GET', MARKETS_WS_PATH),
        perMessageDeflate: false
    });

    stream.ws = ws;

    ws.on('open', () => {
        ws.send(JSON.stringify({
            subscribe: {
                requestId: `quote-${stream.sessionId}-${Date.now()}`,
                subscriptionType: 'SUBSCRIPTION_TYPE_MARKET_DATA_LITE',
                marketSlugs: [stream.slug]
            }
        }));

        broadcastQuoteStreamStatus(stream, 'Live bridge connected.');
    });

    ws.on('message', (rawMessage) => {
        try {
            const message = JSON.parse(rawMessage.toString());
            const marketData = message.marketDataLite || message.marketData;
            if (!marketData || marketData.marketSlug !== stream.slug) {
                return;
            }

            const quote = storeQuote({
                ...normalizeQuote(stream.slug, marketData),
                fetchedAt: Date.now(),
                source: 'bridge'
            });

            for (const client of stream.clients) {
                client.send('quote', quote);
            }
        } catch (error) {
            console.error('Quote stream parse error:', error.message);
        }
    });

    ws.on('error', (error) => {
        console.error(`Quote stream error for ${stream.slug}:`, error.message);
        broadcastQuoteStreamStatus(stream, `Bridge error: ${error.message}`, 'warning');
    });

    ws.on('close', () => {
        stream.ws = null;

        if (!quoteStreams.has(stream.key) || stream.clients.size === 0) {
            return;
        }

        broadcastQuoteStreamStatus(stream, 'Bridge reconnecting...', 'warning');

        if (!stream.reconnectTimer) {
            stream.reconnectTimer = setTimeout(() => {
                stream.reconnectTimer = null;

                try {
                    connectQuoteStream(stream);
                } catch (error) {
                    console.error(`Quote stream reconnect failed for ${stream.slug}:`, error.message);
                    broadcastQuoteStreamStatus(stream, error.message, 'error');
                }
            }, STREAM_RECONNECT_MS);
        }
    });
}

function closeQuoteStream(key) {
    const stream = quoteStreams.get(key);
    if (!stream) {
        return;
    }

    quoteStreams.delete(key);

    if (stream.reconnectTimer) {
        clearTimeout(stream.reconnectTimer);
    }

    if (stream.idleTimer) {
        clearTimeout(stream.idleTimer);
    }

    if (stream.ws && (
        stream.ws.readyState === WebSocket.OPEN ||
        stream.ws.readyState === WebSocket.CONNECTING
    )) {
        stream.ws.close();
    }
}

async function ensureQuoteStream(sessionId, slug) {
    const stream = getQuoteStream(sessionId, slug);

    if (stream.idleTimer) {
        clearTimeout(stream.idleTimer);
        stream.idleTimer = null;
    }

    connectQuoteStream(stream);
    return stream;
}

async function fetchQuote(slug, forceRefresh = false) {
    const cached = quoteCache.get(slug);
    const now = Date.now();

    if (!forceRefresh && cached && (now - cached.ts) < QUOTE_CACHE_MS) {
        return cached.quote;
    }

    const response = await gatewayClient.get(`/v1/markets/${slug}/bbo`);
    const quote = {
        ...normalizeQuote(slug, response.data?.marketData),
        fetchedAt: now,
        source: 'http'
    };
    return storeQuote(quote);
}

function isFreshClientQuote(quote, marketSlug) {
    return Boolean(
        quote &&
        quote.slug === marketSlug &&
        Number.isFinite(Number(quote.fetchedAt)) &&
        (Date.now() - Number(quote.fetchedAt)) <= CLIENT_QUOTE_MAX_AGE_MS
    );
}

// Order of preference on the hot path: the server's own bridge cache (the WS
// feed writes into it continuously), then the quote the client tapped with,
// and only then a blocking HTTP round trip to the gateway.
async function resolveOrderQuote(marketSlug, clientQuote) {
    const cached = quoteCache.get(marketSlug);
    if (cached && (Date.now() - cached.ts) <= CLIENT_QUOTE_MAX_AGE_MS) {
        return cached.quote;
    }

    if (isFreshClientQuote(clientQuote, marketSlug)) {
        return clientQuote;
    }

    return fetchQuote(marketSlug, true);
}

function getReferenceYesPrice(action, quote) {
    const config = ACTION_MAP[action];
    if (!config) {
        throw new Error('Invalid trade action');
    }

    const directPrice = quote[config.quoteSide];
    if (directPrice !== null) return clampPrice(directPrice);
    if (quote.currentYes !== null) return clampPrice(quote.currentYes);

    throw new Error('No live quote available for this market');
}

function getDisplaySidePrice(action, yesReferencePrice) {
    return ACTION_MAP[action].displaySide === 'fighter1'
        ? clampPrice(yesReferencePrice)
        : clampPrice(complementPrice(yesReferencePrice));
}

function getYesPriceFromDisplaySide(action, displaySidePrice) {
    return ACTION_MAP[action].displaySide === 'fighter1'
        ? clampPrice(displaySidePrice)
        : clampPrice(complementPrice(displaySidePrice));
}

function getAggressiveLimitYesPrice(action, yesReferencePrice, tickSize) {
    const config = ACTION_MAP[action];
    const normalizedTickSize = tickSize > 0 ? tickSize : 0.01;
    const rawPrice = clampPrice(
        yesReferencePrice + (config.yesPriceDirection * DEFAULT_SLIPPAGE_TICKS * normalizedTickSize)
    );

    return clampPrice(
        roundToTick(rawPrice, normalizedTickSize, config.yesPriceDirection > 0 ? 'up' : 'down')
    );
}

function buildMarketOrderPayload({ action, marketSlug, notionalDollars, quote, marketMinTradeQty }) {
    const config = ACTION_MAP[action];
    if (!config) {
        throw new Error('Invalid trade action');
    }

    const numericNotional = Number(notionalDollars);
    if (!Number.isFinite(numericNotional) || numericNotional <= 0) {
        throw new Error('Enter a dollar amount greater than zero');
    }

    const yesReferencePrice = getReferenceYesPrice(action, quote);
    const displaySidePrice = getDisplaySidePrice(action, yesReferencePrice);
    const quantity = roundQuantity(numericNotional / displaySidePrice, marketMinTradeQty);

    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Order size is too small for current market prices');
    }

    return {
        request: {
            marketSlug,
            intent: config.intent,
            type: 'ORDER_TYPE_MARKET',
            tif: 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL',
            manualOrderIndicator: 'MANUAL_ORDER_INDICATOR_MANUAL',
            slippageTolerance: {
                currentPrice: {
                    value: formatPrice(yesReferencePrice),
                    currency: 'USD'
                },
                ticks: MARKET_ORDER_SLIPPAGE_TICKS
            },
            cashOrderQty: {
                value: numericNotional.toFixed(4),
                currency: 'USD'
            }
        },
        meta: {
            quantity,
            referenceYesPrice: yesReferencePrice,
            referenceSidePrice: displaySidePrice,
            notionalDollars: numericNotional,
            mode: 'market'
        }
    };
}

function buildLimitOrderPayload({ action, marketSlug, quantity, limitPrice, quote, marketTickSize, marketMinTradeQty }) {
    const config = ACTION_MAP[action];
    if (!config) {
        throw new Error('Invalid trade action');
    }

    const numericQuantity = roundQuantity(Number(quantity), marketMinTradeQty);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
        throw new Error('Enter a share quantity greater than zero');
    }

    const numericLimitPrice = Number(limitPrice);
    const yesReferencePrice = getReferenceYesPrice(action, quote);
    const normalizedTickSize = parsePrice(marketTickSize) || 0.01;
    const fighterSideLimitPrice = Number.isFinite(numericLimitPrice) && numericLimitPrice > 0
        ? clampPrice(numericLimitPrice)
        : getDisplaySidePrice(
            action,
            getAggressiveLimitYesPrice(action, yesReferencePrice, normalizedTickSize)
        );
    const limitYesPrice = roundToTick(
        getYesPriceFromDisplaySide(action, fighterSideLimitPrice),
        normalizedTickSize,
        config.yesPriceDirection > 0 ? 'up' : 'down'
    );
    const limitDisplaySidePrice = getDisplaySidePrice(action, limitYesPrice);

    return {
        request: {
            marketSlug,
            intent: config.intent,
            type: 'ORDER_TYPE_LIMIT',
            price: {
                value: formatPrice(limitYesPrice),
                currency: 'USD'
            },
            quantity: numericQuantity,
            tif: 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL',
            manualOrderIndicator: 'MANUAL_ORDER_INDICATOR_MANUAL'
        },
        meta: {
            quantity: numericQuantity,
            referenceYesPrice: yesReferencePrice,
            referenceSidePrice: getDisplaySidePrice(action, yesReferencePrice),
            limitYesPrice,
            limitSidePrice: limitDisplaySidePrice,
            mode: 'limit'
        }
    };
}

function buildOrderPayload(params) {
    if (params.executionMode === 'market') {
        return buildMarketOrderPayload(params);
    }

    return buildLimitOrderPayload(params);
}

function extractErrorMessage(error) {
    return error.response?.data?.message ||
        error.response?.data?.error ||
        error.response?.data?.details ||
        error.message;
}

app.post('/api/init', async (req, res) => {
    try {
        const { keyId, secretKey, sessionId } = req.body;

        if (!keyId || !secretKey || !sessionId) {
            return res.status(400).json({ error: 'Key ID, Secret Key, and session ID are required' });
        }

        const session = {
            keyId: String(keyId).trim(),
            signingKey: buildSigningKey(String(secretKey).trim())
        };

        for (const [streamKey, stream] of quoteStreams.entries()) {
            if (stream.sessionId === sessionId) {
                closeQuoteStream(streamKey);
            }
        }

        await tradingRequest(session, 'GET', '/v1/orders/open');
        sessions.set(sessionId, session);

        res.json({
            success: true,
            account: maskKeyId(session.keyId)
        });
    } catch (error) {
        console.error('Init error:', extractErrorMessage(error));
        res.status(500).json({ error: extractErrorMessage(error) });
    }
});

app.get('/api/markets', async (req, res) => {
    try {
        const markets = await fetchActiveUfcMarkets();
        res.json({ success: true, markets });
    } catch (error) {
        console.error('Markets error:', extractErrorMessage(error));
        res.status(500).json({ error: extractErrorMessage(error) });
    }
});

app.get('/api/quote', async (req, res) => {
    try {
        const slug = req.query.slug;
        if (!slug) {
            return res.status(400).json({ error: 'Market slug is required' });
        }

        const quote = await fetchQuote(String(slug));
        res.json({ success: true, quote });
    } catch (error) {
        console.error('Quote error:', extractErrorMessage(error));
        res.status(500).json({ error: extractErrorMessage(error) });
    }
});

app.get('/api/quote-stream', async (req, res) => {
    const sessionId = String(req.query.sessionId || '');
    const slug = String(req.query.slug || '');

    if (!sessionId || !slug) {
        return res.status(400).json({ error: 'Session ID and market slug are required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(401).json({ error: 'Session not found. Reconnect with your API keys.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const keepAliveHandle = setInterval(() => {
        res.write(': keepalive\n\n');
    }, 15000);

    try {
        const client = createSseClient(res);
        const stream = await attachClient(sessionId, slug, client);

        req.on('close', () => {
            clearInterval(keepAliveHandle);
            detachClient(stream, client);
        });
    } catch (error) {
        clearInterval(keepAliveHandle);
        sendSse(res, 'status', {
            slug,
            level: 'error',
            message: extractErrorMessage(error),
            ts: Date.now()
        });
        res.end();
    }
});

app.post('/api/keepalive', async (req, res) => {
    try {
        const { sessionId } = req.body;
        const session = sessions.get(sessionId);

        if (!session) {
            return res.status(401).json({ error: 'Session not found. Reconnect with your API keys.' });
        }

        const startedAt = Date.now();
        await tradingRequest(session, 'GET', KEEPALIVE_TRADING_PATH);

        res.json({
            success: true,
            warmedAt: Date.now(),
            latencyMs: Date.now() - startedAt
        });
    } catch (error) {
        console.error('Keepalive error:', extractErrorMessage(error));
        res.status(500).json({
            success: false,
            error: extractErrorMessage(error)
        });
    }
});

async function placeOrder(session, params) {
    const {
        marketSlug,
        action,
        executionMode,
        notionalDollars,
        quantity,
        limitPrice,
        quote,
        marketTickSize,
        marketMinTradeQty
    } = params;

    if (!marketSlug) {
        throw new Error('Market slug is required');
    }

    const slug = String(marketSlug);
    const liveQuote = await resolveOrderQuote(slug, quote);
    const { request, meta } = buildOrderPayload({
        action,
        executionMode,
        marketSlug: slug,
        notionalDollars,
        quantity,
        limitPrice,
        quote: liveQuote,
        marketTickSize,
        marketMinTradeQty
    });

    const response = await tradingRequest(session, 'POST', '/v1/orders', request);

    return {
        success: true,
        orderID: response.data?.id,
        executions: response.data?.executions || [],
        mode: meta.mode,
        quantity: meta.quantity,
        notionalDollars: meta.notionalDollars,
        referenceYesPrice: meta.referenceYesPrice,
        referenceSidePrice: meta.referenceSidePrice,
        limitYesPrice: meta.limitYesPrice,
        limitSidePrice: meta.limitSidePrice
    };
}

app.post('/api/order', async (req, res) => {
    try {
        const session = sessions.get(req.body.sessionId);

        if (!session) {
            return res.status(401).json({ error: 'Session not found. Reconnect with your API keys.' });
        }

        res.json(await placeOrder(session, req.body));
    } catch (error) {
        console.error('Order error:', extractErrorMessage(error));
        res.status(500).json({
            success: false,
            error: extractErrorMessage(error)
        });
    }
});

// ---------------------------------------------------------------------------
// Client WebSocket: quotes down, orders up, on one persistent connection.
// Avoids the phone paying a fresh TCP+TLS handshake on the tap.
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const clientWss = new WebSocket.Server({ server, path: '/ws', perMessageDeflate: false });

function wsSend(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

async function handleClientMessage(ws, ctx, message) {
    const session = sessions.get(ctx.sessionId);
    if (!session) {
        wsSend(ws, { type: 'error', message: 'Session not found. Reconnect with your API keys.' });
        ws.close(4401, 'Session not found');
        return;
    }

    switch (message.type) {
        case 'subscribe': {
            const slug = String(message.slug || '');
            if (!slug) return;

            if (ctx.stream && ctx.stream.slug !== slug) {
                detachClient(ctx.stream, ctx.client);
                ctx.stream = null;
            }

            if (!ctx.stream) {
                ctx.stream = await attachClient(ctx.sessionId, slug, ctx.client);
            }
            return;
        }

        case 'order': {
            const startedAt = Date.now();
            try {
                const result = await placeOrder(session, message);
                wsSend(ws, { type: 'order_result', id: message.id, latencyMs: Date.now() - startedAt, ...result });
            } catch (error) {
                console.error('Order error (ws):', extractErrorMessage(error));
                wsSend(ws, {
                    type: 'order_result',
                    id: message.id,
                    success: false,
                    latencyMs: Date.now() - startedAt,
                    error: extractErrorMessage(error)
                });
            }
            return;
        }

        case 'keepalive': {
            const startedAt = Date.now();
            try {
                await tradingRequest(session, 'GET', KEEPALIVE_TRADING_PATH);
                wsSend(ws, { type: 'keepalive', success: true, latencyMs: Date.now() - startedAt });
            } catch (error) {
                wsSend(ws, { type: 'keepalive', success: false, error: extractErrorMessage(error) });
            }
            return;
        }

        default:
            return;
    }
}

clientWss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const sessionId = String(url.searchParams.get('sessionId') || '');

    if (!sessionId || !sessions.has(sessionId)) {
        wsSend(ws, { type: 'error', message: 'Session not found. Reconnect with your API keys.' });
        ws.close(4401, 'Session not found');
        return;
    }

    const ctx = { sessionId, client: createWsClient(ws), stream: null };
    ws.isAlive = true;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (raw) => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

        handleClientMessage(ws, ctx, message).catch((error) => {
            console.error('Client ws handler error:', extractErrorMessage(error));
            wsSend(ws, { type: 'error', message: extractErrorMessage(error) });
        });
    });

    ws.on('close', () => {
        if (ctx.stream) {
            detachClient(ctx.stream, ctx.client);
            ctx.stream = null;
        }
    });

    ws.on('error', (error) => {
        console.error('Client ws error:', error.message);
    });

    wsSend(ws, { type: 'ready' });
});

// Detect half-open mobile connections so the client reconnects instead of
// believing a dead socket is warm.
const heartbeat = setInterval(() => {
    for (const ws of clientWss.clients) {
        if (ws.isAlive === false) {
            ws.terminate();
            continue;
        }

        ws.isAlive = false;
        ws.ping();
    }
}, CLIENT_WS_HEARTBEAT_MS);
heartbeat.unref();

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log('Ready to trade Polymarket US UFC markets');
    });
}

module.exports = {
    app,
    server,
    sessions,
    buildSigningKey,
    buildOrderPayload,
    fetchActiveUfcMarkets,
    normalizeMarket,
    normalizeQuote,
    roundQuantity
};
