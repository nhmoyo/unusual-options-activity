/**
 * transform.js
 *
 * Takes raw data from Barchart's API and converts it into
 * the clean, consistent output schema we output to the dataset.
 *
 * Also computes derived fields like:
 *   - volumeOIRatio
 *   - premium (total dollar value)
 *   - sentiment (bullish/bearish based on bid/ask side)
 */

/**
 * Derives sentiment from how a contract was traded.
 * - Traded at or above ask = buyers are aggressive = bullish
 * - Traded at or below bid = sellers are aggressive = bearish
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
 *
 * IMPORTANT: Barchart returns two versions of each field:
 *   - Top-level: formatted strings e.g. "30,822" (comma-separated), "03\/20\/26"
 *   - record.raw: clean numbers e.g. 30822, "2026-03-20"
 * We always use record.raw.* for numbers and dates.
 */
export function transformUnusualActivity(record) {
    // Use the nested raw object for clean values
    const r = record.raw || record;

    const volume = num(r.volume);
    const openInterest = num(r.openInterest);
    const lastPrice = num(r.lastPrice);
    const bidPrice = num(r.bidPrice);
    const askPrice = num(r.askPrice);

    // Barchart pre-computes this — use theirs, but recalculate as fallback
    const volumeOIRatio =
        num(r.volumeOpenInterestRatio) ??
        (volume != null && openInterest != null && openInterest > 0
            ? parseFloat((volume / openInterest).toFixed(2))
            : null);

    const premium =
        lastPrice != null && volume != null
            ? Math.round(lastPrice * volume * 100)
            : null;

    return {
        ticker: r.baseSymbol || null,
        contractName: r.symbol || null,
        type: (r.symbolType || '').toLowerCase() === 'call' ? 'call' : 'put',
        strike: num(r.strikePrice),
        expiration: r.expirationDate || null,       // already 'YYYY-MM-DD' in raw
        daysToExpiry: num(r.daysToExpiration),
        lastPrice,
        bid: bidPrice,
        ask: askPrice,
        volume,
        openInterest,
        volumeOIRatio,
        impliedVolatility: num(r.volatility),       // per-strike IV
        weightedIV: num(r.weightedImpliedVolatility), // 30-day weighted IV
        delta: num(r.delta),
        moneyness: num(r.moneyness),
        premium,
        underlyingPrice: num(r.baseLastPrice),
        sentiment: deriveSentiment(lastPrice, bidPrice, askPrice),
        tradeTime: r.tradeTime                       // unix timestamp in raw
            ? new Date(r.tradeTime * 1000).toISOString()
            : null,
        retrievedAt: new Date().toISOString(),
        source: 'barchart-unusual-activity',
    };
}

/**
 * Transforms a raw options chain record into our output schema.
 */
export function transformOptionsChain(raw, ticker) {
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

    return {
        ticker: ticker || raw.symbol || null,
        contractName: raw.symbolCode || null,
        type: (raw.optionType || '').toLowerCase() === 'call' ? 'call' : 'put',
        strike: num(raw.strikePrice),
        expiration: raw.expirationDate || null,
        daysToExpiry: num(raw.daysToExpiration),
        lastPrice,
        bid: bidPrice,
        ask: askPrice,
        midpoint: num(raw.midpoint),
        volume,
        openInterest,
        volumeOIRatio,
        impliedVolatility: num(raw.volatility),
        premium,
        percentFromLast: num(raw.percentFromLast),
        sentiment: deriveSentiment(lastPrice, bidPrice, askPrice),
        retrievedAt: new Date().toISOString(),
        source: 'barchart-options-chain',
    };
}

/**
 * Transforms a raw flow record into our output schema.
 */
export function transformTickerFlow(raw, ticker) {
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

    // Barchart flow includes trade condition codes (sweep, block, etc.)
    const tradeConditionMap = {
        'SWEEP': 'sweep',
        'BLOCK': 'block',
        'SPLIT': 'split',
        'FLOOR': 'floor',
    };
    const rawCondition = (raw.tradeCondition || '').toUpperCase();
    const tradeCondition = tradeConditionMap[rawCondition] || raw.tradeCondition || null;

    return {
        ticker: ticker || raw.symbol || null,
        contractName: raw.symbolCode || null,
        type: (raw.optionType || '').toLowerCase() === 'call' ? 'call' : 'put',
        strike: num(raw.strikePrice),
        expiration: raw.expirationDate || null,
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
        tradeTime: raw.tradeTime || null,
        retrievedAt: new Date().toISOString(),
        source: 'barchart-ticker-flow',
    };
}

/**
 * Applies user filters to a transformed result.
 * Returns true if the record passes all filters, false if it should be excluded.
 */
export function applyFilters(record, filters) {
    const { optionType, minVolumeOIRatio, minPremium } = filters;

    // Filter by option type (call/put)
    if (optionType && optionType !== 'all') {
        if (record.type !== optionType) return false;
    }

    // Filter by minimum volume/OI ratio
    if (minVolumeOIRatio != null && minVolumeOIRatio > 0) {
        if (record.volumeOIRatio == null || record.volumeOIRatio < minVolumeOIRatio) {
            return false;
        }
    }

    // Filter by minimum total premium
    if (minPremium != null && minPremium > 0) {
        if (record.premium == null || record.premium < minPremium) {
            return false;
        }
    }

    return true;
}
