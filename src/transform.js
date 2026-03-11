/**
 * transform.js
 *
 * Converts raw Barchart API records into clean output schema.
 * Computes derived fields: volumeOIRatio, premium, sentiment, recordId.
 *
 * recordId is a deterministic hash of a stable contract key.
 * The key is built from fields that are always present (ticker, type, strike,
 * expiration) so recordId is never null even when symbolCode is missing.
 *
 * Key strategy by mode:
 *   unusual-activity / ticker-flow  →  ticker|type|strike|expiration|tradeTime
 *   options-chain                   →  ticker|type|strike|expiration
 *
 * tradeTime is included for trade-level modes so that two fills on the same
 * contract at different times produce different recordIds.
 * It is omitted for options-chain because the chain is a snapshot — the
 * contract itself is the stable identity, regardless of when it was fetched.
 *
 * contractName (symbolCode) is still returned as a field when available,
 * but recordId no longer depends on it.
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
 * Builds a stable, human-readable contract key from fields that are always
 * present. Used as the input to simpleHash() for recordId generation.
 *
 * @param {string} ticker       - e.g. 'TSLA'
 * @param {string} type         - 'call' | 'put'
 * @param {number|null} strike  - e.g. 490
 * @param {string|null} expiry  - e.g. '2026-03-20'
 * @param {string|null} tradeTime - ISO string; pass null for snapshot modes
 * @returns {string}
 */
