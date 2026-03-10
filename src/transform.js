/**
 * transform.js
 *
 * Converts raw Barchart API records into clean output schema.
 * Computes derived fields: volumeOIRatio, premium, sentiment, recordId.
 *
 * recordId is a deterministic hash of contractName + tradeTime.
 * Users can use this to deduplicate across multiple runs —
 * same contract at the same tradeTime = same recordId.
 */

/**
 * Generates a simple deterministic hash string from a value.
 * Not cryptographic — just for deduplication.
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * Derives sentiment from how a contract was traded.
 * - At or above ask = buyers aggressive = bullish
 * - At or below bid = sellers aggressive = bearish
 * - Between bid and ask = neutral
 */
function deriveSentiment(lastPrice, bidPrice, askPrice) {
    if (lastPrice == null || bidPrice == null || askPrice == null) return 'neutral';
    const last = parseFloat(lastPrice);
    const bid = parseFloat(bidPrice);
    const ask = parseFloat(askPrice);
    if (ask > bid) {
        const midpoint = (bid + ask) / 2;
        if (last >= ask) return 'bullish';
        if (last <= bid) return 'bearish';
        if (last > midpoint) return 'bullish';
        if (last < midpoint) return 'bearish';
    }
    return 'neutral';
}

/**
 * Safely parses a number, returning null if not valid.
 */
function num(val) {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
}

/**
 * Transforms a raw unusual-activity record from Barchart into our output schema.
 * Reads from record.raw.* for clean numbers where available.
 */
export function transformUnusualActivity(item) {
    // Barchart returns both formatted strings (top level) and clean numbers (raw.*)
    // Always prefer raw.* for numeric fields
    const raw = item.raw || item;

    const volume = num(raw.volume);
    const openInterest = num(raw.openInterest);
    const lastPrice = num(raw.lastPrice);
    const bidPrice = num(raw.bidPrice);
    const askPrice = num(raw.askPrice);

    const volumeOIRatio =
        raw.volumeOpenInterestRatio != null
            ? num(raw.volumeOpenInterestRatio)
            : volume != null && openInterest != null && openInterest > 0
            ? parseFloat((volume / openInterest).toFixed(2))
            : null;

    const premium =
        lastPrice != null && volume != null
            ? Math.round(lastPrice * volume * 100)
            : null;

    const contractName = raw.symbolCode || item.symbolCode || null;
    const tradeTime = raw.tradeTime
        ? new Date(raw.tradeTime * 1000).toISOString()
        : item.tradeTime || null;

    const recordId = contractName && tradeTime
        ? simpleHash(contractName + '|' + tradeTime)
        : null;

    return {
        recordId,
        ticker: raw.baseSymbol || item.baseSymbol || null,
        contractName,
        type: (raw.symbolType || item.symbolType || '').toLowerCase() === 'call' ? 'call' : 'put',
        strike: num(raw.strikePrice),
        expiration: raw.expirationDate || item.expirationDate || null,
        daysToExpiry: num(raw.daysToExpiration),
        lastPrice,
        bid: bidPrice,
        ask: askPrice,
        volume,
        openInterest,
        volumeOIRatio,
        impliedVolatility: num(raw.volatility),
        weightedIV: num(raw.weightedImpliedVolatility),
        delta: num(raw.delta),
        moneyness: num(raw.moneyness),
        premium,
        underlyingPrice: num(raw.baseLastPrice),
        sentiment: deriveSentiment(lastPrice, bidPrice, askPrice),
        tradeTime,
        retrievedAt: new Date().toISOString(),
        source: 'barchart-unusual-activity',
    };
}

/**
 * Transforms a raw options chain record into our output schema.
 */
