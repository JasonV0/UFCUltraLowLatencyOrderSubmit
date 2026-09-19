// Offline sanity check for quote parsing and order payload shape.
// Run with: node scripts/check-order-payloads.js
const assert = require('assert');
const { buildOrderPayload, normalizeQuote, roundQuantity } = require('../server');

const SLUG = 'aec-ufc-gigchi-joabri-2026-09-19';

const quote = normalizeQuote(SLUG, {
    bestBid: { value: '0.2200', currency: 'USD' },
    bestAsk: { value: '0.2300', currency: 'USD' },
    longQuote: { value: '0.2300', currency: 'USD' },
    shortQuote: { value: '0.78', currency: 'USD' }
});

console.log('quote:', quote);
assert.strictEqual(quote.yesBid, 0.22);
assert.strictEqual(quote.yesAsk, 0.23);
assert.strictEqual(quote.currentYes, 0.23);
assert.strictEqual(quote.currentNo, 0.78);

for (const action of ['BUY_FIGHTER1', 'BUY_FIGHTER2', 'SELL_FIGHTER1', 'SELL_FIGHTER2']) {
    const { request } = buildOrderPayload({
        action,
        executionMode: 'market',
        marketSlug: SLUG,
        notionalDollars: 100,
        quote,
        marketTickSize: 0.01,
        marketMinTradeQty: 0.01
    });

    console.log(action, 'MARKET ->', JSON.stringify(request));
    assert.strictEqual(request.type, 'ORDER_TYPE_MARKET');
    assert.strictEqual(request.tif, 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL');
    assert.ok(request.intent.startsWith('ORDER_INTENT_'));
    assert.strictEqual(request.cashOrderQty.currency, 'USD');
}

const limit = buildOrderPayload({
    action: 'BUY_FIGHTER2',
    executionMode: 'limit',
    marketSlug: SLUG,
    quantity: 100.12345,
    limitPrice: 0.8,
    quote,
    marketTickSize: 0.01,
    marketMinTradeQty: 0.01
});

console.log('LIMIT ->', JSON.stringify(limit.request));
assert.strictEqual(limit.request.type, 'ORDER_TYPE_LIMIT');
// Buying fighter 2 at $0.80 is selling YES at $0.20.
assert.strictEqual(limit.request.price.value, '0.200');
assert.strictEqual(limit.request.quantity, 100.12);

assert.strictEqual(roundQuantity(123.4567, 1), 123);
assert.strictEqual(roundQuantity(123.4567, 0.01), 123.45);
assert.strictEqual(roundQuantity(123.4567, null), 123.4567);

console.log('\nAll order payload checks passed.');