function buildContractKey(ticker, type, strike, expiry, tradeTime = null) {
    const parts = [
        (ticker || 'UNKNOWN').toUpperCase(),
        (type || 'unknown').toLowerCase(),
        strike != null ? String(strike) : 'nostrike',
        expiry || 'noexpiry',
    ];
    if (tradeTime) parts.push(tradeTime);
    return parts.join('|');
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

    const ticker = raw.baseSymbol || item.baseSymbol || null;
    const type = (raw.symbolType || item.symbolType || '').toLowerCase() === 'call' ? 'call' : 'put';
    const strike = num(raw.strikePrice);
    const expiration = raw.expirationDate || item.expirationDate || null;

    // recordId is always non-null — stable even when symbolCode is absent.
    // tradeTime is included so two fills on the same contract at different
    // times produce distinct recordIds.
    const recordId = simpleHash(buildContractKey(ticker, type, strike, expiration, tradeTime));

    return {
        recordId,
        ticker,
        contractName,
        type,
        strike,
        expiration,
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

    const resolvedTicker = ticker || raw.baseSymbol || null;
    const type = (raw.symbolType || item.symbolType || '').toLowerCase() === 'call' ? 'call' : 'put';
    const strike = num(raw.strikePrice);
    const expiration = raw.expirationDate || item.expirationDate || null;

    // recordId is stable across runs — same contract always produces the same id.
    // tradeTime is intentionally omitted: options-chain is a snapshot, so the
    // contract identity (not the moment of fetch) is what matters for dedup.
    const recordId = simpleHash(buildContractKey(resolvedTicker, type, strike, expiration));

    return {
        recordId,
        ticker: resolvedTicker,
        contractName,
        type,
        strike,
        expiration,
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
 *
 * Field mapping notes (confirmed from raw API log):
 * - raw.lastPrice    = underlying stock price, NOT the option price.
 *                      Renamed to underlyingPrice to match unusual-activity schema.
 * - raw.bidPrice/askPrice = option bid/ask. Midpoint used as best proxy for option price.
 * - raw.expirationDate   = full ISO timestamp ("2026-06-18T16:30:00-05:00") — stripped to date.
 * - raw.tradeCondition   = single OPRA condition code ('i', 'm', etc.), not SWEEP/BLOCK/SPLIT.
 * - raw.symbol       = primary contract identifier (symbolCode not returned by flow endpoint).
 */
export function transformTickerFlow(item, ticker) {
    const raw = item.raw || item;

    const volume = num(raw.volume);
    const underlyingPrice = num(raw.lastPrice);   // stock price, not option price
    const bidPrice = num(raw.bidPrice);
    const askPrice = num(raw.askPrice);

    // Option price: use bid/ask midpoint — flow endpoint has no separate option lastPrice field.
    const optionPrice =
        bidPrice != null && askPrice != null
            ? parseFloat(((bidPrice + askPrice) / 2).toFixed(4))
            : null;

    // Premium = option price × contracts × 100 shares per contract.
    const premium =
        optionPrice != null && volume != null
            ? Math.round(optionPrice * volume * 100)
            : null;

    // OPRA condition codes returned by Barchart flow endpoint.
    // 'i' = intermarket sweep order (ISO), 'm' = market maker / manual.
    const tradeConditionMap = {
        'A': 'auto-exec',
        'C': 'cancel',
        'F': 'floor',
        'I': 'iso',
        'M': 'market-maker',
        'Q': 'quote',
        'S': 'spread',
        'X': 'cross',
        // Legacy Barchart named conditions (kept for browser-fallback compatibility)
        'SWEEP': 'sweep', 'BLOCK': 'block', 'SPLIT': 'split', 'FLOOR': 'floor',
    };
    const rawCondition = (raw.tradeCondition || '').toUpperCase();
    const tradeCondition = tradeConditionMap[rawCondition] || raw.tradeCondition || null;

    // Flow endpoint uses `symbol` as the primary contract identifier.
    // symbolCode is not returned by this endpoint.
    const contractName = raw.symbol || raw.symbolCode || item.symbol || item.symbolCode || null;

    const tradeTime = raw.tradeTime
        ? new Date(raw.tradeTime * 1000).toISOString()
        : item.tradeTime || null;

    const resolvedTicker = ticker || raw.baseSymbol || null;
    const type = (raw.symbolType || item.symbolType || '').toLowerCase() === 'call' ? 'call' : 'put';
    const strike = num(raw.strikePrice);

    // Strip time component from expirationDate — flow endpoint returns a full ISO
    // timestamp ("2026-06-18T16:30:00-05:00") unlike other endpoints which return "YYYY-MM-DD".
    const rawExp = raw.expirationDate || item.expirationDate || null;
    const expiration = rawExp ? rawExp.split('T')[0] : null;

    // recordId is always non-null. tradeTime is included so two fills on the
    // same contract at different times produce distinct recordIds.
    const recordId = simpleHash(buildContractKey(resolvedTicker, type, strike, expiration, tradeTime));

    return {
        recordId,
        ticker: resolvedTicker,
        contractName,
        type,
        strike,
        expiration,
        daysToExpiry: num(raw.daysToExpiration),
        optionPrice,
        bid: bidPrice,
        ask: askPrice,
        underlyingPrice,
        volume,
        openInterest: num(raw.openInterest),
        impliedVolatility: num(raw.volatility),
        premium,
        tradeCondition,
        // Sentiment cannot be derived for flow records: the flow endpoint has no
        // option last-trade price, only bid/ask. Using the midpoint as optionPrice
        // means deriveSentiment would always return 'neutral' — so we omit it.
        sentiment: null,
        tradeTime,
        retrievedAt: new Date().toISOString(),
        source: 'barchart-ticker-flow',
    };
}

/**
 * Applies user filters to a transformed result.
 *
 * Filter behaviour by mode:
 * - unusual-activity: applies optionType + minVolumeOIRatio + minPremium
 * - options-chain:    applies optionType + minVolume only (ratio/premium passed as 0)
 * - ticker-flow:      applies optionType only (ratio/premium/volume passed as 0)
 */
export function applyFilters(record, filters) {
    const { optionType, minVolumeOIRatio, minPremium, minVolume } = filters;

    if (optionType && optionType !== 'all') {
        if (record.type !== optionType) return false;
    }

    if (minVolumeOIRatio != null && minVolumeOIRatio > 0) {
        if (record.volumeOIRatio == null || record.volumeOIRatio < minVolumeOIRatio) return false;
    }

    if (minPremium != null && minPremium > 0) {
        if (record.premium == null || record.premium < minPremium) return false;
    }

    // options-chain mode: filter out illiquid/zero-volume contracts
    if (minVolume != null && minVolume > 0) {
        if (record.volume == null || record.volume < minVolume) return false;
    }

    return true;
}