export function transformOptionsChain(item, ticker) {
    const raw = item.raw || item;

    const volume = num(raw.volume);
    const openInterest = num(raw.openInterest);
    const lastPrice = num(raw.lastPrice);
    const bidPrice = num(raw.bidPrice);
    const askPrice = num(raw.askPrice);

    const volumeOIRatio =
        volume != null && openInterest != null && openInterest > 0
            ? parseFloat((volume / openInterest).toFixed(2))
            : null;

    const premium =
        lastPrice != null && volume != null
            ? Math.round(lastPrice * volume * 100)
            : null;

    const contractName = raw.symbolCode || item.symbolCode || null;
    const retrievedAt = new Date().toISOString();
    const recordId = contractName ? simpleHash(contractName + '|' + retrievedAt) : null;

    return {
        recordId,
        ticker: ticker || raw.baseSymbol || null,
        contractName,
        type: (raw.symbolType || item.symbolType || '').toLowerCase() === 'call' ? 'call' : 'put',
        strike: num(raw.strikePrice),
        expiration: raw.expirationDate || item.expirationDate || null,
        daysToExpiry: num(raw.daysToExpiration),
        lastPrice,
        bid: bidPrice,
        ask: askPrice,
        volume,
        openInterest,
        volumeOIRatio,
        impliedVolatility: num(raw.volatility),
        weightedIV: num(raw.weightedImpliedVolatility),
        delta: num(raw.delta),
        premium,
        sentiment: deriveSentiment(lastPrice, bidPrice, askPrice),
        retrievedAt,
        source: 'barchart-options-chain',
    };
}

/**
 * Transforms a raw ticker flow record into our output schema.
 */
export function transformTickerFlow(item, ticker) {
    const raw = item.raw || item;

    const volume = num(raw.volume);
    const lastPrice = num(raw.lastPrice);
    const bidPrice = num(raw.bidPrice);
    const askPrice = num(raw.askPrice);

    const premium =
        raw.premium != null
            ? num(raw.premium)
            : lastPrice != null && volume != null
            ? Math.round(lastPrice * volume * 100)
            : null;

    const tradeConditionMap = {
        'SWEEP': 'sweep', 'BLOCK': 'block', 'SPLIT': 'split', 'FLOOR': 'floor',
    };
    const rawCondition = (raw.tradeCondition || '').toUpperCase();
    const tradeCondition = tradeConditionMap[rawCondition] || raw.tradeCondition || null;

    const contractName = raw.symbolCode || item.symbolCode || null;
    const tradeTime = raw.tradeTime
        ? new Date(raw.tradeTime * 1000).toISOString()
        : item.tradeTime || null;

    const recordId = contractName && tradeTime
        ? simpleHash(contractName + '|' + tradeTime)
        : null;

    return {
        recordId,
        ticker: ticker || raw.baseSymbol || null,
        contractName,
        type: (raw.symbolType || item.symbolType || '').toLowerCase() === 'call' ? 'call' : 'put',
        strike: num(raw.strikePrice),
        expiration: raw.expirationDate || item.expirationDate || null,
        daysToExpiry: num(raw.daysToExpiration),
        lastPrice,
        bid: bidPrice,
        ask: askPrice,
        volume,
        openInterest: num(raw.openInterest),
        impliedVolatility: num(raw.volatility),
        premium,
        tradeCondition,
        sentiment: deriveSentiment(lastPrice, bidPrice, askPrice),
        tradeTime,
        retrievedAt: new Date().toISOString(),
        source: 'barchart-ticker-flow',
    };
}

/**
 * Applies user filters to a transformed result.
 */
export function applyFilters(record, filters) {
    const { optionType, minVolumeOIRatio, minPremium } = filters;

    if (optionType && optionType !== 'all') {
        if (record.type !== optionType) return false;
    }

    if (minVolumeOIRatio != null && minVolumeOIRatio > 0) {
        if (record.volumeOIRatio == null || record.volumeOIRatio < minVolumeOIRatio) return false;
    }

    if (minPremium != null && minPremium > 0) {
        if (record.premium == null || record.premium < minPremium) return false;
    }

    return true;
}
