const UNUSUAL_ACTIVITY_FIELDS = [
    'symbol', 'baseSymbol', 'baseLastPrice', 'baseSymbolType',
    'expirationDate', 'daysToExpiration', 'symbolType', 'strikePrice',
    'moneyness', 'bidPrice', 'lastPrice', 'askPrice',
    'volume', 'openInterest', 'volumeOpenInterestRatio',
    'weightedImpliedVolatility', 'volatility', 'delta',
    'tradeTime', 'symbolCode'
].join(',');

const BASE_URL = 'https://www.barchart.com/proxies/core-api/v1/options/get';

// Maximum number of times any single request will be retried on a 429.
// Waits grow exponentially: 10s → 20s → 40s. If all retries are exhausted, throws.
const MAX_RETRIES = 3;

/**
 * Deduplicates raw Barchart records by contract identity.
 * Barchart can return the same record on two consecutive pages when a record
 * sits exactly on a page boundary. We deduplicate using a key of:
 *   symbolCode (if present) OR baseSymbol + symbolType + strikePrice + expirationDate
 *
 * Called after all pages are collected, before slicing to maxResults.
 *
 * @param {Array} records - raw records from Barchart API
 * @returns {Array} deduplicated records, preserving original order
 */
function deduplicateRecords(records) {
    const seen = new Set();
    return records.filter(item => {
        const raw = item.raw || item;
        // Prefer symbolCode as it's the most specific identifier.
        // Fall back to a composite key when symbolCode is absent (usual-activity).
        const key = raw.symbolCode ||
            (raw.baseSymbol || '') + '|' +
            (raw.symbolType || '') + '|' +
            (raw.strikePrice || '') + '|' +
            (raw.expirationDate || '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Fetches a URL with bounded exponential-backoff retry on 429.
 * Throws on any non-429 error status, or after MAX_RETRIES 429 responses.
 *
 * @param {string} url
 * @param {object} options - fetch options (headers etc.)
 * @param {number} attempt - internal retry counter, starts at 1
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options, attempt = 1) {
    const response = await fetch(url, options);

    if (response.status === 429) {
        if (attempt > MAX_RETRIES) {
            throw new Error(
                'Barchart rate limit (429) exceeded after ' + MAX_RETRIES + ' retries. ' +
                'Try again in a few minutes or reduce maxResults.'
            );
        }
        const waitMs = 10000 * attempt; // 10s, 20s, 40s
        console.log('   Rate limited — attempt ' + attempt + '/' + MAX_RETRIES +
                    ', waiting ' + (waitMs / 1000) + 's before retry...');
        await new Promise(r => setTimeout(r, waitMs));
        return fetchWithRetry(url, options, attempt + 1);
    }

    return response;
}

function buildHeaders(session) {
    return {
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.barchart.com/options/unusual-activity/stocks',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0',
        'X-XSRF-TOKEN': session.xsrfToken,
        'Cookie': session.cookieHeader,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
    };
}

export async function fetchUnusualActivityPage(session, baseSymbolTypes = 'stock', page = 1, limit = 200) {
    const params = new URLSearchParams({
        fields: UNUSUAL_ACTIVITY_FIELDS,
        orderBy: 'volumeOpenInterestRatio',
        orderDir: 'desc',
        baseSymbolTypes: baseSymbolTypes,
        limit: String(limit),
        page: String(page),
        raw: '1',
    });

    params.set('between(volumeOpenInterestRatio,1.24,)', '');
    params.set('between(lastPrice,.10,)', '');
    params.set('between(volume,500,)', '');
    params.set('between(openInterest,100,)', '');
    params.set('in(exchange,(AMEX,NYSE,NASDAQ,INDEX-CBOE))', '');

    const url = BASE_URL + '?' + params.toString();

    const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: buildHeaders(session),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error('Barchart API error ' + response.status + ': ' + text.substring(0, 200));
    }

    const json = await response.json();
    return {
        data: json.data || [],
        total: json.total || 0,
    };
}

export async function fetchUnusualActivity(session, baseSymbolTypes = 'stock', maxResults = 500) {
    const LIMIT = 200;
    const allData = [];
    let page = 1;
    let total = Infinity;

    while (allData.length < maxResults && allData.length < total) {
        console.log('   Fetching page ' + page + ' for ' + baseSymbolTypes + '...');
        const { data, total: pageTotal } = await fetchUnusualActivityPage(session, baseSymbolTypes, page, LIMIT);
        total = pageTotal;
        allData.push(...data);
        if (data.length < LIMIT) break;
        page++;
        await new Promise(r => setTimeout(r, 2000));
    }

    const deduped = deduplicateRecords(allData);
    if (deduped.length < allData.length) {
        console.log('   → Removed ' + (allData.length - deduped.length) + ' duplicate(s) from pagination overlap.');
    }
    return deduped.slice(0, maxResults);
}

export async function fetchOptionsChain(session, ticker, expirationDate = null, maxResults = 500) {
    const allData = [];
    let page = 1;
    const LIMIT = 200;
    const tickerUpper = ticker.toUpperCase();

    while (allData.length < maxResults) {
        const params = new URLSearchParams({
            fields: UNUSUAL_ACTIVITY_FIELDS,
            orderBy: 'strikePrice',
            orderDir: 'asc',
            limit: String(LIMIT),
            page: String(page),
            raw: '1',
        });

        params.set('in(baseSymbol,(' + tickerUpper + '))', '');

        if (expirationDate) {
            params.set('between(expirationDate,' + expirationDate + ',' + expirationDate + ')', '');
        }

        const url = BASE_URL + '?' + params.toString();
        const response = await fetchWithRetry(url, {
            method: 'GET',
            headers: Object.assign({}, buildHeaders(session), {
                'Referer': 'https://www.barchart.com/stocks/quotes/' + tickerUpper + '/options',
            }),
        });

        if (!response.ok) {
            throw new Error('Options chain request failed for ' + ticker + ': ' + response.status);
        }

        const json = await response.json();
        const data = json.data || [];
        allData.push(...data);

        if (data.length < LIMIT || allData.length >= (json.total || 0)) break;
        page++;
        await new Promise(r => setTimeout(r, 2000));
    }

    const deduped = deduplicateRecords(allData);
    if (deduped.length < allData.length) {
        console.log('   → Removed ' + (allData.length - deduped.length) + ' duplicate(s) from pagination overlap.');
    }
    return deduped.slice(0, maxResults);
}

export async function fetchTickerFlow(session, ticker) {
    const tickerUpper = ticker.toUpperCase();

    // Include both symbol and symbolCode — symbolCode may not be present on all
    // flow responses, so symbol is the primary contract identifier here.
    const url = 'https://www.barchart.com/proxies/core-api/v1/options/flow' +
        '?symbol=' + tickerUpper +
        '&fields=symbol,symbolCode,symbolType,strikePrice,expirationDate,lastPrice,' +
        'bidPrice,askPrice,volume,openInterest,volatility,tradeCondition,tradeTime' +
        '&raw=1&limit=200';

    const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: Object.assign({}, buildHeaders(session), {
            'Referer': 'https://www.barchart.com/stocks/quotes/' + tickerUpper + '/options-flow',
        }),
    });

    if (!response.ok) {
        console.log('Flow endpoint returned ' + response.status + ' for ' + ticker + ' — trying browser fallback.');
        return null;
    }

    const json = await response.json();
    return json.data || null;
}
